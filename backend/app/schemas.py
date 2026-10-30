from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ErrorBody(BaseModel):
    code: str
    message: str


class AgentPreferencesIn(BaseModel):
    automatic_enabled: bool | None = None
    ai_enabled: bool | None = None


class AgentPreferencesOut(BaseModel):
    automatic_enabled: bool
    ai_enabled: bool
    scope: str


class AgentCard(BaseModel):
    id: str
    tone: Literal["warning", "encouragement", "info"]
    title: str
    evidence: str
    message: str
    href: str


class AgentFacts(BaseModel):
    income_cents: int
    spent_cents: int
    budget_cents: int
    previous_spent_cents: int
    recent_spent_cents: int
    preceding_spent_cents: int
    transaction_count: int


class AgentBrief(BaseModel):
    preferences: AgentPreferencesOut
    as_of: date
    month: str
    fingerprint: str
    source: Literal["local", "ai"]
    reason: str
    cards: list[AgentCard]
    risks: dict[str, int]
    facts: AgentFacts
    pending_import: bool
    generated_at: datetime


class TransactionIn(BaseModel):
    tx_date: date
    amount_cents: int = Field(gt=0)
    tx_type: Literal["expense", "income", "transfer", "refund"] = "expense"
    merchant: str = ""
    description: str = ""
    category: str = "待确认"
    is_fixed: bool = False


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tx_date: date
    amount_cents: int
    tx_type: Literal["expense", "income", "transfer", "refund"]
    merchant: str
    description: str
    category: str
    is_fixed: bool
    source: str
    confidence: int
    classification_reason: str
    family_shared: bool = False
    family_internal: bool = False


class Page(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int
    expense_cents: int = 0
    income_cents: int = 0


class CategoryBudgetIn(BaseModel):
    category: str = Field(min_length=1, max_length=80)
    limit_cents: int = Field(ge=0)


class BudgetLimitsIn(BaseModel):
    monthly_budget_cents: int = Field(ge=0)
    category_budgets: list[CategoryBudgetIn] = Field(default_factory=list)

    @field_validator("category_budgets")
    @classmethod
    def unique_categories(
        cls, value: list[CategoryBudgetIn] | None
    ) -> list[CategoryBudgetIn] | None:
        if value is not None and len({item.category for item in value}) != len(value):
            raise ValueError("同一分类不能重复设置预算")
        return value


class SettingsIn(BaseModel):
    monthly_budget_cents: int = Field(ge=0)
    opening_balance_cents: int = Field(ge=0)
    ai_consent: bool = False
    category_budgets: list[CategoryBudgetIn] | None = None

    @field_validator("category_budgets")
    @classmethod
    def unique_categories(
        cls, value: list[CategoryBudgetIn] | None
    ) -> list[CategoryBudgetIn] | None:
        if value is not None and len({item.category for item in value}) != len(value):
            raise ValueError("同一分类不能重复设置预算")
        return value


class SettingsOut(BaseModel):
    monthly_budget_cents: int
    opening_balance_cents: int
    ai_consent: bool
    category_budgets: list[CategoryBudgetIn]
    currency: Literal["CNY"]
    timezone: Literal["Asia/Shanghai"]


class AiConnectionIn(BaseModel):
    api_key: str | None = Field(default=None, max_length=512)
    model: Literal["deepseek-flash", "deepseek-v4-pro"] = "deepseek-flash"
    clear_key: bool = False


class AiConnectionOut(BaseModel):
    configured: bool
    model: str
    endpoint: str


class AiStatusOut(AiConnectionOut):
    consent: bool


class ChatRequest(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=36)
    message: str = Field(min_length=1, max_length=4000)
    thinking: bool = False


class ChatLedgerConsentIn(BaseModel):
    enabled: bool


class ChatLedgerConsentOut(BaseModel):
    enabled: bool
    scope: str


class ChatConversationOut(BaseModel):
    id: str
    title: str
    created_at: datetime


class ChatMessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    reasoning: str
    thinking: bool


class ChatConversationDetail(BaseModel):
    id: str
    title: str
    used_ledger: bool
    messages: list[ChatMessageOut]


class BudgetAlert(BaseModel):
    scope: Literal["total", "category"]
    category: str | None = None
    limit_cents: int
    spent_cents: int
    over_cents: int


class BudgetStatus(BaseModel):
    month: str
    as_of: date
    income_cents: int
    spent_cents: int
    total_limit_cents: int
    alerts: list[BudgetAlert]
    data_version: str


class CategorySpend(BaseModel):
    category: str
    amount_cents: int


class OverviewOut(BaseModel):
    month: str
    income_cents: int
    expense_cents: int
    budget_remaining_cents: int
    account_balance_cents: int
    category_spend: list[CategorySpend]
    transaction_count: int
    data_version: str


class ScenarioIn(BaseModel):
    name: str = "未命名方案"
    amount_cents: int = Field(ge=0)
    purchase_date: date
    reserve_cents: int = Field(ge=0)
    protected_categories: list[str] = Field(default_factory=list)
    horizon_days: int = Field(ge=7, le=90, default=30)
    use_ai_review: bool = False


class ForecastBaseline(BaseModel):
    daily_cents: int
    lower_daily_cents: int
    upper_daily_cents: int
    method: str
    sample_days: int
    history_start: date
    assumptions: list[str]
    parameters: dict[str, float | int]


class ForecastAiReview(BaseModel):
    status: Literal["applied", "unavailable", "failed", "not_requested"]
    model: str | None = None
    adjustment_percent: float = 0
    reason: str


class BudgetCut(BaseModel):
    category: str
    amount_cents: int


class OptimizationResult(BaseModel):
    feasible: bool
    cuts: list[BudgetCut]
    total_cuts_cents: int


class CashflowDay(BaseModel):
    date: date
    before_cents: int
    after_cents: int
    lower_cents: int
    upper_cents: int
    bill_cents: int


class RecurringBill(BaseModel):
    date: date
    amount_cents: int
    merchant: str
    category: str
    source_ids: list[int]


class ScenarioResult(BaseModel):
    data_version: str
    as_of: date
    period_start: date | None = None
    period_end: date | None = None
    currency: Literal["CNY"]
    baseline: ForecastBaseline
    opening_balance_cents: int
    budget_remaining_cents: int
    purchase_amount_cents: int
    minimum_after_cents: int
    reserve_cents: int
    required_saving_cents: int
    optimization: OptimizationResult
    timeline: list[CashflowDay]
    recurring_bills: list[RecurringBill]
    source_transaction_ids: list[int]
    expected_expense_cents: int | None = None
    expected_expense_after_purchase_cents: int | None = None
    forecast_lower_expense_cents: int | None = None
    forecast_upper_expense_cents: int | None = None
    expected_budget_remaining_cents: int | None = None
    ai_review: ForecastAiReview | None = None


class SavedScenario(BaseModel):
    id: int
    name: str
    input: ScenarioIn
    result: ScenarioResult
    data_version: str


class SavedScenarioResult(BaseModel):
    id: int
    result: ScenarioResult


class BatchCategory(BaseModel):
    ids: list[int]
    category: str
    create_rule: bool = False


class AiCategorySuggestionIn(BaseModel):
    id: int = Field(gt=0)
    category: str = Field(min_length=1, max_length=80)
    confidence: int = Field(ge=0, le=100)
    reason: str = Field(default="AI 分类", max_length=200)


class AiCategoryApplyIn(BaseModel):
    suggestions: list[AiCategorySuggestionIn] = Field(min_length=1, max_length=10000)

    @field_validator("suggestions")
    @classmethod
    def unique_transaction_ids(
        cls, value: list[AiCategorySuggestionIn]
    ) -> list[AiCategorySuggestionIn]:
        if len({item.id for item in value}) != len(value):
            raise ValueError("同一笔账单不能重复提交")
        return value


class ImportMapping(BaseModel):
    date: str
    amount: str
    merchant: str | None = None
    description: str | None = None
    type: str | None = None
    category: str | None = None


class ImportConfirm(BaseModel):
    token: str
    mapping: ImportMapping


class AuthCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=10, max_length=256)


