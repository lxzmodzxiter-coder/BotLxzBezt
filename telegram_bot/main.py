"""Bot de Telegram para buscar y curar videos de YouTube y TikTok.

El bot usa aiogram 3.x, FSM, SQLite, cooldown por usuario y búsquedas
asíncronas. YouTube se consulta mediante yt-dlp y TikTok mediante resultados
públicos de búsqueda web; no se descargan videos ni se automatiza el acceso a
cuentas privadas.
"""

from __future__ import annotations

import asyncio
import html
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import aiohttp
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from yt_dlp import YoutubeDL

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
DB_PATH = Path(os.getenv("SQLITE_PATH", "bot_database.db"))
COOLDOWN_SECONDS = max(0, int(os.getenv("COOLDOWN_SECONDS", "15")))
RESULTS_PER_PLATFORM = 10
SEARCH_TIMEOUT_SECONDS = max(5, int(os.getenv("SEARCH_TIMEOUT_SECONDS", "30")))
ADMIN_USER_IDS = {
    int(value.strip())
    for value in os.getenv("ADMIN_USER_IDS", "").split(",")
    if value.strip().isdigit()
}


@dataclass(slots=True)
class VideoResult:
    platform: str
    title: str
    url: str
    author: str = "No disponible"
    views: str = "No disponible"
    description: str = ""


class SearchState(StatesGroup):
    waiting_youtube_query = State()
    waiting_tiktok_query = State()
    waiting_both_query = State()


class SearchDatabase:
    """Persistencia SQLite sin bloquear el event loop."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        import sqlite3

        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS searches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    username TEXT,
                    platform TEXT NOT NULL CHECK(platform IN ('YouTube', 'TikTok', 'Ambos')),
                    search_query TEXT NOT NULL,
                    timestamp TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_searches_user_time
                    ON searches(user_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_searches_platform
                    ON searches(platform);
                """
            )

    def _last_search_timestamp(self, user_id: int) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT timestamp FROM searches WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
        return row["timestamp"] if row else None

    async def cooldown_remaining(self, user_id: int) -> int:
        timestamp = await asyncio.to_thread(self._last_search_timestamp, user_id)
        if not timestamp:
            return 0
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp)).total_seconds()
        return max(0, int(COOLDOWN_SECONDS - elapsed))

    def _record(self, user_id: int, username: str | None, platform: str, query: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO searches(user_id, username, platform, search_query, timestamp) VALUES (?, ?, ?, ?, ?)",
                (user_id, username, platform, query, datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()

    async def record(self, user_id: int, username: str | None, platform: str, query: str) -> None:
        await asyncio.to_thread(self._record, user_id, username, platform, query)

    def _stats(self) -> tuple[int, dict[str, int]]:
        with self._connect() as connection:
            total = connection.execute("SELECT COUNT(*) FROM searches").fetchone()[0]
            rows = connection.execute(
                "SELECT platform, COUNT(*) AS count FROM searches GROUP BY platform"
            ).fetchall()
        return total, {row["platform"]: row["count"] for row in rows}

    async def stats(self) -> tuple[int, dict[str, int]]:
        return await asyncio.to_thread(self._stats)


database = SearchDatabase(DB_PATH)
router = Router()
search_semaphore = asyncio.Semaphore(max(1, int(os.getenv("MAX_CONCURRENT_SEARCHES", "4"))))
user_locks: dict[int, asyncio.Lock] = {}


def main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📺 YouTube", callback_data="search:youtube")],
            [InlineKeyboardButton(text="🎵 TikTok", callback_data="search:tiktok")],
            [InlineKeyboardButton(text="⚡ Ambos (multiplataforma)", callback_data="search:both")],
        ]
    )


def cancel_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="⬅️ Volver al menú", callback_data="search:menu")]]
    )


def clean_text(value: Any, fallback: str = "No disponible") -> str:
    text = str(value or "").strip()
    return text if text else fallback


