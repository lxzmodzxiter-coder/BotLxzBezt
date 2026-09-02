"""Bot Telegram BAN/UNBAN seguro.

Genera borradores para revisión humana; no envía correos, no realiza reportes
masivos y no presenta acusaciones no verificadas como hechos.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from time import monotonic

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")
MAX_DAILY_DRAFTS = int(os.getenv("MAX_DAILY_DRAFTS", "10"))


class Flow(StatesGroup):
    waiting_ban_phone = State()
    waiting_unban_phone = State()


@dataclass
class RateWindow:
    started_at: float
    count: int


rate_windows: dict[int, RateWindow] = {}
router = Router()


def menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🔴 BAN · Reportar cuenta", callback_data="flow:ban")],
            [InlineKeyboardButton(text="🟢 UNBAN · Apelar suspensión", callback_data="flow:unban")],
        ]
    )


def back_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="⬅️ Volver al menú", callback_data="flow:menu")]]
    )


def normalize_phone(value: str) -> str | None:
    """Acepta únicamente un número internacional E.164, como +14155552671."""
    compact = re.sub(r"[\s().-]", "", value.strip())
    return compact if PHONE_RE.fullmatch(compact) else None


def allowed(user_id: int) -> bool:
    """Límite sencillo por usuario para evitar abuso del generador."""
    now = monotonic()
    current = rate_windows.get(user_id)
    if current is None or now - current.started_at >= 86400:
        rate_windows[user_id] = RateWindow(now, 1)
        return True
    if current.count >= MAX_DAILY_DRAFTS:
        return False
    current.count += 1
    return True


def header(kind: str, phone: str) -> str:
    return (
        f"<b>BORRADOR DE {kind}</b>\n"
        f"Número afectado: <code>{escape(phone)}</code>\n"
        f"Generado: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n"
    )


def ban_draft(phone: str) -> str:
    return header("REPORTE", phone) + (
        "<b>Para:</b> support@support.whatsapp.com\n"
        "<b>Asunto:</b> Solicitud de revisión de una cuenta posiblemente abusiva\n\n"
        "Hola, equipo de soporte:\n\n"
        f"Solicito una revisión de la cuenta asociada al número <code>{escape(phone)}</code>. "
        "A continuación describo únicamente hechos que he observado directamente y que puedo respaldar.\n\n"
        "<b>Descripción factual:</b>\n"
        "[Indica qué ocurrió, cuándo ocurrió y en qué conversación o contexto.]\n\n"
        "<b>Conducta observada:</b>\n"
        "[Incluye solo categorías aplicables y verificables: spam no solicitado, fraude, "
        "suplantación, amenazas, acoso, malware, contenido ilegal o vulneración de privacidad.]\n\n"
        "<b>Pruebas disponibles:</b>\n"
        "[Enumera capturas, enlaces, identificadores de mensajes y fechas. No adjuntes datos "
        "personales de terceros que no sean necesarios.]\n\n"
        "Solicito que el equipo competente evalúe el caso conforme a sus políticas y adopte las "
        "medidas que correspondan. No solicito una sanción basada en rumores ni el procesamiento "
        "de reportes duplicados.\n\n"
        "Gracias,\n[Nombre y medio de contacto]\n\n"
        "<i>Revisa y corrige el borrador antes de enviarlo. Un reporte falso o masivo puede perjudicar "
        "a otras personas y contravenir las reglas de la plataforma.</i>"
    )


def unban_draft(phone: str) -> str:
    return header("APELACIÓN", phone) + (
        "<b>Para:</b> support@support.whatsapp.com\n"
        "<b>Asunto:</b> Solicitud de revisión de suspensión de cuenta\n\n"
        "Hola, equipo de soporte:\n\n"
        f"Solicito una revisión manual de la suspensión aplicada a la cuenta asociada al número "
        f"<code>{escape(phone)}</code>. Considero que la medida puede haberse producido por error "
        "o por una detección automatizada incorrecta.\n\n"
        "La persona titular afirma que no ha realizado conductas contrarias a las políticas de la "
        "plataforma. Para facilitar la comprobación, solicito que se indiquen, si es posible, la "
        "política activada, el intervalo temporal relevante y el mecanismo de revisión disponible.\n\n"
        "<b>Contexto que debe completar el titular:</b>\n"
        "[Fecha aproximada de la suspensión, mensaje mostrado por la aplicación, dispositivo y "
        "cualquier cambio reciente de acceso.]\n\n"
        "Me comprometo a cumplir las Condiciones del servicio y las políticas aplicables. Si la "
        "revisión confirma que la suspensión fue errónea, solicito la restauración de la cuenta. "
        "Si se confirma una infracción, agradeceré recibir información suficiente para corregirla "
        "mediante los canales oficiales.\n\n"
        "Atentamente,\n[Nombre del titular]\n[Correo de contacto]\n\n"
        "<i>Revisa los hechos, completa los campos y envía la apelación solo por un canal oficial. "
        "El bot no garantiza el desbloqueo ni contacta automáticamente con soporte.</i>"
    )


@router.message(CommandStart())
async def start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "<b>Centro de revisión BAN / UNBAN</b>\n\n"
        "Selecciona una función. Este bot crea un borrador para revisión humana; no envía "
        "reportes masivos ni acusa a nadie sin pruebas.",
        reply_markup=menu(),
    )


@router.callback_query(F.data == "flow:menu")
async def show_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    await callback.message.edit_text("Selecciona una función:", reply_markup=menu())


@router.callback_query(F.data == "flow:ban")
async def begin_ban(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(Flow.waiting_ban_phone)
    await callback.answer()
    await callback.message.edit_text(
        "<b>BAN · Reportar cuenta</b>\n\n"
        "Escribe el número internacional de la cuenta, incluyendo <b>+</b> y código de país.\n"
        "Ejemplo: <code>+14155552671</code>\n\n"
        "Solo genera reportes sobre hechos reales y verificables.",
        reply_markup=back_menu(),
    )


@router.callback_query(F.data == "flow:unban")
async def begin_unban(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(Flow.waiting_unban_phone)
    await callback.answer()
    await callback.message.edit_text(
        "<b>UNBAN · Apelar suspensión</b>\n\n"
        "Escribe el número internacional afectado, incluyendo <b>+</b> y código de país.\n"
        "Ejemplo: <code>+14155552671</code>",
        reply_markup=back_menu(),
    )


async def handle_phone(message: Message, state: FSMContext, kind: str) -> None:
    phone = normalize_phone(message.text or "")
    if not phone:
        await message.answer(
            "El formato no es válido. Usa E.164, por ejemplo <code>+14155552671</code>.",
            reply_markup=back_menu(),
        )
        return
    user_id = message.from_user.id if message.from_user else 0
    if not allowed(user_id):
        await message.answer("Has alcanzado el límite diario de borradores. Inténtalo mañana.")
        await state.clear()
        return
    await state.clear()
    draft = ban_draft(phone) if kind == "BAN" else unban_draft(phone)
    await message.answer(draft, reply_markup=menu())


@router.message(Flow.waiting_ban_phone)
async def receive_ban_phone(message: Message, state: FSMContext) -> None:
    await handle_phone(message, state, "BAN")


@router.message(Flow.waiting_unban_phone)
async def receive_unban_phone(message: Message, state: FSMContext) -> None:
    await handle_phone(message, state, "UNBAN")


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Operación cancelada.", reply_markup=menu())


async def main() -> None:
    token = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Falta BOT_TOKEN o TELEGRAM_BOT_TOKEN en el entorno")
    bot = Bot(token=token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    try:
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