class RegisterIn(AuthCredentials):
    display_name: str = Field(min_length=1, max_length=80)


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str


class UserUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class AccountDeleteIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AccountDeleteOut(BaseModel):
    deleted: bool


class DeviceSessionOut(BaseModel):
    id: str
    current: bool
    created_at: datetime
    expires_at: datetime


class FamilySummary(BaseModel):
    id: int
    name: str
    role: Literal["leader", "member"]
    member_count: int


class SessionOut(BaseModel):
    user: UserOut
    family: FamilySummary | None
    claim_available: bool


class LegacyClaimIn(BaseModel):
    code: str = Field(min_length=20, max_length=256)


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class InvitationCreate(BaseModel):
    email: str | None = Field(default=None, max_length=255)


class InvitationOut(BaseModel):
    code: str
    expires_at: datetime


class InvitationAccept(BaseModel):
    code: str = Field(min_length=16, max_length=256)
    share_from: date | None = None
    share_transactions: bool = True


class SharingIn(BaseModel):
    share_from: date
    share_transactions: bool


class MemberOut(SharingIn):
    user_id: int
    display_name: str
    email: str
    role: Literal["leader", "member"]
    joined_at: datetime


class MembersOut(BaseModel):
    members: list[MemberOut]


class InvitationPreviewOut(BaseModel):
    family_name: str
    inviter_name: str
    expires_at: datetime


class TransferIn(BaseModel):
    user_id: int


class FamilyShareIn(BaseModel):
    shared: bool


class FamilyInternalIn(BaseModel):
    internal: bool


class FamilyFlagsOut(BaseModel):
    id: int
    family_shared: bool
    family_internal: bool


class AssetCoverageIn(BaseModel):
    confirmed: bool


class AssetCoverageOut(AssetCoverageIn):
    pass


class AssetCoveragePolicyIn(BaseModel):
    valid_days: int = Field(ge=1, le=365)