def search_youtube_sync(query: str) -> list[VideoResult]:
    options = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "ignoreerrors": True,
        "noplaylist": True,
        "socket_timeout": SEARCH_TIMEOUT_SECONDS,
    }
    results: list[VideoResult] = []
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(f"ytsearch{RESULTS_PER_PLATFORM}:{query}", download=False)
    for entry in (info or {}).get("entries", []) if isinstance(info, dict) else []:
        if not entry:
            continue
        video_id = entry.get("id")
        url = entry.get("webpage_url") or (f"https://www.youtube.com/watch?v={video_id}" if video_id else "")
        if not url:
            continue
        results.append(
            VideoResult(
                platform="YouTube",
                title=clean_text(entry.get("title")),
                url=url,
                author=clean_text(entry.get("channel") or entry.get("uploader")),
                views=clean_text(entry.get("view_count"), "No disponible"),
                description=clean_text(entry.get("description"), ""),
            )
        )
    return results[:RESULTS_PER_PLATFORM]


async def search_youtube(query: str) -> list[VideoResult]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(search_youtube_sync, query), SEARCH_TIMEOUT_SECONDS)
    except Exception:
        logger.exception("Error buscando en YouTube")
        return []


def unwrap_duckduckgo_url(url: str) -> str:
    parsed = urlparse(url)
    target = parse_qs(parsed.query).get("uddg", [""])[0]
    return unquote(target) if target else url


async def search_tiktok(query: str) -> list[VideoResult]:
    """Busca enlaces públicos indexados; TikTok no ofrece una API pública de búsqueda general."""
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(f'site:tiktok.com {query}') }"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; VideoCuratorBot/1.0)"}
    results: list[VideoResult] = []
    try:
        timeout = aiohttp.ClientTimeout(total=SEARCH_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(search_url) as response:
                response.raise_for_status()
                markup = await response.text()
        soup = BeautifulSoup(markup, "html.parser")
        seen: set[str] = set()
        for anchor in soup.select("a.result__a"):
            url = unwrap_duckduckgo_url(anchor.get("href", ""))
            if "tiktok.com/" not in url or "/video/" not in url or url in seen:
                continue
            seen.add(url)
            container = anchor.find_parent(class_="result")
            snippet = container.select_one(".result__snippet") if container else None
            results.append(
                VideoResult(
                    platform="TikTok",
                    title=clean_text(anchor.get_text(" ", strip=True)),
                    url=url,
                    author="No disponible",
                    description=clean_text(snippet.get_text(" ", strip=True) if snippet else "", ""),
                )
            )
            if len(results) >= RESULTS_PER_PLATFORM:
                break
    except Exception:
        logger.exception("Error buscando en TikTok")
    return results


def format_views(value: str) -> str:
    if value == "No disponible" or not value.isdigit():
        return value
    return f"{int(value):,}"


def render_result(result: VideoResult, index: int) -> str:
    details = f"Autor: {html.escape(result.author)}"
    if result.platform == "YouTube":
        details += f"\nVisualizaciones: {html.escape(format_views(result.views))}"
    description = f"\nDescripción: {html.escape(result.description[:220])}" if result.description else ""
    return (
        f"<b>{index}. [{html.escape(result.platform)}] {html.escape(result.title[:240])}</b>\n"
        f"{details}{description}\n"
        f"<a href=\"{html.escape(result.url, quote=True)}\">Abrir video</a>"
    )


def split_messages(text: str, limit: int = 3900) -> list[str]:
    chunks: list[str] = []
    current = ""
    for block in text.split("\n\n"):
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) > limit and current:
            chunks.append(current)
            current = block
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


