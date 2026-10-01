"""send_message: PEER_FLOOD is a spamblock, not a FloodWait (REQ-M1).

Run: <venv with telethon 1.36>/bin/python -m unittest discover -s telegram-worker/tests
Needs real telethon error/type classes; skipped when telethon is not installed.
"""
from __future__ import annotations

import asyncio
import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402

HAS_TELETHON = importlib.util.find_spec("telethon") is not None


class FakeClient:
    """Resolves @username to a user and fails SendMessage with the given error."""

    def __init__(self, error: Exception) -> None:
        from telethon.tl.types import User

        self.user = User(id=2001, access_hash=77, username="client_nick")
        self.error = error

    async def get_input_entity(self, ref: Any) -> Any:
        return self.user

    async def get_entity(self, ref: Any) -> Any:
        return self.user

    async def send_message(self, *args: Any, **kwargs: Any) -> Any:
        raise self.error


def send_dm(error: Exception) -> dict[str, Any]:
    return asyncio.run(
        ca.send_message(
            FakeClient(error),
            mode="dm",
            text="Привет",
            sender_id="2001",
            sender_username="client_nick",
        )
    )


@unittest.skipUnless(HAS_TELETHON, "telethon not installed")
class SendMessagePeerFloodTest(unittest.TestCase):
    def test_peer_flood_is_spamblock(self) -> None:
        from telethon.errors import PeerFloodError
        from telethon.tl.functions.messages import SendMessageRequest

        out = send_dm(PeerFloodError(request=SendMessageRequest(peer=None, message="x")))

        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "spamblock")
        self.assertIn("PEER_FLOOD", out["error"])
        self.assertNotIn("waitSec", out)

    def test_flood_wait_stays_flood(self) -> None:
        from telethon.errors import FloodWaitError

        out = send_dm(FloodWaitError(request=None, capture=120))

        self.assertEqual(out["status"], "flood")
        self.assertEqual(out["waitSec"], 120)


if __name__ == "__main__":
    unittest.main()
