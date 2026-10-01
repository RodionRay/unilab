"""set_last_seen_privacy: StatusTimestamp privacy via account.SetPrivacyRequest.

Run: <venv with telethon 1.36>/bin/python -m unittest discover -s telegram-worker/tests
Needs real telethon request/type classes; skipped when telethon is not installed.
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
    """Records every request; answers SetPrivacyRequest with the rules it was given."""

    def __init__(self, error: Exception | None = None) -> None:
        self.requests: list[Any] = []
        self.error = error

    async def __call__(self, request: Any) -> Any:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        from telethon.tl.types.account import PrivacyRules

        return PrivacyRules(rules=[], chats=[], users=[])


def run(client: FakeClient, payload: dict[str, Any]) -> dict[str, Any]:
    return asyncio.run(ca.set_last_seen_privacy(client, payload))


@unittest.skipUnless(HAS_TELETHON, "telethon not installed")
class SetLastSeenPrivacyTest(unittest.TestCase):
    def test_hide_sets_disallow_all_on_status_timestamp(self) -> None:
        from telethon.tl.functions.account import SetPrivacyRequest
        from telethon.tl.types import InputPrivacyKeyStatusTimestamp, InputPrivacyValueDisallowAll

        client = FakeClient()
        out = run(client, {"hideLastSeen": True})

        self.assertEqual(out, {"ok": True, "hidden": True})
        self.assertEqual(len(client.requests), 1)
        req = client.requests[0]
        self.assertIsInstance(req, SetPrivacyRequest)
        self.assertIsInstance(req.key, InputPrivacyKeyStatusTimestamp)
        self.assertEqual(len(req.rules), 1)
        self.assertIsInstance(req.rules[0], InputPrivacyValueDisallowAll)

    def test_show_sets_allow_all(self) -> None:
        from telethon.tl.types import InputPrivacyValueAllowAll

        client = FakeClient()
        out = run(client, {"hideLastSeen": False})

        self.assertEqual(out, {"ok": True, "hidden": False})
        self.assertIsInstance(client.requests[0].rules[0], InputPrivacyValueAllowAll)

    def test_reapply_is_the_same_single_request(self) -> None:
        client = FakeClient()
        first = run(client, {"hideLastSeen": True})
        second = run(client, {"hideLastSeen": True})

        self.assertEqual(first, second)
        self.assertEqual(len(client.requests), 2)
        self.assertEqual(type(client.requests[0].rules[0]), type(client.requests[1].rules[0]))

    def test_missing_flag_is_rejected_without_a_request(self) -> None:
        client = FakeClient()
        out = run(client, {})

        self.assertFalse(out["ok"])
        self.assertIn("hideLastSeen", out["error"])
        self.assertEqual(client.requests, [])

    def test_non_bool_flag_is_rejected(self) -> None:
        client = FakeClient()
        out = run(client, {"hideLastSeen": "yes"})

        self.assertFalse(out["ok"])
        self.assertEqual(client.requests, [])

    def test_frozen_account_reports_frozen(self) -> None:
        from telethon.errors import RPCError

        err = RPCError(request=None, message="FROZEN_METHOD_INVALID", code=420)
        out = run(FakeClient(err), {"hideLastSeen": True})

        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "frozen")

    def test_flood_wait_reports_wait_seconds(self) -> None:
        from telethon.errors import FloodWaitError

        err = FloodWaitError(request=None, capture=42)
        out = run(FakeClient(err), {"hideLastSeen": True})

        self.assertFalse(out["ok"])
        self.assertIn("42", out["error"])
        self.assertNotIn("status", out)

    def test_other_rpc_error_is_reported(self) -> None:
        from telethon.errors import RPCError

        out = run(FakeClient(RPCError(request=None, message="PRIVACY_KEY_INVALID", code=400)), {"hideLastSeen": True})

        self.assertFalse(out["ok"])
        self.assertIn("PRIVACY_KEY_INVALID", out["error"])


class RunActionRoutingTest(unittest.TestCase):
    def test_worker_route_maps_to_python_action(self) -> None:
        src = (Path(__file__).resolve().parent.parent / "src" / "worker-app.mjs").read_text()
        self.assertIn('"/set-last-seen-privacy": "set_last_seen_privacy"', src)
        self.assertTrue(hasattr(ca, "set_last_seen_privacy"))


if __name__ == "__main__":
    unittest.main()
