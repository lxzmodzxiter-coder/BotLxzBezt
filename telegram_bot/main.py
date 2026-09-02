"""Bot Telegram BAN/UNBAN seguro con SQLite.

El bot genera borradores para revisión humana. No envía correos, no llama a
WhatsApp, no realiza reportes masivos y no presenta acusaciones no verificadas
como hechos.
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

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
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "60"))
DB_PATH = Path(os.getenv("SQLITE_PATH", "telegram_bot.sqlite3"))


class Flow(StatesGroup):
    waiting_ban_phone = State()
    waiting_unban_phone = State()


class OperationDB:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS operations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    username TEXT,
                    action TEXT NOT NULL CHECK(action IN ('BAN', 'UNBAN')),
                    phone TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_operations_action ON operations(action);
                CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at);
                """
            )

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def cooldown_remaining(self, user_id: int) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT created_at FROM operations WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
        if row is None:
            return 0
        last = datetime.fromisoformat(row["created_at"])
        elapsed = (datetime.now(timezone.utc) - last).total_seconds()
        return max(0, int(COOLDOWN_SECONDS - elapsed))

    def record(self, user_id: int, username: str | None, action: str, phone: str) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO operations(user_id, username, action, phone, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, username, action, phone, timestamp),
            )
            conn.commit()

    def stats(self) -> tuple[int, int, int]:
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM operations").fetchone()[0]
            ban = conn.execute("SELECT COUNT(*) FROM operations WHERE action = 'BAN'").fetchone()[0]
            unban = conn.execute("SELECT COUNT(*) FROM operations WHERE action = 'UNBAN'").fetchone()[0]
        return total, ban, unban


database = OperationDB(DB_PATH)
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
    compact = re.sub(r"[\s().-]", "", value.strip())
    return compact if PHONE_RE.fullmatch(compact) else None


def header(kind: str, phone: str) -> str:
    safe_phone = html.escape(phone)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"<b>BORRADOR DE {kind}</b>\nNúmero afectado: <code>{safe_phone}</code>\nGenerado: {now}\n\n"


def ban_draft(phone: str) -> str:
    return header("REPORTE", phone) + (
        "<b>Para:</b> support@support.whatsapp.com\n"
        "<b>Asunto:</b> Solicitud de revisión de una cuenta posiblemente abusiva\n\n"
        "Hola, equipo de soporte:\n\n"
        f"Solicito una revisión de la cuenta asociada al número <code>{html.escape(phone)}</code>. "
        "Describo únicamente hechos que he observado directamente y que puedo respaldar.\n\n"
        "<b>Descripción factual:</b>\n"
        "[Indica qué ocurrió, cuándo ocurrió y en qué conversación o contexto.]\n\n"
        "<b>Categoría aplicable, si corresponde:</b>\n"
        "[Spam no solicitado, fraude, suplantación, amenazas, acoso, malware, contenido ilegal "
        "o vulneración de privacidad. Selecciona solo lo que puedas demostrar.]\n\n"
        "<b>Pruebas disponibles:</b>\n"
        "[Enumera capturas, enlaces, identificadores de mensajes y fechas. No adjuntes datos "
        "personales de terceros que no sean necesarios.]\n\n"
        "Solicito que el equipo competente evalúe el caso conforme a sus políticas y adopte las "
        "medidas que correspondan. No solicito una sanción basada en rumores ni reportes duplicados.\n\n"
        "Gracias,\n[Nombre y medio de contacto]\n\n"
        "<i>Revisa y corrige el borrador antes de enviarlo. El bot no lo envía automáticamente.</i>"
    )


def unban_draft(phone: str) -> str:
    return header("APELACIÓN", phone) + (
        "<b>Para:</b> support@support.whatsapp.com\n"
        "<b>Asunto:</b> Solicitud de revisión de suspensión de cuenta\n\n"
        "Hola, equipo de soporte:\n\n"
        f"Solicito una revisión manual de la suspensión aplicada a la cuenta asociada al número "
        f"<code>{html.escape(phone)}</code>. Considero que la medida puede haberse producido por "
        "error o por una detección automatizada incorrecta.\n\n"
        "La persona titular afirma que no ha realizado conductas contrarias a las políticas de la "
        "plataforma. Solicito que se indique, si es posible, la política activada, el intervalo "
        "temporal relevante y el mecanismo de revisión disponible.\n\n"
        "<b>Contexto que debe completar el titular:</b>\n"
        "[Fecha aproximada de la suspensión, mensaje mostrado por la aplicación, dispositivo y "
        "cambios recientes de acceso.]\n\n"
        "Me comprometo a cumplir las Condiciones del servicio y las políticas aplicables. Si la "
        "revisión confirma que la suspensión fue errónea, solicito la restauración de la cuenta.\n\n"
        "Atentamente,\n[Nombre del titular]\n[Correo de contacto]\n\n"
        "<i>Revisa los hechos y envía la apelación solo por un canal oficial. El bot no garantiza "
        "el desbloqueo ni contacta automáticamente con soporte.</i>"
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


@router.message(Command("stats"))
async def stats(message: Message) -> None:
    total, ban, unban = database.stats()
    await message.answer(
        "<b>Estadísticas del bot</b>\n\n"
        f"Operaciones registradas: <b>{total}</b>\n"
        f"Borradores BAN: <b>{ban}</b>\n"
        f"Borradores UNBAN: <b>{unban}</b>\n\n"
        "Estas cifras representan borradores generados, no reportes enviados ni cuentas sancionadas.",
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
        "Escribe el número internacional incluyendo <b>+</b> y código de país.\n"
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
        "Escribe el número internacional afectado incluyendo <b>+</b> y código de país.\n"
        "Ejemplo: <code>+14155552671</code>",
        reply_markup=back_menu(),
    )


async def handle_phone(message: Message, state: FSMContext, action: str) -> None:
    phone = normalize_phone(message.text or "")
    if not phone:
        await message.answer(
            "El formato no es válido. Usa E.164, por ejemplo <code>+14155552671</code>.",
            reply_markup=back_menu(),
        )
        return
    user = message.from_user
    if user is None:
        await message.answer("No se pudo identificar al usuario de Telegram.")
        return
    remaining = database.cooldown_remaining(user.id)
    if remaining:
        await message.answer(f"Espera {remaining} segundos antes de crear otro borrador.")
        await state.clear()
        return
    database.record(user.id, user.username, action, phone)
    await state.clear()
    draft = ban_draft(phone) if action == "BAN" else unban_draft(phone)
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
