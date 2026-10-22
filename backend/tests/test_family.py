import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import Session, sessionmaker

from app import tasks
from app.auth import token_hash
from app.db import Base, get_db
from app.main import app, local_today
from app.models import (
    ChatConversation,
    ChatMessage,
    HouseholdProposal,
    ImportJob,
    LegacyClaim,
    ProposalComment,
    UploadToken,
    User,
)
from app.schemas import TransactionIn
from app.services import account
from app.services.ledger import add_transaction


def _clients(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'family.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    return engine, TestClient(app), TestClient(app)


def _register(client, email, name):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "safe-test-password-123", "display_name": name},
    )
    assert response.status_code == 200, response.text
    return response.json()["user"]["id"]


def _transaction(client, merchant, amount, kind="expense"):
    response = client.post(
        "/api/transactions",
        json={
            "tx_date": local_today().isoformat(),
            "amount_cents": amount,
            "tx_type": kind,
            "merchant": merchant,
            "category": "餐饮" if kind == "expense" else "收入",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_family_owner_isolation_and_revocation(tmp_path):
    _, leader, member = _clients(tmp_path)
    try:
        assert leader.get("/api/transactions").status_code == 401
        leader_id = _register(leader, "leader@example.com", "负责人")
        member_id = _register(member, "member@example.com", "成员")
        leader_private = _transaction(leader, "私账-负责人", 5000)
        member_private = _transaction(member, "私账-成员", 3000)
        member_income = _transaction(member, "工资-成员", 50000, "income")
        assert [row["id"] for row in leader.get("/api/transactions").json()["items"]] == [
            leader_private
        ]
        assert member.delete(f"/api/transactions/{leader_private}").status_code == 404
        assert (
            member.post(
                "/api/transactions/batch-category",
                json={
                    "ids": [leader_private],
                    "category": "购物",
                    "create_rule": False,
                },
            ).json()["before"]
            == []
        )
        created = leader.post("/api/families", json={"name": "小家"})
        assert created.status_code == 200, created.text
        invite = leader.post("/api/families/invitations", json={"email": "member@example.com"})
        assert invite.status_code == 200, invite.text
        joined = member.post(
            "/api/families/invitations/accept",
            json={
                "code": invite.json()["code"],
                "share_from": (local_today() - timedelta(days=1)).isoformat(),
                "share_transactions": True,
            },
        )
        assert joined.status_code == 200, joined.text
        assert leader.get(f"/api/families/transactions?ids={member_private}").json()["total"] == 1
        assert member.get(f"/api/families/transactions?ids={member_private}").json()["total"] == 1
        assert member.get(f"/api/families/transactions?ids={leader_private}").json()["total"] == 0
        assert member.get(f"/api/families/transactions?user_id={leader_id}").status_code == 403
        assert (
            member.put(
                "/api/families/budget",
                json={
                    "monthly_budget_cents": 10000,
                    "category_budgets": [],
                },
            ).status_code
            == 403
        )
        assert (
            leader.put(
                "/api/families/budget",
                json={
                    "monthly_budget_cents": 10000,
                    "category_budgets": [{"category": "餐饮", "limit_cents": 2000}],
                },
            ).status_code
            == 200
        )
        assert (
            member.patch(
                f"/api/transactions/{member_private}/family-sharing", json={"shared": True}
            ).status_code
            == 200
        )
        dashboard = leader.get("/api/families/dashboard")
        assert dashboard.status_code == 200, dashboard.text
        assert dashboard.json()["common_expense_cents"] == 3000
        assert dashboard.json()["expense_cents"] == 8000
        assert member.get("/api/families/dashboard").json()["expense_cents"] == 3000
        assert (
            leader.patch(
                f"/api/transactions/{leader_private}/family-sharing", json={"shared": True}
            ).status_code
            == 200
        )
        assert (
            member.get(f"/api/families/transactions?common_only=true&ids={leader_private}").json()[
                "total"
            ]
            == 0
        )
        proposal = member.post(
            "/api/families/proposals",
            json={
                "title": "餐桌",
                "amount_cents": 3000,
                "planned_date": local_today().isoformat(),
                "category": "餐饮",
                "split_method": "equal",
            },
        )
        assert proposal.status_code == 200, proposal.text
        proposal_id = proposal.json()["id"]
        assert (
            member.post(
                f"/api/families/proposals/{proposal_id}/comments",
                json={"content": "我来记录这个计划"},
            ).status_code
            == 200
        )
        personal_export = member.get("/api/users/me/export").json()["data"]
        assert {row["id"] for row in personal_export["transactions"]} == {
            member_private,
            member_income,
        }
        assert personal_export["household_membership"]["user_id"] == member_id
        assert [row["id"] for row in personal_export["authored_household_proposals"]] == [
            proposal_id
        ]
        assert len(personal_export["authored_proposal_comments"]) == 1
        assert (
            leader.post(
                f"/api/families/proposals/{proposal_id}/confirm",
                json={
                    "decision": "approved",
                },
            ).status_code
            == 200
        )
        assert (
            leader.post(
                f"/api/families/proposals/{proposal_id}/link-transaction",
                json={
                    "transaction_id": member_private,
                },
            ).status_code
            == 200
        )
        assert member.delete(f"/api/transactions/{member_private}").status_code == 409
        assert (
            member.put(
                "/api/families/sharing",
                json={
                    "share_from": local_today().isoformat(),
                    "share_transactions": False,
                },
            ).status_code
            == 200
        )
        assert leader.get(f"/api/families/transactions?ids={member_private}").json()["total"] == 0
        assert member.get(f"/api/families/transactions?ids={member_private}").json()["total"] == 1
        assert (
            leader.delete(f"/api/families/proposals/{proposal_id}/link-transaction").status_code
            == 200
        )
        assert (
            leader.post(
                f"/api/families/proposals/{proposal_id}/link-transaction",
                json={
                    "transaction_id": member_private,
                },
            ).status_code
            == 404
        )
        assert leader.delete(f"/api/families/members/{member_id}").status_code == 200
        assert member.get("/api/families/dashboard").status_code == 404
    finally:
        app.dependency_overrides.clear()
        leader.close()
        member.close()


def test_password_session_and_cross_user_ai_scope(tmp_path):
    _, first, second = _clients(tmp_path)
    try:
        _register(first, "a@example.com", "甲")
        _register(second, "b@example.com", "乙")
        _transaction(first, "只属于甲", 1234)
        assert second.get("/api/transactions").json()["total"] == 0
        assert second.get("/api/overview").json()["expense_cents"] == 0
        assert second.get("/api/ai/conversations").json() == []
        assert second.post("/api/ai/review-transactions", json=[1]).status_code == 403
        assert first.post("/api/auth/logout").status_code == 200
        assert first.get("/api/settings").status_code == 401
    finally:
        app.dependency_overrides.clear()
        first.close()
        second.close()


def test_family_internal_goal_and_asset_coverage(tmp_path):
    _, client, other = _clients(tmp_path)
    try:
        _register(client, "solo@example.com", "独立用户")
        assert client.post("/api/families", json={"name": "小家"}).status_code == 200
        spending = _transaction(client, "共同采购", 2000)
        assert (
            client.patch(
                f"/api/transactions/{spending}/family-sharing",
                json={
                    "shared": True,
                },
            ).json()["family_shared"]
            is True
        )
        assert client.get("/api/families/dashboard").json()["common_expense_cents"] == 2000
        flags = client.patch(
            f"/api/transactions/{spending}/family-internal",
            json={
                "internal": True,
            },
        ).json()
        assert flags == {"id": spending, "family_shared": False, "family_internal": True}
        assert client.get("/api/families/dashboard").json()["expense_cents"] == 0
        assert client.get("/api/families/budget").json()["spent_cents"] == 0
        goal = client.post(
            "/api/families/goals",
            json={
                "name": "旅行",
                "target_cents": 10000,
                "current_cents": 5000,
                "monthly_contribution_cents": 1000,
                "source_note": "旅行储蓄账户",
            },
        )
        assert goal.status_code == 200, goal.text
        preview = client.post(
            "/api/families/proposals/preview",
            json={
                "amount_cents": 2000,
                "planned_date": local_today().isoformat(),
                "funding_goal_id": goal.json()["id"],
            },
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["goal_impact"]["delay_months"] == 2
        assert preview.json()["opening_balance_cents"] is None
        asset = client.post(
            "/api/users/me/assets",
            json={
                "name": "现金账户",
                "kind": "asset",
                "balance_cents": 0,
                "as_of": local_today().isoformat(),
                "include_in_family": True,
                "is_cash_account": True,
            },
        )
        assert asset.status_code == 200, asset.text
        key = asset.json()["account_key"]
        assert (
            client.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        dashboard = client.get("/api/families/dashboard").json()
        assert dashboard["net_worth_cents"] == 0
        assert dashboard["net_worth_covered"] is True
        assert dashboard["coverage_details"][0]["included_count"] == 1
        updated = client.post(
            "/api/users/me/assets",
            json={
                "account_key": key,
                "name": "现金账户",
                "kind": "asset",
                "balance_cents": 10000,
                "as_of": local_today().isoformat(),
                "include_in_family": True,
                "is_cash_account": True,
            },
        )
        assert updated.status_code == 200, updated.text
        assert client.get("/api/families/dashboard").json()["net_worth_cents"] is None
        assert (
            client.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert client.get("/api/families/dashboard").json()["net_worth_cents"] == 10000
        assert len(client.get("/api/users/me/assets").json()) == 1
        assert client.post(f"/api/users/me/assets/{key}/archive").status_code == 200
        assert client.get("/api/families/dashboard").json()["net_worth_cents"] is None
        assert client.delete("/api/families").status_code == 200
        own_ledger = client.get(f"/api/transactions?ids={spending}").json()["items"]
        assert own_ledger[0]["family_internal"] is False
        assert client.post("/api/families", json={"name": "新的家庭"}).status_code == 200
        assert client.get("/api/users/me/assets/coverage").json()["confirmed"] is False
    finally:
        app.dependency_overrides.clear()
        client.close()
        other.close()


def test_asset_ownership_policy_validity_and_isolation(tmp_path):
    _, leader, outsider = _clients(tmp_path)
    try:
        _register(leader, "assets-leader@example.com", "资产负责人")
        _register(outsider, "assets-outsider@example.com", "其他用户")
        assert leader.post("/api/families", json={"name": "资产家庭"}).status_code == 200
        old_date = (local_today() - timedelta(days=45)).isoformat()
        created = leader.post(
            "/api/users/me/assets",
            json={
                "name": "共同储蓄",
                "kind": "asset",
                "ownership": "joint",
                "shared_account_key": "family-savings",
                "balance_cents": 10000,
                "as_of": old_date,
                "include_in_family": True,
                "is_cash_account": False,
            },
        )
        assert created.status_code == 200, created.text
        key = created.json()["account_key"]
        assert created.json()["ownership"] == "joint"
        fresh = leader.post(
            "/api/users/me/assets",
            json={
                "name": "个人储蓄",
                "kind": "asset",
                "ownership": "individual",
                "balance_cents": 5000,
                "as_of": local_today().isoformat(),
                "include_in_family": True,
                "is_cash_account": False,
            },
        )
        assert fresh.status_code == 200, fresh.text
        assert {row["ownership"] for row in leader.get("/api/users/me/assets").json()} == {
            "individual",
            "joint",
        }
        assert len(leader.get("/api/users/me/assets").json()) == 2
        assert outsider.get("/api/users/me/assets").json() == []
        assert outsider.post(f"/api/users/me/assets/{key}/archive").status_code == 404
        assert leader.get("/api/users/me/assets/coverage-policy").json() == {"valid_days": 30}
        assert outsider.get("/api/users/me/assets/coverage-policy").json() == {"valid_days": 30}
        assert (
            leader.put("/api/users/me/assets/coverage-policy", json={"valid_days": 0}).status_code
            == 422
        )
        assert (
            leader.put("/api/users/me/assets/coverage-policy", json={"valid_days": 366}).status_code
            == 422
        )
        assert (
            leader.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        dashboard = leader.get("/api/families/dashboard").json()
        assert dashboard["net_worth_cents"] is None
        assert dashboard["coverage_details"][0]["valid_days"] == 30
        assert dashboard["coverage_details"][0]["included_count"] == 2
        assert "1 项资产" in dashboard["coverage_details"][0]["reason"]
        assert "30 天" in dashboard["coverage_details"][0]["reason"]
        assert leader.put(
            "/api/users/me/assets/coverage-policy", json={"valid_days": 60}
        ).json() == {"valid_days": 60}
        assert leader.get("/api/users/me/assets/coverage").json() == {"confirmed": False}
        assert (
            leader.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        dashboard = leader.get("/api/families/dashboard").json()
        assert dashboard["net_worth_cents"] == 15000
        assert dashboard["coverage_details"][0]["valid_days"] == 60
        assert outsider.get("/api/users/me/assets/coverage-policy").json() == {"valid_days": 30}
        assert (
            leader.put("/api/users/me/assets/coverage-policy", json={"valid_days": 15}).status_code
            == 200
        )
        assert leader.get("/api/users/me/assets/coverage").json() == {"confirmed": False}
        archived = leader.post(f"/api/users/me/assets/{key}/archive")
        assert archived.status_code == 200, archived.text
        assert archived.json()["ownership"] == "joint"
        assert (
            leader.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert leader.get("/api/families/dashboard").json()["net_worth_cents"] == 5000
    finally:
        app.dependency_overrides.clear()
        leader.close()
        outsider.close()


def test_declared_joint_account_counts_once_and_conflicts_withhold_total(tmp_path):
    _, leader, member = _clients(tmp_path)
    try:
        _register(leader, "joint-leader@example.com", "负责人")
        _register(member, "joint-member@example.com", "成员")
        assert leader.post("/api/families", json={"name": "共有账户家庭"}).status_code == 200
        code = leader.post("/api/families/invitations", json={}).json()["code"]
        joined = member.post(
            "/api/families/invitations/accept",
            json={"code": code, "share_transactions": True},
        )
        assert joined.status_code == 200, joined.text

        def snapshot(client, *, account_key=None, amount=20000, as_of=None, kind="asset"):
            return client.post(
                "/api/users/me/assets",
                json={
                    "account_key": account_key,
                    "name": "共同储蓄",
                    "kind": kind,
                    "ownership": "joint",
                    "shared_account_key": "  HOME Savings  "
                    if client is leader
                    else "home savings",
                    "balance_cents": amount,
                    "as_of": as_of or local_today().isoformat(),
                    "include_in_family": True,
                    "is_cash_account": kind == "asset",
                },
            )

        missing_key = leader.post(
            "/api/users/me/assets",
            json={
                "name": "无标识",
                "kind": "asset",
                "ownership": "joint",
                "balance_cents": 100,
                "as_of": local_today().isoformat(),
                "include_in_family": True,
            },
        )
        assert missing_key.status_code == 422
        first = snapshot(leader)
        second = snapshot(member)
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["shared_account_key"] == second.json()["shared_account_key"]
        assert (
            leader.get("/api/users/me/assets").json()[0]["account_key"]
            == first.json()["account_key"]
        )
        assert (
            member.get("/api/users/me/assets").json()[0]["account_key"]
            == second.json()["account_key"]
        )
        assert (
            leader.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert (
            member.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        dashboard = leader.get("/api/families/dashboard").json()
        assert dashboard["net_worth_cents"] == 20000
        assert dashboard["net_worth_covered"] is True

        changed = snapshot(member, account_key=second.json()["account_key"], amount=21000)
        assert changed.status_code == 200, changed.text
        assert (
            member.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        dashboard = leader.get("/api/families/dashboard").json()
        assert dashboard["net_worth_cents"] is None
        assert all("home savings" in item["reason"] for item in dashboard["coverage_details"])
        assert all("21000" not in item["reason"] for item in dashboard["coverage_details"])
        assert member.get("/api/families/dashboard").json()["coverage_details"] == []

        assert (
            member.post(f"/api/users/me/assets/{second.json()['account_key']}/archive").status_code
            == 200
        )
        changed = snapshot(member, as_of=(local_today() - timedelta(days=1)).isoformat())
        assert changed.status_code == 200, changed.text
        active_key = changed.json()["account_key"]
        assert (
            member.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert leader.get("/api/families/dashboard").json()["net_worth_cents"] is None

        changed = snapshot(member, account_key=active_key, kind="liability")
        assert changed.status_code == 200, changed.text
        assert (
            member.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert leader.get("/api/families/dashboard").json()["net_worth_cents"] is None

        assert snapshot(member, account_key=active_key).status_code == 200
        assert (
            member.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert leader.get("/api/families/dashboard").json()["net_worth_cents"] == 20000
        assert snapshot(leader).status_code == 200
        assert (
            leader.put("/api/users/me/assets/coverage", json={"confirmed": True}).status_code == 200
        )
        assert leader.get("/api/families/dashboard").json()["net_worth_cents"] is None
    finally:
        app.dependency_overrides.clear()
        leader.close()
        member.close()


def test_account_deletion_requires_password_and_cleans_every_reference(tmp_path, monkeypatch):
    engine, leader, member = _clients(tmp_path)
    member_email = "delete-member@example.com"
    member_password = "safe-test-password-123"
    upload_dir = tmp_path / "private_uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(account, "UPLOAD_DIR", upload_dir)
    try:
        _register(leader, "kept-leader@example.com", "Leader")
        member_id = _register(member, member_email, "Leaving member")
        leader_tx = _transaction(leader, "Leader bill", 1200)
        member_tx = _transaction(member, "Member bill", 3400)
        assert leader.post("/api/families", json={"name": "Kept family"}).status_code == 200
        code = leader.post("/api/families/invitations", json={"email": member_email}).json()["code"]
        assert (
            member.post(
                "/api/families/invitations/accept",
                json={"code": code, "share_transactions": True},
            ).status_code
            == 200
        )

        authored = member.post(
            "/api/families/proposals",
            json={
                "title": "Remove my authored plan",
                "amount_cents": 1000,
                "planned_date": local_today().isoformat(),
            },
        ).json()["id"]
        kept = leader.post(
            "/api/families/proposals",
            json={
                "title": "Keep leader plan",
                "amount_cents": 3400,
                "planned_date": local_today().isoformat(),
            },
        ).json()["id"]
        assert (
            leader.post(
                f"/api/families/proposals/{authored}/comments", json={"content": "Leader comment"}
            ).status_code
            == 200
        )
        assert (
            member.post(
                f"/api/families/proposals/{kept}/comments", json={"content": "Private comment"}
            ).status_code
            == 200
        )
        assert (
            leader.post(
                f"/api/families/proposals/{kept}/confirm", json={"decision": "approved"}
            ).status_code
            == 200
        )
        assert (
            member.patch(
                f"/api/transactions/{member_tx}/family-sharing", json={"shared": True}
            ).status_code
            == 200
        )
        assert (
            leader.post(
                f"/api/families/proposals/{kept}/link-transaction",
                json={"transaction_id": member_tx},
            ).status_code
            == 200
        )

        wrong = member.request("DELETE", "/api/users/me", json={"password": "wrong"})
        assert wrong.status_code == 403
        still_member = member.request("DELETE", "/api/users/me", json={"password": member_password})
        assert still_member.status_code == 409
        assert still_member.json()["detail"]["code"] == "LEAVE_FAMILY_FIRST"
        assert member.post("/api/families/leave").status_code == 200

        upload_id = str(uuid.uuid4())
        (upload_dir / upload_id).write_bytes(b"private import")
        (upload_dir / f"{upload_id}.name").write_text("private.csv", encoding="utf-8")
        with Session(engine) as db:
            db.add(UploadToken(id=upload_id, owner_id=member_id))
            db.add(
                ImportJob(
                    id=upload_id,
                    owner_id=member_id,
                    status="running",
                    filename="private.csv",
                    content_sha256="a" * 64,
                    mapping_sha256="b" * 64,
                    mapping={},
                )
            )
            conversation_id = str(uuid.uuid4())
            db.add(
                ChatConversation(
                    id=conversation_id,
                    owner_id=member_id,
                    title="Private chat",
                    created_at=datetime.now(timezone.utc),
                    used_ledger=True,
                )
            )
            db.add(
                ChatMessage(
                    conversation_id=conversation_id,
                    role="user",
                    content="private note",
                    reasoning="",
                    thinking=False,
                    created_at=datetime.now(timezone.utc),
                )
            )
            db.commit()

        active_import = member.request(
            "DELETE", "/api/users/me", json={"password": member_password}
        )
        assert active_import.status_code == 409
        assert active_import.json()["detail"]["code"] == "IMPORT_IN_PROGRESS"
        with Session(engine) as db:
            db.get(ImportJob, upload_id).status = "pending"
            db.commit()

        # A queued import may never start when Redis is offline; account deletion
        # cancels that job and invalidates its upload token.
        deleted = member.request("DELETE", "/api/users/me", json={"password": member_password})
        assert deleted.status_code == 200, deleted.text
        assert deleted.json() == {"deleted": True}
        assert member.get("/api/auth/me").status_code == 401
        assert (
            member.post(
                "/api/auth/login", json={"email": member_email, "password": member_password}
            ).status_code
            == 401
        )
        assert leader.get(f"/api/transactions?ids={leader_tx}").json()["total"] == 1
        proposals = leader.get("/api/families/proposals").json()
        assert [row["id"] for row in proposals] == [kept]
        assert proposals[0]["linked_transaction_id"] is None
        assert proposals[0]["comments"] == []
        with Session(engine) as db:
            assert db.get(User, member_id) is None
            assert db.get(HouseholdProposal, authored) is None
            assert db.scalars(select(ProposalComment)).all() == []
            assert db.scalars(select(ChatMessage)).all() == []
            assert db.scalars(select(ImportJob)).all() == []
            assert db.execute(text("PRAGMA foreign_key_check")).all() == []
        assert not (upload_dir / upload_id).exists()
        assert not (upload_dir / f"{upload_id}.name").exists()
        monkeypatch.setattr(tasks, "SessionLocal", sessionmaker(bind=engine))
        assert tasks.import_task.run(upload_id) is None
    finally:
        app.dependency_overrides.clear()
        leader.close()
        member.close()


def test_legacy_claim_requires_local_one_time_code(tmp_path):
    engine, client, other = _clients(tmp_path)
    code = "local-only-claim-code-123456789"
    with Session(engine) as db:
        db.add(
            User(
                id=1,
                email="legacy@spendwise.invalid",
                display_name="原有数据",
                password_hash="!",
                is_legacy_placeholder=True,
            )
        )
        db.add(LegacyClaim(id=1, code_hash=token_hash(code)))
        db.flush()
        add_transaction(
            db,
            TransactionIn(tx_date=local_today(), amount_cents=1500, merchant="原账单"),
            owner_id=1,
        )
        db.commit()
    try:
        _register(client, "claim@example.com", "认领用户")
        assert client.get("/api/transactions").json()["total"] == 0
        wrong = client.post(
            "/api/auth/claim-legacy", json={"code": "incorrect-long-code-123456789"}
        )
        assert wrong.status_code == 403
        claimed = client.post("/api/auth/claim-legacy", json={"code": code})
        assert claimed.status_code == 200, claimed.text
        assert client.get("/api/transactions").json()["total"] == 1
        assert client.post("/api/auth/claim-legacy", json={"code": code}).status_code == 409
    finally:
        app.dependency_overrides.clear()
        client.close()
        other.close()
