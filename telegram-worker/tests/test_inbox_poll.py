"""poll_dm_inbox: incoming DMs are not lost behind a fixed dialog/message window (REQ-C3).

Run: python3 -m unittest discover -s telegram-worker/tests
(fake Telethon client; no network, no telethon import).
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402

NOW = 1_790_000_000


def at(ts: int) -> datetime:
    return datetime.fromtimestamp(ts, tz=timezone.utc)


@dataclass
class FakeUser:
    id: int
    username: str = ""
    first_name: str = "Клиент"
    last_name: str = ""
    bot: bool = False
    is_self: bool = False


@dataclass
class FakeMessage:
    id: int
    date: datetime
    message: str
    out: bool = False
    media: Any = None


@dataclass
class FakeDialog:
    entity: Any
    date: datetime
    is_user: bool = True
    pinned: bool = False


class FloodWaitError(Exception):
    """Same class name as telethon.errors.FloodWaitError."""


@dataclass
class FakeClient:
    dialogs: list[FakeDialog]
    history: dict[int, list[FakeMessage]] = field(default_factory=dict)
    fail_for: set[int] = field(default_factory=set)
    fetched: list[int] = field(default_factory=list)

    async def iter_dialogs(self, limit: int | None = None, offset_date: datetime | None = None):
        rows = sorted(self.dialogs, key=lambda d: (not d.pinned, -d.date.timestamp()))
        if offset_date is not None:
            rows = [d for d in rows if not d.pinned and d.date < offset_date]
        for d in rows[: limit or None]:
            yield d

    async def iter_messages(self, entity: Any, limit: int | None = None):
        self.fetched.append(entity.id)
        if entity.id in self.fail_for:
            raise FloodWaitError("A wait of 30 seconds is required")
        msgs = sorted(self.history.get(entity.id, []), key=lambda m: -m.date.timestamp())
        for m in msgs[: limit or None]:
            yield m


def user_dialog(uid: int, ts: int, *, pinned: bool = False, texts: int = 1, client: FakeClient | None = None) -> FakeDialog:
    d = FakeDialog(entity=FakeUser(id=uid, username=f"u{uid}"), date=at(ts), pinned=pinned)
    if client is not None:
        client.history[uid] = [FakeMessage(id=uid * 1000 + i, date=at(ts - i), message=f"msg {uid}/{i}") for i in range(texts)]
    return d


def poll(client: FakeClient, **kwargs: Any) -> dict[str, Any]:
    return asyncio.run(ca.poll_dm_inbox(client, now=NOW, **kwargs))


def all_pages(client: FakeClient, since_ts: int, max_user_dialogs: int) -> tuple[list[dict[str, Any]], int]:
    messages: list[dict[str, Any]] = []
    offset = 0
    for pages in range(1, 20):
        res = poll(client, since_ts=since_ts, offset_date=offset, max_user_dialogs=max_user_dialogs)
        messages.extend(res["messages"])
        if res["complete"]:
            return messages, pages
        offset = res["nextOffsetDate"]
    raise AssertionError("inbox paging did not complete")


class InboxPollTest(unittest.TestCase):
    def test_more_dialogs_than_budget_are_paged_not_lost(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [user_dialog(100 + i, NOW - 60 * (i + 1), client=client) for i in range(45)]

        first = poll(client, since_ts=NOW - 7200, max_user_dialogs=30)
        messages, pages = all_pages(client, NOW - 7200, 30)

        self.assertFalse(first["complete"])
        self.assertGreater(first["nextOffsetDate"], NOW - 7200)
        self.assertEqual(pages, 2)
        self.assertEqual({m["userId"] for m in messages}, {str(100 + i) for i in range(45)})

    def test_all_new_messages_of_a_dialog_are_returned(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [user_dialog(7, NOW - 10, texts=20, client=client)]

        res = poll(client, since_ts=NOW - 3600)

        self.assertTrue(res["complete"])
        self.assertEqual(len(res["messages"]), 20)

    def test_scan_stops_at_floor_without_fetching_older_dialogs(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [
            user_dialog(1, NOW - 60, client=client),
            user_dialog(2, NOW - 7200, client=client),
        ]

        res = poll(client, since_ts=NOW - 3600)

        self.assertTrue(res["complete"])
        self.assertEqual(client.fetched, [1])
        self.assertEqual(res["scanStartedTs"], NOW)

    def test_old_pinned_dialog_does_not_end_the_scan(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [
            user_dialog(1, NOW - 90_000, pinned=True, client=client),
            user_dialog(2, NOW - 60, client=client),
        ]

        res = poll(client, since_ts=NOW - 3600)

        self.assertEqual([m["userId"] for m in res["messages"]], ["2"])

    def test_outgoing_bots_and_groups_are_skipped(self) -> None:
        client = FakeClient(dialogs=[])
        mine = user_dialog(1, NOW - 60, client=client)
        client.history[1].append(FakeMessage(id=5, date=at(NOW - 30), message="наш ответ", out=True))
        bot = FakeDialog(entity=FakeUser(id=2, bot=True), date=at(NOW - 50))
        group = FakeDialog(entity=FakeUser(id=3), date=at(NOW - 40), is_user=False)
        client.dialogs = [mine, bot, group]

        res = poll(client, since_ts=NOW - 3600)

        self.assertEqual([m["text"] for m in res["messages"]], ["msg 1/0"])
        self.assertEqual(client.fetched, [1])

    def test_flood_wait_on_a_dialog_resumes_from_it(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [user_dialog(1, NOW - 60, client=client), user_dialog(2, NOW - 120, client=client)]
        client.fail_for = {2}

        res = poll(client, since_ts=NOW - 3600)

        self.assertFalse(res["complete"])
        self.assertEqual(res["nextOffsetDate"], NOW - 120 + 1)
        self.assertEqual([m["userId"] for m in res["messages"]], ["1"])

    def test_default_floor_is_36_hours(self) -> None:
        client = FakeClient(dialogs=[])
        client.dialogs = [user_dialog(1, NOW - 30 * 3600, client=client), user_dialog(2, NOW - 40 * 3600, client=client)]

        res = poll(client)

        self.assertEqual([m["userId"] for m in res["messages"]], ["1"])


if __name__ == "__main__":
    unittest.main()
