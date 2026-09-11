from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject

from .db import CreditStore


class AccountMiddleware(BaseMiddleware):
    def __init__(self, store: CreditStore) -> None:
        self.store = store

    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]], event: TelegramObject, data: dict[str, Any]) -> Any:
        user = data.get("event_from_user")
        if user is not None:
            data["account"] = await self.store.ensure_user(user.id)
        return await handler(event, data)