class AssetCoveragePolicyOut(AssetCoveragePolicyIn):
    pass


class FamilyBudgetIn(BudgetLimitsIn):
    pass


class FamilyBudgetOut(FamilyBudgetIn):
    scope: Literal["household", "self"]
    spent_cents: int
    alerts: list[BudgetAlert]


class FamilyCoverage(BaseModel):
    shared_members: int
    total_members: int


class FamilyCategorySpend(BaseModel):
    category: str
    amount_cents: int
    limit_cents: int | None


class FamilyMemberSource(BaseModel):
    user_id: int
    display_name: str
    income_cents: int
    expense_cents: int


class FamilyTimelineDay(BaseModel):
    date: date
    change_cents: int
    cumulative_change_cents: int


class FamilyEvent(BaseModel):
    date: date
    title: str
    amount_cents: int
    kind: str
    source_ids: list[int]


class FamilyCoverageDetail(BaseModel):
    user_id: int
    display_name: str
    confirmed: bool
    included_count: int
    valid_days: int
    latest_as_of: date | None
    reason: str | None


class FamilyProposalIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    amount_cents: int = Field(gt=0)
    planned_date: date
    category: str = Field(default="其他", min_length=1, max_length=80)
    split_method: Literal["equal", "author", "leader", "custom"] = "equal"
    split_note: str = Field(default="", max_length=255)
    funding_goal_id: int | None = None

    @model_validator(mode="after")
    def custom_split_requires_note(self):
        if self.split_method == "custom" and not self.split_note.strip():
            raise ValueError("自定义分担方式需要填写说明")
        return self


class ProposalCommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class ProposalCommentOut(BaseModel):
    id: int
    author_id: int
    content: str
    created_at: datetime


class FamilyProposalOut(FamilyProposalIn):
    id: int
    author_id: int
    status: Literal["pending", "approved", "returned"]
    linked_transaction_id: int | None
    created_at: datetime
    comments: list[ProposalCommentOut]


class FamilyDashboardOut(BaseModel):
    role: Literal["leader", "member"]
    scope: Literal["household", "self"]
    month: str
    coverage: FamilyCoverage
    coverage_details: list[FamilyCoverageDetail]
    income_cents: int
    expense_cents: int
    common_expense_cents: int
    category_spend: list[FamilyCategorySpend]
    member_sources: list[FamilyMemberSource]
    timeline: list[FamilyTimelineDay]
    events: list[FamilyEvent]
    goals: list["FamilyGoalOut"]
    pending_proposals: list[FamilyProposalOut]
    forecast_assumptions: list[str]
    net_worth_cents: int | None
    net_worth_covered: bool


class ProposalDecision(BaseModel):
    decision: Literal["approved", "returned"]


class ProposalLink(BaseModel):
    transaction_id: int


class ProposalPreviewIn(BaseModel):
    amount_cents: int = Field(gt=0)
    planned_date: date
    funding_goal_id: int | None = None


class ProposalPreviewDay(BaseModel):
    date: date
    before_cents: int
    after_cents: int


class GoalImpact(BaseModel):
    goal_id: int
    estimated_before_date: date | None
    estimated_after_date: date | None
    delay_months: int | None


class ProposalPreviewOut(BaseModel):
    scope: Literal["household", "self"]
    timeline: list[ProposalPreviewDay]
    minimum_before_cents: int | None
    minimum_after_cents: int | None
    opening_balance_cents: int | None
    forecast_assumptions: list[str]
    goal_impact: GoalImpact | None


class FamilyGoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_cents: int = Field(gt=0)
    current_cents: int = Field(ge=0)
    target_date: date | None = None
    source_note: str = Field(default="手动记录", min_length=1, max_length=255)
    monthly_contribution_cents: int = Field(default=0, ge=0)


class FamilyGoalOut(FamilyGoalIn):
    id: int
    updated_at: datetime


class AssetSnapshotFields(BaseModel):
    account_key: str | None = Field(default=None, max_length=36)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["asset", "liability"]
    ownership: Literal["individual", "joint"] = "individual"
    shared_account_key: str | None = Field(default=None, min_length=3, max_length=64)
    balance_cents: int = Field(ge=0)
    as_of: date
    include_in_family: bool = False
    is_cash_account: bool = False


class AssetSnapshotIn(AssetSnapshotFields):
    @model_validator(mode="after")
    def shared_account_key_matches_ownership(self):
        key = self.shared_account_key.strip().casefold() if self.shared_account_key else None
        self.shared_account_key = key or None
        if self.ownership == "individual" and self.shared_account_key is not None:
            raise ValueError("个人账户不能设置共有账户标识")
        if self.ownership == "joint" and self.include_in_family:
            if self.shared_account_key is None or len(self.shared_account_key) < 3:
                raise ValueError("纳入家庭的共有账户需要至少 3 个字符的共享标识")
        return self


class AssetSnapshotOut(AssetSnapshotFields):
    id: int
    account_key: str
    archived: bool
