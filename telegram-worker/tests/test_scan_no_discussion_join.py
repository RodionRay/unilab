"""scan_group never joins a channel's linked discussion on its own (REQ-6: manual join only).

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.errors import UserNotParticipantError  # noqa: E402
from telethon.tl.functions.channels import (  # noqa: E402
    GetFullChannelRequest,
    GetParticipantRequest,
    JoinChannelRequest,
)

CHANNEL = SimpleNamespace(
    id=101, username="shop_news", title="Shop news", broadcast=True, megagroup=False
)
DISCUSSION = SimpleNamespace(
    id=202, username=None, title="Shop chat", broadcast=False, megagroup=True
)


class FakeClient:
    """Account is in the channel, not in its linked discussion chat."""

    def __init__(self) -> None:
        self.requests: list[object] = []

    async def iter_dialogs(self, limit: int = 0):
        yield SimpleNamespace(entity=CHANNEL)

    async def get_me(self):
        return SimpleNamespace(id=1)

    async def get_entity(self, value):
        if value == DISCUSSION.id:
            return DISCUSSION
        raise ValueError(f"unexpected get_entity({value!r})")

    async def iter_messages(self, *args, **kwargs):
        return
        yield  # pragma: no cover

    async def __call__(self, request):
        self.requests.append(request)
        if isinstance(request, GetParticipantRequest):
            if request.channel is DISCUSSION:
                raise UserNotParticipantError(request=request)
            return object()
        if isinstance(request, GetFullChannelRequest):
            return SimpleNamespace(full_chat=SimpleNamespace(linked_chat_id=DISCUSSION.id))
        if isinstance(request, JoinChannelRequest):
            return object()
        raise RuntimeError(f"unexpected request {type(request).__name__}")


class ScanNoDiscussionJoinTest(unittest.IsolatedAsyncioTestCase):
    async def test_unjoined_discussion_returns_need_join_without_joining(self) -> None:
        client = FakeClient()

        res = await ca.scan_group(client, "https://t.me/shop_news", ["crm"], [])

        joins = [r for r in client.requests if isinstance(r, JoinChannelRequest)]
        self.assertEqual(joins, [])
        self.assertFalse(res["ok"])
        self.assertEqual(res["join"], "need_join")
        self.assertTrue(res["needDiscussionJoin"])
        self.assertIn("Shop chat", res["error"])


if __name__ == "__main__":
    unittest.main()
