"""Shared daily AI limits. Redis makes reservations atomic across API and workers."""

import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any, cast

from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

FEATURE_LIMITS = {"chat": 30, "classification": 10, "story": 20, "agent": 10, "forecast": 10}
GUEST_FEATURE_LIMITS = {"chat": 3, "classification": 2, "story": 1, "agent": 1, "forecast": 1}
GLOBAL_DAILY_TOKENS = 200_000
_DAY_ZONE = timezone(timedelta(hours=8))
_local_lock = Lock()
_local_calls: dict[tuple[str, int, str], int] = defaultdict(int)
_local_tokens: dict[str, int] = defaultdict(int)


def _limits(owner_id: int) -> dict[str, int]:
    from app.db import SessionLocal
    from app.models import User

    from .guest_demo import is_guest

    with SessionLocal() as db:
        return GUEST_FEATURE_LIMITS if is_guest(db.get(User, owner_id)) else FEATURE_LIMITS


_RESERVE = """
local calls = tonumber(redis.call('GET', KEYS[1]) or '0')
local tokens = tonumber(redis.call('GET', KEYS[2]) or '0')
if tonumber(ARGV[5]) == 1 and calls >= tonumber(ARGV[1]) then return 1 end
if tokens + tonumber(ARGV[2]) > tonumber(ARGV[3]) then return 2 end
if tonumber(ARGV[5]) == 1 then redis.call('INCR', KEYS[1]) end
redis.call('INCRBY', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 0
"""


def _client() -> Redis:
    return Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)


def _local_development() -> bool:
    return os.getenv("DATABASE_URL", "sqlite:///./spendwise-dev.db").startswith("sqlite")


def _reserve_local(
    day: str, owner_id: int, feature: str, amount: int, count_call: bool, limit: int
) -> int:
    with _local_lock:
        key = (day, owner_id, feature)
        if count_call and _local_calls[key] >= limit:
            return 1
        if _local_tokens[day] + amount > GLOBAL_DAILY_TOKENS:
            return 2
        if count_call:
            _local_calls[key] += 1
        _local_tokens[day] += amount
        return 0


def snapshot(owner_id: int) -> dict:
    """Return today's remaining calls without reserving a request."""
    day = datetime.now(_DAY_ZONE).date().isoformat()
    limits = _limits(owner_id)
    features = list(limits)
    keys = [f"spendwise:ai:calls:{day}:{owner_id}:{feature}" for feature in features]
    keys.append(f"spendwise:ai:tokens:{day}")
    try:
        values = cast(list[str | None], _client().mget(keys))
        counts = [int(value or 0) for value in values[:-1]]
        tokens_used = int(values[-1] or 0)
    except (RedisConnectionError, RedisTimeoutError):
        if not _local_development():
            raise
        with _local_lock:
            counts = [_local_calls[(day, owner_id, feature)] for feature in features]
            tokens_used = _local_tokens[day]
    return {
        "day": day,
        "features": {
            feature: {
                "limit": limits[feature],
                "used": count,
                "remaining": max(0, limits[feature] - count),
            }
            for feature, count in zip(features, counts, strict=False)
        },
        "tokens_remaining": max(0, GLOBAL_DAILY_TOKENS - tokens_used),
    }


def reserve(
    owner_id: int, feature: str, messages: list[dict], max_tokens: int, *, count_call: bool = True
) -> tuple[str, int]:
    if feature not in FEATURE_LIMITS:
        raise ValueError("未知的 AI 功能")
    limit = _limits(owner_id)[feature]
    # UTF-8 bytes are a conservative upper bound for prompt token count.
    amount = len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) + max_tokens
    now = datetime.now(_DAY_ZONE)
    day = now.date().isoformat()
    ttl = max(
        1,
        int(
            (
                datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), _DAY_ZONE)
                - now
            ).total_seconds()
        )
        + 60,
    )
    try:
        result = int(
            cast(
                Any,
                _client().eval(
                    _RESERVE,
                    2,
                    f"spendwise:ai:calls:{day}:{owner_id}:{feature}",
                    f"spendwise:ai:tokens:{day}",
                    str(limit),
                    str(amount),
                    str(GLOBAL_DAILY_TOKENS),
                    str(ttl),
                    "1" if count_call else "0",
                ),
            )
        )
    except (RedisConnectionError, RedisTimeoutError):
        if not _local_development():
            raise
        result = _reserve_local(day, owner_id, feature, amount, count_call, limit)
    if result == 1:
        raise ValueError("今天这项 AI 功能的使用次数已用完，明天再来吧")
    if result == 2:
        raise ValueError("今天的 AI 服务额度已用完，明天再来吧")
    return day, amount


def settle(reservation: tuple[str, int], total_tokens: int) -> None:
    day, reserved = reservation
    adjustment = max(0, total_tokens) - reserved
    try:
        _client().incrby(f"spendwise:ai:tokens:{day}", adjustment)
    except (RedisConnectionError, RedisTimeoutError):
        if not _local_development():
            raise
        with _local_lock:
            _local_tokens[day] += adjustment
