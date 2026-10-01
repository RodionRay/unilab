"""join_group(target="discussion") joins only the channel's linked discussion chat.

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

URL = "https://t.me/shop_news"


def channel() -> SimpleNamespace:
    return SimpleNamespace(
        id=101, access_hash=11, username="shop_news", title="Shop news", broadcast=True, megagroup=False
    )


def discussion() -> SimpleNamespace:
    return SimpleNamespace(
        id=202, access_hash=22, username=None, title="Shop chat", broadcast=False, megagroup=True
    )


class FakeClient:
    def __init__(self, *, in_channel: bool = True, linked: bool = True) -> None:
        self.channel = channel()
        self.discussion = discussion()
        self.linked = linked
        self.member_of: set[int] = {self.channel.id} if in_channel else set()
        self.requests: list[object] = []

    async def iter_dialogs(self, limit: int = 0):
        yield SimpleNamespace(entity=self.channel)

    async def get_me(self):
        return SimpleNamespace(id=1)

    async def get_entity(self, value):
        if value == self.discussion.id:
            return self.discussion
        raise ValueError(f"unexpected get_entity({value!r})")

    async def __call__(self, request):
        self.requests.append(request)
        if isinstance(request, GetParticipantRequest):
            if request.channel.id in self.member_of:
                return object()
            raise UserNotParticipantError(request=request)
        if isinstance(request, GetFullChannelRequest):
            linked_id = self.discussion.id if self.linked else None
            return SimpleNamespace(full_chat=SimpleNamespace(linked_chat_id=linked_id))
        if isinstance(request, JoinChannelRequest):
            self.member_of.add(request.channel.id)
            return object()
        raise RuntimeError(f"unexpected request {type(request).__name__}")

    def joins(self) -> list[object]:
        return [r for r in self.requests if isinstance(r, JoinChannelRequest)]


class JoinDiscussionTest(unittest.IsolatedAsyncioTestCase):
    async def test_joins_only_the_linked_discussion(self) -> None:
        client = FakeClient()

        res = await ca.join_group(client, URL, target="discussion")

        self.assertEqual([j.channel for j in client.joins()], [client.discussion])
        self.assertTrue(res["ok"])
        self.assertEqual(res["join"], "joined")
        self.assertEqual(res["discussionId"], "202")
        self.assertNotIn("channelId", res)
        self.assertNotIn("accessHash", res)

    async def test_channel_without_discussion_makes_no_join(self) -> None:
        client = FakeClient(linked=False)

        res = await ca.join_group(client, URL, target="discussion")

        self.assertEqual(client.joins(), [])
        self.assertFalse(res["ok"])
        self.assertEqual(res["join"], "no_discussion")

    async def test_account_outside_the_channel_makes_no_join(self) -> None:
        client = FakeClient(in_channel=False)

        res = await ca.join_group(client, URL, target="discussion")

        self.assertEqual(client.joins(), [])
        self.assertFalse(res["ok"])
        self.assertEqual(res["join"], "need_join")

    async def test_megagroup_source_never_joins_its_linked_channel(self) -> None:
        client = FakeClient()
        client.channel.broadcast, client.channel.megagroup = False, True
        client.discussion.broadcast, client.discussion.megagroup = True, False

        res = await ca.join_group(client, URL, target="discussion")

        self.assertEqual(client.joins(), [])
        self.assertFalse(any(isinstance(r, GetFullChannelRequest) for r in client.requests))
        self.assertFalse(res["ok"])
        self.assertEqual(res["join"], "no_discussion")
        self.assertIn("не канал", res["error"])

    async def test_default_target_still_joins_the_channel(self) -> None:
        client = FakeClient(in_channel=False)

        res = await ca.join_group(client, URL)

        self.assertEqual([j.channel for j in client.joins()], [client.channel])
        self.assertEqual(res["join"], "joined")


if __name__ == "__main__":
    unittest.main()