async def send_results(message: Message, platform: str, query: str) -> None:
    async with search_semaphore:
        if platform == "YouTube":
            results = await search_youtube(query)
        elif platform == "TikTok":
            results = await search_tiktok(query)
        else:
            youtube, tiktok = await asyncio.gather(search_youtube(query), search_tiktok(query))
            # En modo mixto se equilibran ambas fuentes y se completa con los sobrantes disponibles.
            results = youtube[:5] + tiktok[:5]
            results += (youtube[5:] + tiktok[5:])[: RESULTS_PER_PLATFORM - len(results)]
    if not results:
        await message.answer(
            "No se encontraron resultados públicos para esa consulta. Prueba con otras palabras clave.",
            reply_markup=main_menu(),
        )
        return
    header = f"<b>Resultados para:</b> <i>{html.escape(query)}</i>\n<b>Plataforma:</b> {html.escape(platform)}\n\n"
    body = "\n\n".join(render_result(item, index) for index, item in enumerate(results, 1))
    for chunk in split_messages(header + body):
        await message.answer(chunk, disable_web_page_preview=True)
    await message.answer("Puedes realizar otra búsqueda desde el menú.", reply_markup=main_menu())


@router.message(CommandStart())
async def start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(
        "<b>Curador multimedia</b>\n\n"
        "Busca videos públicos por tema o palabra clave. Elige una plataforma para comenzar:",
        reply_markup=main_menu(),
    )


@router.message(Command("stats"))
async def stats(message: Message) -> None:
    user_id = message.from_user.id if message.from_user else 0
    if ADMIN_USER_IDS and user_id not in ADMIN_USER_IDS:
        await message.answer("No tienes permisos para consultar las estadísticas.")
        return
    total, counts = await database.stats()
    await message.answer(
        "<b>Estadísticas de búsquedas</b>\n\n"
        f"Total histórico: <b>{total}</b>\n"
        f"YouTube: <b>{counts.get('YouTube', 0)}</b>\n"
        f"TikTok: <b>{counts.get('TikTok', 0)}</b>\n"
        f"Ambos: <b>{counts.get('Ambos', 0)}</b>",
        reply_markup=main_menu(),
    )


@router.callback_query(F.data == "search:menu")
async def menu_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Selecciona una plataforma:", reply_markup=main_menu())


@router.callback_query(F.data.startswith("search:"))
async def begin_search(callback: CallbackQuery, state: FSMContext) -> None:
    platform = callback.data.split(":", 1)[1]
    states = {"youtube": SearchState.waiting_youtube_query, "tiktok": SearchState.waiting_tiktok_query, "both": SearchState.waiting_both_query}
    labels = {"youtube": "YouTube", "tiktok": "TikTok", "both": "YouTube y TikTok"}
    await state.set_state(states[platform])
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            f"<b>Búsqueda en {labels[platform]}</b>\n\nEscribe un tema o palabra clave (entre 2 y 200 caracteres).\nUsa /cancel para salir.",
            reply_markup=cancel_menu(),
        )


async def process_query(message: Message, state: FSMContext, platform: str) -> None:
    query = (message.text or "").strip()
    if not 2 <= len(query) <= 200:
        await message.answer("La consulta debe tener entre 2 y 200 caracteres.", reply_markup=cancel_menu())
        return
    user = message.from_user
    if not user:
        await message.answer("No se pudo identificar tu cuenta de Telegram.")
        return
    lock = user_locks.setdefault(user.id, asyncio.Lock())
    async with lock:
        remaining = await database.cooldown_remaining(user.id)
        if remaining:
            await message.answer(f"Espera {remaining} segundos antes de realizar otra búsqueda.", reply_markup=main_menu())
            await state.clear()
            return
        await message.answer("Buscando resultados públicos; esto puede tardar unos segundos…")
        await database.record(user.id, user.username, platform, query)
        await state.clear()
        await send_results(message, platform, query)


@router.message(SearchState.waiting_youtube_query)
async def youtube_query(message: Message, state: FSMContext) -> None:
    await process_query(message, state, "YouTube")


@router.message(SearchState.waiting_tiktok_query)
async def tiktok_query(message: Message, state: FSMContext) -> None:
    await process_query(message, state, "TikTok")


@router.message(SearchState.waiting_both_query)
async def both_query(message: Message, state: FSMContext) -> None:
    await process_query(message, state, "Ambos")


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Búsqueda cancelada.", reply_markup=main_menu())


async def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("Falta BOT_TOKEN o TELEGRAM_BOT_TOKEN en el entorno")
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    try:
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
