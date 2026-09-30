"""Removed mass actions (audience collection, invites) must be rejected as unknown.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


class _FakeClient:
    async def disconnect(self) -> None:
        return None


class RemovedActionsTest(unittest.TestCase):
    def _run(self, action: str) -> dict:
        work = Path(tempfile.mkdtemp(prefix="tgw-removed-"))

        async def fake_open_client(payload, work_dir):
            return _FakeClient()

        with mock.patch.object(ca, "acquire_work_dir", return_value=work), mock.patch.object(
            ca, "open_client", side_effect=fake_open_client
        ):
            return asyncio.run(ca.run_action({"action": action}))

    def test_collect_and_invite_are_unknown_actions(self) -> None:
        for action in ("collect", "invite"):
            with self.subTest(action=action):
                res = self._run(action)
                self.assertFalse(res["ok"])
                self.assertEqual(res["error"], f"Неизвестное действие: {action}")

    def test_removed_functions_are_gone(self) -> None:
        for name in ("collect_audience", "invite_users", "_serialize_audience_user", "_user_status_bucket"):
            with self.subTest(name=name):
                self.assertFalse(hasattr(ca, name))


if __name__ == "__main__":
    unittest.main()
