from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Account:
    user_id: int
    role: str
    credits: int
    active: bool


class CreditStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_sync()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _init_sync(self) -> None:
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS accounts (
                    user_id INTEGER PRIMARY KEY,
                    role TEXT NOT NULL DEFAULT 'FREE' CHECK(role IN ('FREE','VIP','ADMIN')),
                    credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0),
                    active INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS credit_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('TOPUP','CONSUME','REFUND')),
                    reference TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES accounts(user_id)
                );
            """)

    def _ensure_user_sync(self, user_id: int) -> Account:
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO accounts(user_id) VALUES (?)", (user_id,))
            row = db.execute("SELECT user_id, role, credits, active FROM accounts WHERE user_id=?", (user_id,)).fetchone()
        return Account(row["user_id"], row["role"], row["credits"], bool(row["active"]))

    async def ensure_user(self, user_id: int) -> Account:
        return await asyncio.to_thread(self._ensure_user_sync, user_id)

    def _apply_transaction_sync(self, key: str, user_id: int, amount: int, kind: str, reference: str) -> bool:
        if not key or amount == 0 or kind not in {"TOPUP", "CONSUME", "REFUND"}:
            raise ValueError("Transacción inválida")
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO accounts(user_id) VALUES (?)", (user_id,))
            if db.execute("SELECT 1 FROM credit_transactions WHERE idempotency_key=?", (key,)).fetchone():
                return False
            if kind == "CONSUME":
                updated = db.execute("UPDATE accounts SET credits=credits-? WHERE user_id=? AND credits>=?", (amount, user_id, amount)).rowcount
                if updated != 1:
                    raise ValueError("Saldo insuficiente")
            else:
                db.execute("UPDATE accounts SET credits=credits+? WHERE user_id=?", (abs(amount), user_id))
            db.execute("INSERT INTO credit_transactions(idempotency_key,user_id,amount,kind,reference) VALUES (?,?,?,?,?)", (key, user_id, abs(amount), kind, reference))
            return True

    async def apply_transaction(self, key: str, user_id: int, amount: int, kind: str, reference: str) -> bool:
        return await asyncio.to_thread(self._apply_transaction_sync, key, user_id, amount, kind, reference)
