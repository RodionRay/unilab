"""invite_users: Telegram's answer is interpreted per user and per target (REQ-V1, REQ-V2, REQ-V4).

Run: python3 -m unittest discover -s telegram-worker/tests
(fake telethon modules in sys.modules; no network, telethon itself is not required).
"""
from __future__ import annotations

import asyncio
import sys
import types
import unittest
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


class RPCError(Exception):
    code = 400


def _rpc(name: str) -> type[RPCError]:
    return type(name, (RPCError,), {})


ERRORS = {
    name: _rpc(name)
    for name in (
        "FloodWaitError",
        "UserPrivacyRestrictedError",
        "UserAlreadyParticipantError",
        "ChatAdminRequiredError",
        "PeerFloodError",
        "UserNotParticipantError",
        "ChannelPrivateError",
        "UsersTooMuchError",
        "UserNotMutualContactError",
        "UsernameNotOccupiedError",
        "UsernameInvalidError",
    )
}


@dataclass
class Request:
    kind: str
    args: tuple[Any, ...] = ()
    kwargs: dict[str, Any] = field(default_factory=dict)


def _request(kind: str) -> type:
    def init(self: Request, *args: Any, **kwargs: Any) -> None:
        Request.__init__(self, kind, args, kwargs)

    return type(kind, (Request,), {"__init__": init})


class Channel:
    def __init__(self, broadcast: bool = False, megagroup: bool = True) -> None:
        self.id = 777
        self.title = "Target"
        self.broadcast = broadcast
        self.megagroup = megagroup


def fake_telethon() -> dict[str, types.ModuleType]:
    errors = types.ModuleType("telethon.errors")
    errors.RPCError = RPCError  # type: ignore[attr-defined]
    for name, cls in ERRORS.items():
        setattr(errors, name, cls)
    channels = types.ModuleType("telethon.tl.functions.channels")
    for name in ("InviteToChannelRequest", "EditAdminRequest", "GetParticipantRequest"):
        setattr(channels, name, _request(name))
    messages = types.ModuleType("telethon.tl.functions.messages")
    for name in ("AddChatUserRequest", "CheckChatInviteRequest"):
        setattr(messages, name, _request(name))
    tl_types = types.ModuleType("telethon.tl.types")
    tl_types.Channel = Channel  # type: ignore[attr-defined]
    for name in ("ChatAdminRights", "InputPeerUser", "InputUser", "ChatInviteAlready"):
        setattr(tl_types, name, type(name, (), {"__init__": lambda self, *a, **k: None}))
    return {
        "telethon": types.ModuleType("telethon"),
        "telethon.errors": errors,
        "telethon.tl": types.ModuleType("telethon.tl"),
        "telethon.tl.functions": types.ModuleType("telethon.tl.functions"),
        "telethon.tl.functions.channels": channels,
        "telethon.tl.functions.messages": messages,
        "telethon.tl.types": tl_types,
    }


@dataclass
class InvitedUsers:
    """messages.InvitedUsers (layer ≥ 166): users Telegram silently did not add."""

    missing_invitees: list[Any] = field(default_factory=list)


@dataclass
class MissingInvitee:
    user_id: int
    premium_would_allow_invite: bool = False


@dataclass
class FakeClient:
    """Answers InviteToChannelRequest per username: an exception class or an InvitedUsers result."""

    answers: dict[str, Any]
    invited: list[str] = field(default_factory=list)

    async def get_input_entity(self, ref: Any) -> str:
        return str(ref)

    async def __call__(self, request: Request) -> Any:
        if request.kind != "InviteToChannelRequest":
            raise AssertionError(f"unexpected {request.kind}")
        peer = request.args[1][0]
        self.invited.append(peer)
        answer = self.answers.get(peer, InvitedUsers())
        if isinstance(answer, type) and issubclass(answer, BaseException):
            raise answer("rpc")
        return answer


