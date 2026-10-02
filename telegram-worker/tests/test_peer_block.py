"""Lead «likely blocked» inputs: peer send-error codes, peer snapshot, batched peer_status.

Run: <venv with telethon 1.36>/bin/python -m unittest discover -s telegram-worker/tests
Needs real telethon error/type classes; skipped when telethon is not installed.
"""
from __future__ import annotations

import asyncio
import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402

HAS_TELETHON = importlib.util.find_spec("telethon") is not None
T0 = 1_790_000_000


def ts(sec: int) -> datetime:
    return datetime.fromtimestamp(sec, tz=timezone.utc)


class FakeSendClient:
    """Resolves the client to `user`; SendMessage raises `error` or returns a message id."""

    def __init__(self, user: Any, error: Exception | None = None) -> None:
        self.user = user
        self.error = error
        self.sent = 0

    async def get_input_entity(self, ref: Any) -> Any:
        return self.user

    async def get_entity(self, ref: Any) -> Any:
        return self.user

    async def send_message(self, *args: Any, **kwargs: Any) -> Any:
        self.sent += 1
        if self.error:
            raise self.error

        class Sent:
            id = 501

        return Sent()


def make_user(**kw: Any) -> Any:
    from telethon.tl.types import User

    return User(id=2001, access_hash=77, username="client_nick", **kw)


def send_dm(client: FakeSendClient) -> dict[str, Any]:
    return asyncio.run(
        ca.send_message(client, mode="dm", text="Привет", sender_id="2001", sender_username="client_nick")
    )


@unittest.skipUnless(HAS_TELETHON, "telethon not installed")
class PeerErrorCodeTest(unittest.TestCase):
    def test_codes_from_classes_and_raw_rpc(self) -> None:
        from telethon.errors import InputUserDeactivatedError, RPCError, UserIsBlockedError

        self.assertEqual(ca.peer_error_code(UserIsBlockedError(request=None)), "USER_IS_BLOCKED")
        self.assertEqual(ca.peer_error_code(InputUserDeactivatedError(request=None)), "INPUT_USER_DEACTIVATED")
        self.assertEqual(
            ca.peer_error_code(RPCError(request=None, message="PRIVACY_PREMIUM_REQUIRED", code=403)),
            "PRIVACY_PREMIUM_REQUIRED",
        )
        self.assertEqual(ca.peer_error_code(RPCError(request=None, message="CHAT_ID_INVALID", code=400)), "")

    def test_send_blocked_returns_code_without_account_status(self) -> None:
        from telethon.errors import UserIsBlockedError

        out = send_dm(FakeSendClient(make_user(), UserIsBlockedError(request=None)))

        self.assertFalse(out["ok"])
        self.assertEqual(out["errorCode"], "USER_IS_BLOCKED")
        self.assertNotIn("status", out)  # the peer blocked us — not an account penalty status

    def test_send_premium_only_and_privacy(self) -> None:
        from telethon.errors import RPCError, UserPrivacyRestrictedError

        premium = send_dm(FakeSendClient(make_user(), RPCError(request=None, message="PRIVACY_PREMIUM_REQUIRED", code=403)))
        privacy = send_dm(FakeSendClient(make_user(), UserPrivacyRestrictedError(request=None)))

        self.assertEqual(premium["errorCode"], "PRIVACY_PREMIUM_REQUIRED")
        self.assertEqual(privacy["errorCode"], "USER_PRIVACY_RESTRICTED")

    def test_deleted_peer_is_not_sent(self) -> None:
        client = FakeSendClient(make_user(deleted=True))

        out = send_dm(client)

        self.assertEqual(out["errorCode"], "INPUT_USER_DEACTIVATED")
        self.assertEqual(client.sent, 0)

    def test_success_carries_peer_snapshot(self) -> None:
        from telethon.tl.types import UserProfilePhoto, UserStatusOffline

        user = make_user(
            status=UserStatusOffline(was_online=ts(T0)),
            photo=UserProfilePhoto(photo_id=1, dc_id=2),
        )
        out = send_dm(FakeSendClient(user))

        self.assertTrue(out["ok"])
        self.assertEqual(out["peer"], {"status": "offline", "wasOnline": T0, "photo": True, "deleted": False})


@unittest.skipUnless(HAS_TELETHON, "telethon not installed")
class PeerSnapshotTest(unittest.TestCase):
    def test_empty_status_and_no_photo_is_hidden(self) -> None:
        from telethon.tl.types import UserStatusEmpty

        self.assertEqual(ca.peer_snapshot(make_user(status=UserStatusEmpty()))["status"], "hidden")
        self.assertEqual(ca.peer_snapshot(make_user())["status"], "hidden")
        self.assertFalse(ca.peer_snapshot(make_user())["photo"])

    def test_buckets_and_online_uses_now(self) -> None:
        from telethon.tl.types import UserStatusOnline, UserStatusRecently

        self.assertEqual(ca.peer_snapshot(make_user(status=UserStatusRecently()))["status"], "recently")
        online = ca.peer_snapshot(make_user(status=UserStatusOnline(expires=ts(T0 + 60))), now=T0)
        self.assertEqual((online["status"], online["wasOnline"]), ("online", T0))


