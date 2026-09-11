from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import aiohttp

from .config import Settings
from .security import host_is_allowed, redact

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ServiceResult:
    service: str
    status: str
    message: str
    reference: str


class ProviderClient:
    """Cliente deliberadamente restringido: solo endpoints HTTPS allowlisted y no PII por defecto."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def consult(self, service: str, query: str) -> ServiceResult:
        if self.settings.demo_mode:
            return ServiceResult(service, "demo", "Respuesta sintética de demostración; no se consultó ninguna base real.", "demo-local")
        base_url = self.settings.provider_base_url
        if not base_url or not host_is_allowed(base_url, self.settings.allowed_provider_hosts):
            raise RuntimeError("El proveedor no está configurado en la allowlist HTTPS.")
        headers = {"Accept": "application/json", "User-Agent": "PeruServiceBot/1.0"}
        if self.settings.provider_token:
            headers["Authorization"] = f"Bearer {self.settings.provider_token}"
        timeout = aiohttp.ClientTimeout(total=self.settings.request_timeout_seconds)
        payload = {"service": service, "query": query, "purpose": "demo-audit"}
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.post(f"{base_url.rstrip('/')}/v1/sandbox/consult", json=payload) as response:
                    raw = await response.content.read(self.settings.max_request_bytes + 1)
                    if len(raw) > self.settings.max_request_bytes:
                        raise RuntimeError("Respuesta del proveedor demasiado grande.")
                    if response.status >= 400:
                        logger.warning("Proveedor rechazó solicitud: status=%s body=%s", response.status, redact(raw.decode("utf-8", "replace")))
                        return ServiceResult(service, "rejected", "El proveedor rechazó la solicitud.", f"http-{response.status}")
                    data: Any = await response.json(content_type=None)
                    return ServiceResult(service, "ok", redact(str(data.get("message", "Respuesta recibida."))), redact(str(data.get("reference", "provider")), 80))
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.warning("Fallo controlado del proveedor: %s", type(exc).__name__)
            return ServiceResult(service, "unavailable", "El servicio no está disponible temporalmente.", "provider-unavailable")
