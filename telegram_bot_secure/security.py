from __future__ import annotations

import re
import time
from collections import defaultdict
from urllib.parse import urlparse

from .config import Settings


SENSITIVE_MODULES = frozenset({"RENIEC", "FAMILIARES", "ANTECEDENTES", "FINANCIERA", "MIGRACIÓN", "FACIAL"})


class AbuseGuard:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._last_request: dict[int, float] = defaultdict(float)

    def allow(self, user_id: int) -> tuple[bool, int]:
        now = time.monotonic()
        remaining = int(self.settings.per_user_cooldown_seconds - (now - self._last_request[user_id]))
        if remaining > 0:
            return False, remaining
        self._last_request[user_id] = now
        return True, 0


def validate_query(value: str) -> str:
    if any(ord(ch) < 32 for ch in value):
        raise ValueError("La consulta contiene caracteres no permitidos.")
    value = re.sub(r"\s+", " ", value.strip())
    if not 2 <= len(value) <= 120:
        raise ValueError("La consulta debe tener entre 2 y 120 caracteres.")
    return value


def host_is_allowed(base_url: str, allowed_hosts: frozenset[str]) -> bool:
    parsed = urlparse(base_url)
    return parsed.scheme == "https" and bool(parsed.hostname) and parsed.hostname in allowed_hosts


def redact(value: str, limit: int = 500) -> str:
    return value.replace("\n", " ").replace("\r", " ")[:limit]
