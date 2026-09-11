from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from .config import Settings
from .db import CreditStore
from .handlers import router
from .logging_json import configure_json_logging
from .middleware import AccountMiddleware
from .security import AbuseGuard
from .services import ProviderClient


async def main() -> None:
    settings = Settings.from_env()
    configure_json_logging(settings.log_level)
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    store = CreditStore(settings.db_path)
    for owner_id in settings.admin_user_ids:
        await store.ensure_user(owner_id)
        await store.update_user_role(owner_id, "DUEÑO")
    dp["guard"] = AbuseGuard(settings)
    dp["provider"] = ProviderClient(settings)
    dp["store"] = store
    router.message.middleware(AccountMiddleware(store))
    router.callback_query.middleware(AccountMiddleware(store))
    dp.include_router(router)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
