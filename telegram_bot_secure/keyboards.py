from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

CATEGORIES = (
    "RENIEC", "SUNAT", "VEHÍCULOS", "TELEFONÍA", "SUNARP", "FAMILIARES",
    "SEEKER", "FINANCIERA", "SPAM", "POLICÍA", "VOUCHER", "SEGUROS",
    "ANTECEDENTES", "ACTAS", "VIPS", "RECETA", "DESCANSOS", "EXTRAS",
    "MIGRACIÓN", "GENERADORES", "RESPALDOS", "FACIAL",
)


def home_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Categorías", callback_data="menu:categories:0")],
        [InlineKeyboardButton(text="Mi perfil", callback_data="menu:profile")],
        [InlineKeyboardButton(text="Privacidad y ayuda", callback_data="menu:help")],
    ])


def category_keyboard(page: int = 0, page_size: int = 6) -> InlineKeyboardMarkup:
    start = page * page_size
    page_items = CATEGORIES[start:start + page_size]
    rows = [[InlineKeyboardButton(text=item, callback_data=f"category:{item}")] for item in page_items]
    nav: list[InlineKeyboardButton] = []
    if page > 0:
        nav.append(InlineKeyboardButton(text="Anterior", callback_data=f"menu:categories:{page - 1}"))
    if start + page_size < len(CATEGORIES):
        nav.append(InlineKeyboardButton(text="Siguiente", callback_data=f"menu:categories:{page + 1}"))
    if nav:
        rows.append(nav)
    rows.append([InlineKeyboardButton(text="Inicio", callback_data="menu:home")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def service_keyboard(category: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Consultar demo segura", callback_data=f"demo:{category}")],
        [InlineKeyboardButton(text="Volver a categorías", callback_data="menu:categories:0")],
    ])
