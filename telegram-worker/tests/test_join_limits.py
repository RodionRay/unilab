"""PEER_FLOOD / CHANNELS_TOO_MUCH при вступлении → явные коды, аккаунт на паузе, группа не виновата.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.errors import ChannelsTooMuchError, PeerFloodError  # noqa: E402
from telethon.tl.functions.channels import JoinChannelRequest  # noqa: E402


class FakeEntity:
    id = 42
    access_hash = 7
    title = "Test chat"
    username = "test_chat_limits"


class JoinFailsClient:
    """Resolves the group, is not a member, JoinChannel raises `exc`."""

    def __init__(self, exc: BaseException) -> None:
        self.exc = exc

    async def iter_dialogs(self, limit: int = 0):
        return
        yield  # pragma: no cover

    async def get_entity(self, value):
        return FakeEntity()

    async def get_permissions(self, entity, user=None):
        raise ValueError("not a participant")

    async def __call__(self, request):
        if isinstance(request, JoinChannelRequest):
            raise self.exc
        raise ValueError("not a participant")


class JoinLimitTests(unittest.TestCase):
    def test_classifies_peer_flood_and_channels_too_much(self) -> None:
        peer = ca.join_limit_error(PeerFloodError(request=None))
        many = ca.join_limit_error(ChannelsTooMuchError(request=None))
        self.assertEqual(peer and peer["join"], "peer_flood")
        self.assertEqual(peer and peer["status"], "spamblock")
        self.assertIn("PEER_FLOOD", peer["error"] if peer else "")
        self.assertEqual(many and many["join"], "too_many")
        self.assertIn("CHANNELS_TOO_MUCH", many["error"] if many else "")
        self.assertIsNone(ca.join_limit_error(ValueError("other")))

    def test_join_group_returns_code_instead_of_raising(self) -> None:
        for exc, code in ((PeerFloodError(request=None), "peer_flood"), (ChannelsTooMuchError(request=None), "too_many")):
            res = asyncio.run(ca.join_group(JoinFailsClient(exc), "https://t.me/test_chat_limits"))
            self.assertFalse(res["ok"])
            self.assertEqual(res["join"], code)


if __name__ == "__main__":
    unittest.main()
