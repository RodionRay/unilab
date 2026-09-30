"""Слот «слеп» на ResolveUsername → accountBlind, группа не виновата.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.errors import UsernameNotOccupiedError  # noqa: E402
from telethon.tl.functions.contacts import ResolveUsernameRequest  # noqa: E402


class FakeClient:
    """get_entity(@group) всегда падает; ResolveUsername(@telegram) — по флагу."""

    def __init__(self, control_visible: bool) -> None:
        self.control_visible = control_visible

    async def iter_dialogs(self, limit: int = 0):
        return
        yield  # pragma: no cover

    async def get_entity(self, value):
        raise ValueError(f'No user has "{value}" as username')

    async def __call__(self, request):
        if isinstance(request, ResolveUsernameRequest):
            if self.control_visible and request.username == ca.RESOLVE_CONTROL_USERNAME:
                return object()
            raise UsernameNotOccupiedError(request=request)
        raise RuntimeError("search unavailable")


class ResolveBlindTest(unittest.IsolatedAsyncioTestCase):
    async def test_blind_account_is_flagged_not_the_group(self) -> None:
        res = await ca.join_group(FakeClient(control_visible=False), "https://t.me/ozon_partner")
        self.assertFalse(res["ok"])
        self.assertTrue(res["accountBlind"])
        self.assertTrue(res["usernameMissing"])
        self.assertIn("@telegram", res["error"])

    async def test_missing_group_on_healthy_account_stays_group_error(self) -> None:
        res = await ca.join_group(FakeClient(control_visible=True), "https://t.me/ozon_partner")
        self.assertFalse(res["ok"])
        self.assertFalse(res["accountBlind"])
        self.assertTrue(res["usernameMissing"])
        self.assertIn("Слот не видит @ozon_partner", res["error"])


if __name__ == "__main__":
    unittest.main()