class FakePeerDialogsClient:
    def __init__(self, result: Any = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.requests: list[Any] = []

    async def __call__(self, request: Any) -> Any:
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.result


@unittest.skipUnless(HAS_TELETHON, "telethon not installed")
class PeerStatusTest(unittest.TestCase):
    def peer_dialogs(self) -> Any:
        from telethon.tl.types import (
            Dialog,
            Message,
            PeerNotifySettings,
            PeerUser,
            UserStatusEmpty,
            UserStatusOffline,
        )
        from telethon.tl.types.messages import PeerDialogs
        from telethon.tl.types.updates import State

        def dialog(uid: int, top: int, read_out: int) -> Any:
            return Dialog(
                peer=PeerUser(uid), top_message=top, read_inbox_max_id=0, read_outbox_max_id=read_out,
                unread_count=0, unread_mentions_count=0, unread_reactions_count=0,
                notify_settings=PeerNotifySettings(),
            )

        return PeerDialogs(
            dialogs=[dialog(2001, 10, 9), dialog(2002, 20, 20)],
            messages=[
                Message(id=10, peer_id=PeerUser(2001), date=ts(T0 - 7200), message="hi", out=True),
                Message(id=20, peer_id=PeerUser(2002), date=ts(T0 - 60), message="ответ", out=False),
            ],
            chats=[],
            users=[
                make_user(status=UserStatusEmpty()),
                __import__("telethon").tl.types.User(id=2002, access_hash=5, status=UserStatusOffline(was_online=ts(T0 - 30))),
            ],
            state=State(pts=1, qts=0, date=ts(T0), seq=0, unread_count=0),
        )

    def test_one_request_reports_read_state_and_visibility(self) -> None:
        client = FakePeerDialogsClient(self.peer_dialogs())
        peers = [{"userId": "2001", "accessHash": "77"}, {"userId": "2002", "accessHash": "5"}, {"userId": "x"}]

        out = asyncio.run(ca.peer_status(client, peers, now=T0))

        self.assertTrue(out["ok"])
        self.assertEqual(len(client.requests), 1)
        self.assertEqual(len(client.requests[0].peers), 2)  # the peer without a numeric id is skipped
        by_id = {p["userId"]: p for p in out["peers"]}
        self.assertEqual(by_id["2001"]["status"], "hidden")
        self.assertTrue(by_id["2001"]["outUnread"])
        self.assertEqual(by_id["2001"]["lastOutAt"], T0 - 7200)
        self.assertFalse(by_id["2002"]["outUnread"])  # their reply is the top message
        self.assertEqual(by_id["2002"]["wasOnline"], T0 - 30)

    def test_caps_batch_and_reports_flood(self) -> None:
        from telethon.errors import FloodWaitError

        client = FakePeerDialogsClient(error=FloodWaitError(request=None, capture=33))
        peers = [{"userId": str(3000 + i), "accessHash": "1"} for i in range(80)]

        out = asyncio.run(ca.peer_status(client, peers, now=T0))

        self.assertEqual((out["ok"], out["status"], out["waitSec"]), (False, "flood", 33))
        self.assertEqual(len(client.requests[0].peers), ca.PEER_STATUS_MAX_PEERS)

    def test_stale_hash_is_isolated_by_halving(self) -> None:
        from telethon.errors import RPCError
        from telethon.tl.types.messages import PeerDialogs
        from telethon.tl.types.updates import State

        class SplitClient:
            def __init__(self) -> None:
                self.sizes: list[int] = []

            async def __call__(self, request: Any) -> Any:
                ids = [x.peer.user_id for x in request.peers]
                self.sizes.append(len(ids))
                if 3003 in ids:
                    raise RPCError(request=None, message="PEER_ID_INVALID", code=400)
                return PeerDialogs(dialogs=[], messages=[], chats=[], users=[], state=State(pts=1, qts=0, date=ts(T0), seq=0, unread_count=0))

        client = SplitClient()
        peers = [{"userId": str(3000 + i), "accessHash": "1"} for i in range(8)]
        orig = ca.PEER_STATUS_SPLIT_PAUSE_SEC
        ca.PEER_STATUS_SPLIT_PAUSE_SEC = 0
        try:
            out = asyncio.run(ca.peer_status(client, peers, now=T0))
        finally:
            ca.PEER_STATUS_SPLIT_PAUSE_SEC = orig

        self.assertTrue(out["ok"])
        self.assertEqual([f["userId"] for f in out["failed"]], ["3003"])
        self.assertLessEqual(len(client.sizes), ca.PEER_STATUS_MAX_CALLS)
        self.assertEqual(client.sizes[0], 8)

    def test_no_known_peers_makes_no_request(self) -> None:
        client = FakePeerDialogsClient()

        out = asyncio.run(ca.peer_status(client, [{"userId": "1"}], now=T0))

        self.assertEqual(out["peers"], [])
        self.assertEqual(client.requests, [])


if __name__ == "__main__":
    unittest.main()
