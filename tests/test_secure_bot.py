from pathlib import Path

import pytest

from telegram_bot_secure.config import Settings
from telegram_bot_secure.db import CreditStore
from telegram_bot_secure.keyboards import CATEGORIES, category_keyboard
from telegram_bot_secure.security import AbuseGuard, host_is_allowed, validate_query


def settings(tmp_path: Path) -> Settings:
    return Settings(
        bot_token="123:TEST",
        db_path=tmp_path / "test.db",
        log_level="INFO",
        admin_user_ids=frozenset(),
        allowed_provider_hosts=frozenset({"api.example.pe"}),
        provider_base_url="https://api.example.pe",
        provider_token="secret-not-used-in-tests",
        demo_mode=True,
        max_request_bytes=1024,
        request_timeout_seconds=3,
        per_user_cooldown_seconds=10,
    )


def test_validate_query_rejects_control_and_length() -> None:
    assert validate_query("DEMO-001") == "DEMO-001"
    with pytest.raises(ValueError):
        validate_query("x")
    with pytest.raises(ValueError):
        validate_query("DEMO\n001")
    with pytest.raises(ValueError):
        validate_query("x" * 121)


def test_provider_allowlist_requires_https() -> None:
    assert host_is_allowed("https://api.example.pe", frozenset({"api.example.pe"}))
    assert not host_is_allowed("http://api.example.pe", frozenset({"api.example.pe"}))
    assert not host_is_allowed("https://evil.example", frozenset({"api.example.pe"}))


def test_cooldown_blocks_second_request() -> None:
    guard = AbuseGuard(settings(Path("/tmp")))
    assert guard.allow(7)[0]
    assert not guard.allow(7)[0]
    assert guard.allow(8)[0]


def test_keyboard_pages_cover_every_category() -> None:
    seen: list[str] = []
    for page in range((len(CATEGORIES) + 5) // 6):
        keyboard = category_keyboard(page)
        seen.extend(button.text for row in keyboard.inline_keyboard for button in row if button.callback_data and button.callback_data.startswith("category:"))
    assert seen == list(CATEGORIES)


@pytest.mark.asyncio
async def test_credit_transactions_are_idempotent(tmp_path: Path) -> None:
    store = CreditStore(tmp_path / "credits.db")
    await store.ensure_user(42)
    assert await store.apply_transaction("topup-1", 42, 10, "TOPUP", "payment-1")
    assert not await store.apply_transaction("topup-1", 42, 10, "TOPUP", "payment-1-retry")
    assert await store.apply_transaction("consume-1", 42, 3, "CONSUME", "demo-1")
    with pytest.raises(ValueError):
        await store.apply_transaction("consume-2", 42, 99, "CONSUME", "too-much")
    account = await store.ensure_user(42)
    assert account.credits == 7
