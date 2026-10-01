"""scan_group returns raw messages (REQ-5): no keyword/minus/ad/intent filtering, only sender/age/error drops.

Run: python -m pytest -q telegram-worker/tests/test_scan_raw.py
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.tl.functions.channels import GetFullChannelRequest  # noqa: E402
from telethon.tl.types import Channel, User  # noqa: E402

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
GROUP = SimpleNamespace(id=303, username="shop_chat", title="Shop chat", broadcast=False, megagroup=True)
CHANNEL = SimpleNamespace(id=101, username="shop_news", title="Shop news", broadcast=True, megagroup=False)
DISCUSSION = SimpleNamespace(id=202, username=None, title="Shop talk", broadcast=False, megagroup=True)

HUMAN = User(id=7, first_name="Ivan", username="ivan", access_hash=99)
BOT = User(id=8, first_name="Helper", bot=True)
CHANNEL_SENDER = Channel(id=9, title="Ads", photo=None, date=NOW, access_hash=1)


class SenderLookupFailed(Exception):
    pass


class FakeMsg:
    def __init__(self, mid: int, text: str, *, sender: Any = HUMAN, age: timedelta = timedelta(minutes=5),
                 reply_to: int | None = None) -> None:
        self.id = mid
        self.message = text
        self.date = NOW - age
        self.reply_to = SimpleNamespace(reply_to_msg_id=reply_to) if reply_to else None
        self._sender = sender

    async def get_sender(self) -> Any:
        if isinstance(self._sender, Exception):
            raise self._sender
        return self._sender


class FakeClient:
    """Feeds per peer id; honours the iter_messages window kwargs the way Telethon does (reverse = ascending)."""

    def __init__(self, feeds: dict[int, list[FakeMsg]], comments: dict[int, list[FakeMsg]] | None = None) -> None:
        self.feeds = feeds
        self.comments = comments or {}
        self.calls: list[dict[str, Any]] = []

    async def iter_messages(self, peer, **kw):
        self.calls.append({"peer": peer, **kw})
        if "reply_to" in kw:
            items = list(self.comments.get(kw["reply_to"], []))
        else:
            items = sorted(self.feeds.get(peer.id, []), key=lambda m: m.id, reverse=not kw.get("reverse"))
            if kw.get("offset_id"):
                items = [m for m in items if m.id > kw["offset_id"]]
            if kw.get("offset_date"):
                items = [m for m in items if m.date > kw["offset_date"]]
        for m in items[: kw.get("limit") or len(items)]:
            yield m

    async def get_entity(self, value):
        if value == DISCUSSION.id:
            return DISCUSSION
        raise ValueError(value)

    async def __call__(self, request):
        if isinstance(request, GetFullChannelRequest):
            return SimpleNamespace(full_chat=SimpleNamespace(linked_chat_id=DISCUSSION.id))
        raise RuntimeError(type(request).__name__)


async def _member(_client, _entity) -> bool:
    return True


def _resolving(entity):
    async def resolve(_client, _url, peer_hint=None):
        return entity, None

    return resolve


def assert_funnel_invariant(case: unittest.TestCase, res: dict[str, Any]) -> None:
    case.assertEqual(
        res["fetched"],
        len(res["messages"]) + res["skippedNotUser"] + res["skippedOld"] + res["skippedError"],
    )


class ScanRawTest(unittest.IsolatedAsyncioTestCase):
    async def scan(self, client: FakeClient, entity=GROUP, **kw) -> dict[str, Any]:
        with patch.object(ca, "_resolve_entity", _resolving(entity)), patch.object(ca, "_is_member", _member):
            return await ca.scan_group(client, "https://t.me/" + entity.username, now=NOW, **kw)

    async def test_returns_messages_without_keyword_minus_or_ad_filtering(self) -> None:
        texts = ["Расклад на Таро недорого", "Пишите @ivan", "Сегодня продажи упали, у кого так же?", "ок!"]
        client = FakeClient({GROUP.id: [FakeMsg(i + 1, t) for i, t in enumerate(texts)]})

        res = await self.scan(client, cursor="0")

        self.assertEqual([m["message"] for m in res["messages"]], texts)
        self.assertNotIn("skippedMinus", res)
        self.assertNotIn("skippedKw", res)

    async def test_bot_and_channel_senders_count_as_not_user(self) -> None:
        client = FakeClient({GROUP.id: [
            FakeMsg(1, "бот пишет", sender=BOT),
            FakeMsg(2, "канал пишет", sender=CHANNEL_SENDER),
            FakeMsg(3, "человек пишет"),
        ]})

        res = await self.scan(client, cursor="0")

        self.assertEqual(res["skippedNotUser"], 2)
        self.assertEqual([m["tgMsgId"] for m in res["messages"]], ["3"])
        assert_funnel_invariant(self, res)

    async def test_get_sender_failure_counts_as_error_and_advances_cursor(self) -> None:
        client = FakeClient({GROUP.id: [FakeMsg(1, "кто это?", sender=SenderLookupFailed("flood")), FakeMsg(2, "привет всем")]})

        res = await self.scan(client, cursor="0")

        self.assertEqual(res["skippedError"], 1)
        self.assertEqual(len(res["messages"]), 1)
        self.assertEqual(res["cursor"], "2")
        assert_funnel_invariant(self, res)

    async def test_message_older_than_depth_counts_as_old(self) -> None:
        client = FakeClient({GROUP.id: [FakeMsg(11, "старое сообщение", age=timedelta(days=3)), FakeMsg(12, "свежее")]})

        res = await self.scan(client, cursor="10", days=1)

        self.assertEqual(res["skippedOld"], 1)
        self.assertEqual([m["tgMsgId"] for m in res["messages"]], ["12"])
        self.assertEqual(res["cursor"], "12")
        assert_funnel_invariant(self, res)

    async def test_output_capped_at_80_and_cursor_stops_at_last_processed(self) -> None:
        client = FakeClient({GROUP.id: [FakeMsg(i, f"сообщение {i}") for i in range(1, 101)]})

        res = await self.scan(client, cursor="0")

        self.assertEqual(ca.SCAN_OUTPUT_CAP, 80)
        self.assertEqual(len(res["messages"]), 80)
        self.assertEqual(res["cursor"], "80")
        self.assertEqual(res["fetched"], 80)

    async def test_first_scan_reads_one_day_regardless_of_days(self) -> None:
        client = FakeClient({GROUP.id: [
            FakeMsg(1, "позавчера", age=timedelta(days=2)),
            FakeMsg(2, "сегодня утром", age=timedelta(hours=3)),
        ]})

        res = await self.scan(client, cursor="", days=7)

        self.assertEqual(client.calls[0]["offset_date"], NOW - timedelta(days=1))
        self.assertTrue(client.calls[0]["reverse"])
        self.assertNotIn("offset_id", client.calls[0])
        self.assertEqual([m["tgMsgId"] for m in res["messages"]], ["2"])
        self.assertEqual(res["cursor"], "2")

    async def test_later_scan_reads_forward_from_cursor(self) -> None:
        client = FakeClient({GROUP.id: [FakeMsg(i, f"текст {i}") for i in range(1, 6)]})

        res = await self.scan(client, cursor="3", days=7)

        self.assertEqual(client.calls[0]["offset_id"], 3)
        self.assertTrue(client.calls[0]["reverse"])
        self.assertEqual([m["tgMsgId"] for m in res["messages"]], ["4", "5"])

    async def test_comment_fallback_ids_never_move_cursor(self) -> None:
        client = FakeClient(
            {DISCUSSION.id: [FakeMsg(50, "в обсуждении"), FakeMsg(51, "ещё вопрос")],
             CHANNEL.id: [FakeMsg(900, "пост канала")]},
            comments={900: [FakeMsg(5000, "комментарий к посту", reply_to=900)]},
        )

        res = await self.scan(client, entity=CHANNEL, cursor="49")

        kinds = {m["tgMsgId"]: m["messageKind"] for m in res["messages"]}
        self.assertEqual(kinds, {"50": "discussion", "51": "discussion", "5000": "comment"})
        self.assertEqual(res["cursor"], "51")
        assert_funnel_invariant(self, res)

    async def test_short_or_empty_text_is_not_fetched_but_advances_cursor(self) -> None:
        client = FakeClient({GROUP.id: [FakeMsg(1, "да"), FakeMsg(2, ""), FakeMsg(3, "вопрос по CRM")]})

        res = await self.scan(client, cursor="0")

        self.assertEqual(res["fetched"], 1)
        self.assertEqual(res["cursor"], "3")
        assert_funnel_invariant(self, res)

    async def test_mixed_feed_keeps_funnel_invariant_and_message_fields(self) -> None:
        client = FakeClient({GROUP.id: [
            FakeMsg(1, "бот", sender=BOT),
            FakeMsg(2, "ошибка отправителя", sender=SenderLookupFailed("x")),
            FakeMsg(3, "старьё", age=timedelta(days=30)),
            FakeMsg(4, "ответ на вопрос", reply_to=2),
        ]})

        res = await self.scan(client, cursor="0", days=7)

        assert_funnel_invariant(self, res)
        self.assertEqual(res["fetched"], 4)
        msg = res["messages"][0]
        self.assertEqual(msg["messageKind"], "group")
        self.assertEqual(msg["peerId"], str(GROUP.id))
        self.assertEqual(msg["replyToMsgId"], "2")
        self.assertEqual(msg["senderId"], "7")
        self.assertEqual(msg["senderUsername"], "ivan")


class HistoryWindowTest(unittest.TestCase):
    def test_cursor_reads_forward_from_last_seen_id(self) -> None:
        kw = ca.history_window("150", NOW)
        self.assertEqual(kw["offset_id"], 150)
        self.assertTrue(kw["reverse"])
        self.assertNotIn("offset_date", kw)

    def test_without_cursor_reads_forward_from_first_scan_since(self) -> None:
        kw = ca.history_window("", NOW)
        self.assertEqual(kw["offset_date"], NOW)
        self.assertTrue(kw["reverse"])

    def test_garbage_cursor_is_ignored(self) -> None:
        self.assertNotIn("offset_id", ca.history_window("abc", NOW))


if __name__ == "__main__":
    unittest.main()
