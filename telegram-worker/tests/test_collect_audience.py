"""collect_audience: RPC error classes, participants paging, message budget, t.me/c|s links.

REQ-A1, REQ-A5, REQ-A8, REQ-A9 (spec docs/project/specs/mvp-bugfix.md).
Run: <venv with Telethon 1.36>/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon import errors  # noqa: E402
from telethon.tl import types  # noqa: E402
from telethon.tl.functions.channels import GetParticipantsRequest  # noqa: E402

NOW = datetime(2026, 9, 30, tzinfo=timezone.utc)


def channel(**extra: Any) -> types.Channel:
    fields: dict[str, Any] = {"megagroup": True, "access_hash": 42, "username": "src_chat", **extra}
    return types.Channel(id=777, title="Src", photo=types.ChatPhotoEmpty(), date=NOW, **fields)


def user(uid: int) -> types.User:
    return types.User(id=uid, access_hash=uid * 10, first_name=f"U{uid}")


class FakeMessage:
    def __init__(self, mid: int, sender: types.User) -> None:
        self.id = mid
        self.date = NOW
        self._sender = sender

    async def get_sender(self) -> types.User:
        return self._sender


class FakeClient:
    """Channel with `members` visible via GetParticipantsRequest(offset); iter_participants restarts at 0."""

    def __init__(
        self,
        *,
        members: list[types.User] | None = None,
        total: int | None = None,
        messages: list[FakeMessage] | None = None,
        raise_on_resolve: BaseException | None = None,
        raise_on_participants: BaseException | None = None,
        raise_on_call: BaseException | None = None,
        entity: Any = None,
    ) -> None:
        self.members = members or []
        self.total = len(self.members) if total is None else total
        self.messages = messages or []
        self.raise_on_resolve = raise_on_resolve
        self.raise_on_participants = raise_on_participants
        self.raise_on_call = raise_on_call
        self.entity = entity if entity is not None else channel()
        self.participant_offsets: list[int] = []
        self.message_calls: list[dict[str, Any]] = []
        self.entity_lookups: list[Any] = []

    async def iter_dialogs(self, limit: int = 0):
        return
        yield  # pragma: no cover

    async def get_entity(self, value: Any) -> Any:
        self.entity_lookups.append(value)
        if self.raise_on_resolve is not None:
            raise self.raise_on_resolve
        return self.entity

    async def iter_participants(self, entity: Any, filter: Any = None, **_: Any):
        if filter is not None:
            return
        for m in self.members:
            yield m

    async def iter_messages(self, target: Any, limit: int = 0, offset_id: int = 0, **_: Any):
        self.message_calls.append({"limit": limit, "offset_id": offset_id})
        n = 0
        for msg in self.messages:
            if offset_id and msg.id >= offset_id:
                continue
            if n >= limit:
                return
            n += 1
            yield msg

    async def __call__(self, request: Any) -> Any:
        if isinstance(request, GetParticipantsRequest):
            if self.raise_on_participants is not None:
                raise self.raise_on_participants
            self.participant_offsets.append(request.offset)
            page = self.members[request.offset : request.offset + request.limit]
            return types.channels.ChannelParticipants(
                count=self.total,
                participants=[types.ChannelParticipant(user_id=u.id, date=NOW) for u in page],
                chats=[],
                users=list(page),
            )
        if self.raise_on_call is not None:
            raise self.raise_on_call
        raise RuntimeError(f"unexpected request {type(request).__name__}")


def payload(**extra: Any) -> dict[str, Any]:
    return {"url": "https://t.me/src_chat", "collectMode": "discussions", "batchSize": 20, **extra}


class RpcErrorClassificationTest(unittest.IsolatedAsyncioTestCase):
    """REQ-A1: an RPC error in collect is not a dead session."""

    async def test_flood_wait_returns_flood_with_wait_seconds(self) -> None:
        client = FakeClient(raise_on_participants=errors.FloodWaitError(request=None, capture=420))
        res = await ca.collect_audience(client, payload())
        self.assertEqual(res["status"], "flood")
        self.assertEqual(res["waitSec"], 420)
        self.assertFalse(res["ok"])

    async def test_private_channel_is_a_source_error(self) -> None:
        client = FakeClient(raise_on_participants=errors.ChannelPrivateError(request=None))
        res = await ca.collect_audience(client, payload())
        self.assertEqual(res["status"], "source_error")
        self.assertEqual(res["join"], "private")

    async def test_expired_invite_is_a_source_error(self) -> None:
        client = FakeClient(raise_on_call=errors.InviteHashExpiredError(request=None))
        res = await ca.collect_audience(client, payload(url="https://t.me/+AbCdEf123"))
        self.assertEqual(res["status"], "source_error")
        self.assertEqual(res["join"], "invite_invalid")

    async def test_revoked_session_is_unauthorized(self) -> None:
        client = FakeClient(raise_on_participants=errors.AuthKeyUnregisteredError(request=None))
        res = await ca.collect_audience(client, payload())
        self.assertEqual(res["status"], "unauthorized")

    async def test_telegram_server_error_is_transient(self) -> None:
        client = FakeClient(raise_on_participants=errors.RpcCallFailError(request=None))
        res = await ca.collect_audience(client, payload())
        self.assertEqual(res["status"], "transient")

    async def test_connection_drop_is_transient(self) -> None:
        client = FakeClient(raise_on_participants=ConnectionError("Connection to Telegram failed 5 time(s)"))
        res = await ca.collect_audience(client, payload())
        self.assertEqual(res["status"], "transient")


class ParticipantsPagingTest(unittest.IsolatedAsyncioTestCase):
    """REQ-A5: the cursor is a server offset; a tick does not re-read from 0."""

    async def test_second_batch_starts_at_the_saved_offset(self) -> None:
        client = FakeClient(members=[user(i) for i in range(1, 51)])
        first = await ca.collect_audience(client, payload())
        self.assertEqual([u["userId"] for u in first["users"]], [str(i) for i in range(1, 21)])
        self.assertTrue(first["hasMore"])
        self.assertEqual(first["cursor"], "20")

        client.participant_offsets.clear()
        second = await ca.collect_audience(client, payload(cursor=first["cursor"]))
        self.assertEqual(client.participant_offsets[0], 20)
        self.assertEqual([u["userId"] for u in second["users"]], [str(i) for i in range(21, 41)])

    async def test_end_of_list_stops(self) -> None:
        client = FakeClient(members=[user(i) for i in range(1, 6)])
        res = await ca.collect_audience(client, payload())
        self.assertEqual(len(res["users"]), 5)
        self.assertFalse(res["hasMore"])
        self.assertNotIn("warning", res)

    async def test_telegram_cap_is_reported_as_warning(self) -> None:
        client = FakeClient(members=[user(i) for i in range(1, 6)], total=25_000)
        res = await ca.collect_audience(client, payload())
        self.assertFalse(res["hasMore"])
        self.assertTrue(res["truncated"])
        self.assertIn("25000", res["warning"])


class MessageBudgetTest(unittest.IsolatedAsyncioTestCase):
    """REQ-A8: messageLimit counts messages over all ticks, not only the first batch."""

    def _client(self, n: int) -> FakeClient:
        msgs = [FakeMessage(1000 - i, user(i + 1)) for i in range(n)]
        return FakeClient(messages=msgs, entity=channel(broadcast=False, megagroup=False))

    async def test_budget_left_caps_the_read(self) -> None:
        client = self._client(300)
        res = await ca.collect_audience(
            client,
            payload(collectMode="comments", messageLimit=100, scannedMessages=90, cursor="900", batchSize=200),
        )
        self.assertEqual(res["messagesScanned"], 10)
        self.assertFalse(res["hasMore"])

    async def test_exhausted_budget_reads_nothing(self) -> None:
        client = self._client(300)
        res = await ca.collect_audience(
            client,
            payload(collectMode="comments", messageLimit=100, scannedMessages=100, cursor="900"),
        )
        self.assertEqual(res["users"], [])
        self.assertFalse(res["hasMore"])
        self.assertEqual(client.message_calls, [])

    async def test_reports_messages_read_this_batch(self) -> None:
        client = self._client(300)
        res = await ca.collect_audience(client, payload(collectMode="comments", messageLimit=5000, batchSize=20))
        self.assertEqual(res["messagesScanned"], 20)
        self.assertTrue(res["hasMore"])


class ParseGroupRefTest(unittest.TestCase):
    """REQ-A9."""

    def test_private_channel_link_by_id(self) -> None:
        self.assertEqual(ca.parse_group_ref("https://t.me/c/1234567890/55"), {"kind": "channel_id", "value": "1234567890"})

    def test_web_preview_link(self) -> None:
        self.assertEqual(ca.parse_group_ref("https://t.me/s/durov_chat"), {"kind": "username", "value": "durov_chat"})

    def test_plain_username_and_invite_unchanged(self) -> None:
        self.assertEqual(ca.parse_group_ref("t.me/src_chat/12"), {"kind": "username", "value": "src_chat"})
        self.assertEqual(ca.parse_group_ref("https://t.me/+AbCdEf123"), {"kind": "invite", "value": "AbCdEf123"})


class ChannelIdResolveTest(unittest.IsolatedAsyncioTestCase):
    async def test_t_me_c_resolves_by_peer_channel(self) -> None:
        client = FakeClient(members=[user(1)])
        res = await ca.collect_audience(client, payload(url="https://t.me/c/777/10"))
        self.assertTrue(res["ok"])
        self.assertIsInstance(client.entity_lookups[0], types.PeerChannel)
        self.assertEqual(client.entity_lookups[0].channel_id, 777)

    async def test_t_me_c_unknown_to_the_slot_asks_for_invite(self) -> None:
        client = FakeClient(raise_on_resolve=ValueError("Could not find the input entity"))
        res = await ca.collect_audience(client, payload(url="https://t.me/c/777/10"))
        self.assertFalse(res["ok"])
        self.assertEqual(res["join"], "private")
        self.assertIn("инвайт", res["error"])


if __name__ == "__main__":
    unittest.main()
