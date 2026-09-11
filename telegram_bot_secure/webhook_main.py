from __future__ import annotations

import asyncio
import os

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

from .config import Settings
from .db import CreditStore
from .handlers import router
from .logging_json import configure_json_logging
from .middleware import AccountMiddleware
from .security import AbuseGuard
from .services import ProviderClient


async def run() -> None:
    settings = Settings.from_env()
    configure_json_logging(settings.log_level)
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    store = CreditStore(settings.db_path)
    dp["guard"] = AbuseGuard(settings)
    dp["provider"] = ProviderClient(settings)
    dp["store"] = store
    router.message.middleware(AccountMiddleware(store))
    router.callback_query.middleware(AccountMiddleware(store))
    dp.include_router(router)

    app = web.Application()
    secret = os.getenv("WEBHOOK_SECRET", "")
    if not secret:
        raise RuntimeError("WEBHOOK_SECRET es obligatorio en modo webhook")
    SimpleRequestHandler(dispatcher=dp, bot=bot, secret_token=secret).register(app, path="/telegram/webhook")
    setup_application(app, dp, bot=bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", int(os.getenv("WEBHOOK_PORT", "8080")))
    await site.start()
    webhook_url = os.environ["WEBHOOK_PUBLIC_URL"].rstrip("/") + "/telegram/webhook"
    await bot.set_webhook(webhook_url, secret_token=secret, drop_pending_updates=True)
    try:
        await asyncio.Event().wait()
    finally:
        await bot.delete_webhook(drop_pending_updates=False)
        await bot.session.close()
        await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(run())
