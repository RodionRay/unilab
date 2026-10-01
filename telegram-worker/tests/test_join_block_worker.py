"""Слот, который не может проверить себя или слеп, не штрафует группу и не вступает при запрете.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.errors import FloodWaitError, UsernameNotOccupiedError  # noqa: E402
from telethon.tl.functions.channels import GetFullChannelRequest, JoinChannelRequest  # noqa: E402
from telethon.tl.functions.contacts import ResolveUsernameRequest  # noqa: E402


class MissingGroupClient:
    """@group не резолвится; контрольный @telegram падает заданной ошибкой."""

    def __init__(self, control_error: Exception) -> None:
        self.control_error = control_error

    async def iter_dialogs(self, limit: int = 0):
        return
        yield  # pragma: no cover

    async def get_entity(self, value):
        raise ValueError(f'No user has "{value}" as username')

    async def __call__(self, request):
        if isinstance(request, ResolveUsernameRequest):
            raise self.control_error
        raise RuntimeError("search unavailable")

    async def disconnect(self) -> None:
        return None


class ControlUnknownTest(unittest.IsolatedAsyncioTestCase):
    async def test_flood_on_control_resolve_does_not_blame_the_group(self) -> None:
        res = await ca.join_group(MissingGroupClient(FloodWaitError(request=None, capture=60)), "https://t.me/live_chat")

        self.assertFalse(res["ok"])
        self.assertTrue(res["controlUnknown"])
        self.assertFalse(res["usernameMissing"])
        self.assertFalse(res["accountBlind"])

    async def test_scan_passes_blind_verdict_through(self) -> None:
        client = MissingGroupClient(UsernameNotOccupiedError(request=None))

        res = await ca.scan_group(client, "https://t.me/live_chat", ["crm"], [])

        self.assertTrue(res["accountBlind"])

    async def test_scan_passes_unknown_control_through(self) -> None:
        client = MissingGroupClient(FloodWaitError(request=None, capture=60))

        res = await ca.scan_group(client, "https://t.me/live_chat", ["crm"], [])

        self.assertTrue(res["controlUnknown"])
        self.assertFalse(res["usernameMissing"])


class DiscussionClient:
    """Канал с обсуждением, в котором слот не состоит."""

    def __init__(self) -> None:
        self.channel = SimpleNamespace(id=1, broadcast=True, megagroup=False, title="Канал", username="chan")
        self.linked = SimpleNamespace(id=2, broadcast=False, megagroup=True, title="Обсуждение", username="")
        self.joins = 0

    async def iter_dialogs(self, limit: int = 0):
        return
        yield  # pragma: no cover

    async def get_entity(self, value):
        return self.linked if value == 2 else self.channel

    async def iter_messages(self, entity, **kwargs):
        return
        yield  # pragma: no cover

    async def __call__(self, request):
        if isinstance(request, GetFullChannelRequest):
            return SimpleNamespace(full_chat=SimpleNamespace(linked_chat_id=2))
        if isinstance(request, JoinChannelRequest):
            self.joins += 1
            return object()
        raise RuntimeError(f"unexpected {type(request).__name__}")

    async def disconnect(self) -> None:
        return None


class ScanJoinGateTest(unittest.IsolatedAsyncioTestCase):
    async def test_blocked_account_never_joins_the_discussion(self) -> None:
        client = DiscussionClient()
        with mock.patch.object(ca, "_is_member", mock.AsyncMock(side_effect=[True, False])):
            res = await ca.scan_group(client, "https://t.me/chan_live", ["crm"], [], allow_join=False)

        self.assertEqual(client.joins, 0)
        self.assertEqual(res["join"], "need_join")

    async def test_run_action_forwards_allow_join(self) -> None:
        with mock.patch.object(ca, "open_client", mock.AsyncMock(return_value=DiscussionClient())), mock.patch.object(
            ca, "scan_group", mock.AsyncMock(return_value={"ok": True})
        ) as scan:
            await ca.run_action({"action": "scan", "url": "https://t.me/chan_live", "allowJoin": False})

        self.assertFalse(scan.await_args.kwargs["allow_join"])


if __name__ == "__main__":
    unittest.main()
