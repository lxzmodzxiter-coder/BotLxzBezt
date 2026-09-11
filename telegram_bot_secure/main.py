from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from .config import Settings
from .handlers import router
from .security import AbuseGuard
from .services import ProviderClient


async def main() -> None:
    settings = Settings.from_env()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp["guard"] = AbuseGuard(settings)
    dp["provider"] = ProviderClient(settings)
    dp.include_router(router)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
