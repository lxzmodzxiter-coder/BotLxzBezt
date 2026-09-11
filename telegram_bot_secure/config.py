from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _csv(value: str) -> frozenset[str]:
    return frozenset(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    bot_token: str
    owner_id: int
    db_path: Path
    log_level: str
    admin_user_ids: frozenset[int]
    allowed_provider_hosts: frozenset[str]
    provider_base_url: str | None
    provider_token: str | None
    demo_mode: bool
    max_request_bytes: int
    request_timeout_seconds: float
    per_user_cooldown_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.getenv("BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError("BOT_TOKEN es obligatorio")
        owner_raw = os.getenv("OWNER_ID", "0").strip()
        owner_id = int(owner_raw) if owner_raw.isdigit() else 0
        admin_ids = frozenset(int(x) for x in _csv(os.getenv("ADMIN_USER_IDS", "")) if x.isdigit())
        if owner_id > 0:
            admin_ids = admin_ids | {owner_id}
        base_url = os.getenv("PROVIDER_BASE_URL", "").strip() or None
        return cls(
            bot_token=token,
            owner_id=owner_id,
            db_path=Path(os.getenv("SQLITE_PATH", "bot_secure.db")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            admin_user_ids=admin_ids,
            allowed_provider_hosts=_csv(os.getenv("ALLOWED_PROVIDER_HOSTS", "")),
            provider_base_url=base_url,
            provider_token=os.getenv("PROVIDER_TOKEN", "").strip() or None,
            demo_mode=os.getenv("DEMO_MODE", "true").lower() == "true",
            max_request_bytes=max(1024, int(os.getenv("MAX_REQUEST_BYTES", "262144"))),
            request_timeout_seconds=max(3.0, float(os.getenv("REQUEST_TIMEOUT_SECONDS", "10"))),
            per_user_cooldown_seconds=max(0, int(os.getenv("PER_USER_COOLDOWN_SECONDS", "3"))),
        )
