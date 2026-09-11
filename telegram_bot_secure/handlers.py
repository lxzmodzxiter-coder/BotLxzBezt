from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from .keyboards import CATEGORIES, category_keyboard, home_keyboard, service_keyboard
from .security import AbuseGuard, validate_query
from .services import ProviderClient

logger = logging.getLogger(__name__)
router = Router()


class DemoState(StatesGroup):
    waiting_query = State()


@router.message(CommandStart())
async def start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Bot modular seguro de servicios. Elige una opción; el modo predeterminado usa datos sintéticos.", reply_markup=home_keyboard())


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Operación cancelada.", reply_markup=home_keyboard())


@router.callback_query(F.data == "menu:home")
async def home(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Menú principal", reply_markup=home_keyboard())


@router.callback_query(F.data.startswith("menu:categories:"))
async def categories(callback: CallbackQuery) -> None:
    page = int(callback.data.rsplit(":", 1)[1])
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Categorías disponibles. Las funciones sensibles están deshabilitadas por defecto.", reply_markup=category_keyboard(page))


@router.callback_query(F.data == "menu:profile")
async def profile(callback: CallbackQuery) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Perfil local: no se almacenan datos de identidad ni saldos reales en esta plantilla.", reply_markup=home_keyboard())


@router.callback_query(F.data == "menu:help")
async def help_menu(callback: CallbackQuery) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Privacidad: usa solo datos sintéticos y proveedores autorizados. No envíes DNI, huellas, firmas, domicilios, placas ni documentos reales.", reply_markup=home_keyboard())


@router.callback_query(F.data.startswith("category:"))
async def category(callback: CallbackQuery) -> None:
    category_name = callback.data.split(":", 1)[1]
    if category_name not in CATEGORIES:
        await callback.answer("Categoría no válida", show_alert=True)
        return
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(f"Módulo: {category_name}\n\nLa integración real requiere autorización documentada y una API allowlisted.", reply_markup=service_keyboard(category_name))


@router.callback_query(F.data.startswith("demo:"))
async def demo_start(callback: CallbackQuery, state: FSMContext) -> None:
    category_name = callback.data.split(":", 1)[1]
    await state.update_data(service=category_name)
    await state.set_state(DemoState.waiting_query)
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Escribe una consulta sintética, por ejemplo: DEMO-001. No envíes datos personales.")


@router.message(DemoState.waiting_query)
async def demo_query(message: Message, state: FSMContext, guard: AbuseGuard, provider: ProviderClient) -> None:
    user_id = message.from_user.id if message.from_user else 0
    allowed, remaining = guard.allow(user_id)
    if not allowed:
        await message.answer(f"Espera {remaining} segundos antes de volver a intentarlo.")
        return
    try:
        query = validate_query(message.text or "")
    except ValueError as exc:
        await message.answer(str(exc))
        return
    data = await state.get_data()
    result = await provider.consult(str(data.get("service", "GENERAL")), query)
    await state.clear()
    await message.answer(f"Servicio: {result.service}\nEstado: {result.status}\n{result.message}\nReferencia: {result.reference}", reply_markup=home_keyboard())