def run_invite(client: FakeClient, users: list[str], entity: Channel | None = None, resolve_err: dict | None = None):
    async def resolve(_client: Any, _url: str, peer_hint: dict | None = None):
        return (None, resolve_err) if resolve_err else (entity or Channel(), None)

    payload = {
        "targetUrl": "https://t.me/target_chat",
        "users": [{"userId": str(100 + i), "username": u} for i, u in enumerate(users)],
    }
    with mock.patch.dict(sys.modules, fake_telethon()), mock.patch.object(ca, "_resolve_entity", resolve):
        return asyncio.run(ca.invite_users(client, payload))


def by_user(out: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {r["username"]: r for r in out["results"]}


class InviteResultTest(unittest.TestCase):
    def test_missing_invitee_is_a_privacy_failure_not_an_invite(self) -> None:
        client = FakeClient({"hidden": InvitedUsers([MissingInvitee(101)]), "open": InvitedUsers()})
        out = run_invite(client, ["open", "hidden"])
        self.assertTrue(out["ok"])
        self.assertTrue(by_user(out)["open"]["ok"])
        self.assertEqual(by_user(out)["hidden"]["ok"], False)
        self.assertEqual(by_user(out)["hidden"]["error"], "privacy")
        self.assertEqual(out["invited"], 1)

    def test_already_member_is_reported_as_already(self) -> None:
        client = FakeClient({"member": ERRORS["UserAlreadyParticipantError"]})
        out = run_invite(client, ["member"])
        self.assertEqual(by_user(out)["member"]["error"], "already")
        self.assertEqual(out["invited"], 0)

    def test_permanent_user_errors_are_privacy(self) -> None:
        client = FakeClient({
            "closed": ERRORS["UserPrivacyRestrictedError"],
            "stranger": ERRORS["UserNotMutualContactError"],
        })
        out = run_invite(client, ["closed", "stranger"])
        self.assertEqual(by_user(out)["closed"]["error"], "privacy")
        self.assertEqual(by_user(out)["stranger"]["error"], "privacy")


class InviteTargetErrorTest(unittest.TestCase):
    def test_need_admin_stops_the_batch_as_a_target_error(self) -> None:
        client = FakeClient({"first": InvitedUsers(), "second": ERRORS["ChatAdminRequiredError"]})
        out = run_invite(client, ["first", "second", "third"])
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "target_error")
        self.assertEqual(out["targetError"], "need_admin")
        self.assertEqual([r["username"] for r in out["results"]], ["first"])
        self.assertNotIn("third", client.invited)

    def test_full_chat_is_a_target_error(self) -> None:
        out = run_invite(FakeClient({"u": ERRORS["UsersTooMuchError"]}), ["u"])
        self.assertEqual((out["status"], out["targetError"]), ("target_error", "chat_full"))

    def test_broadcast_channel_is_a_target_error(self) -> None:
        client = FakeClient({})
        out = run_invite(client, ["u"], entity=Channel(broadcast=True, megagroup=False))
        self.assertEqual((out["ok"], out["status"], out["targetError"]), (False, "target_error", "broadcast"))
        self.assertEqual(client.invited, [])

    def test_unresolvable_target_is_a_target_error(self) -> None:
        err = {"ok": False, "status": "error", "usernameMissing": True, "error": "Слот не видит @target_chat"}
        out = run_invite(FakeClient({}), ["u"], resolve_err=err)
        self.assertEqual((out["status"], out["targetError"]), ("target_error", "target_missing"))
        self.assertEqual(out["results"], [])

    def test_blind_account_is_not_blamed_on_the_target(self) -> None:
        err = {"ok": False, "status": "error", "usernameMissing": True, "accountBlind": True, "error": "blind"}
        out = run_invite(FakeClient({}), ["u"], resolve_err=err)
        self.assertTrue(out["accountBlind"])
        self.assertNotEqual(out.get("status"), "target_error")


if __name__ == "__main__":
    unittest.main()
