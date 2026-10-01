"""Проверка аккаунта распознаёт «Удалённый аккаунт» Telegram (статус deleted / мягкое подозрение).

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.errors import UserDeactivatedBanError, UserDeactivatedError, UsernameNotOccupiedError  # noqa: E402
from telethon.tl.functions.contacts import ResolveUsernameRequest  # noqa: E402

CHECK_PAYLOAD = {"ensureUsername": False, "checkRestrictions": False}
HEALTHY = frozenset({"telegram", "durov"})


class FakeClient:
    """Сессия жива; ResolveUsername видит только usernames из visible."""

    def __init__(
        self,
        *,
        visible: frozenset[str],
        deleted: bool = False,
        me_error: Exception | None = None,
    ) -> None:
        self.visible = visible
        self.deleted = deleted
        self.me_error = me_error
        self.resolved: list[str] = []

    async def get_me(self):
        if self.me_error is not None:
            raise self.me_error
        return SimpleNamespace(
            id=42, phone="", first_name="Ферма", last_name="", username="deleted_farm_acc", deleted=self.deleted
        )

    async def __call__(self, request):
        if isinstance(request, ResolveUsernameRequest):
            self.resolved.append(request.username)
            if request.username in self.visible:
                return object()
            raise UsernameNotOccupiedError(request=request)
        raise RuntimeError(f"unexpected request {type(request).__name__}")

    async def disconnect(self) -> None:
        return None


class CheckDeletedTest(unittest.IsolatedAsyncioTestCase):
    async def test_blind_on_every_control_username_is_only_a_suspect(self) -> None:
        res = await ca.check_account(FakeClient(visible=frozenset()), CHECK_PAYLOAD)

        self.assertFalse(res["ok"])
        self.assertEqual(res["status"], "active")
        self.assertTrue(res["deletedSuspect"])
        self.assertIn("@telegram", res["error"])

    async def test_one_visible_control_username_keeps_account_active(self) -> None:
        res = await ca.check_account(FakeClient(visible=frozenset({"durov"})), CHECK_PAYLOAD)

        self.assertEqual(res["status"], "active")
        self.assertFalse(res.get("deletedSuspect", False))

    async def test_healthy_account_stays_active(self) -> None:
        client = FakeClient(visible=HEALTHY)

        res = await ca.check_account(client, CHECK_PAYLOAD)

        self.assertTrue(res["ok"])
        self.assertEqual(res["status"], "active")
        self.assertEqual(client.resolved, ["telegram"])

    async def test_self_user_flagged_deleted_is_deleted(self) -> None:
        res = await ca.check_account(FakeClient(visible=HEALTHY, deleted=True), CHECK_PAYLOAD)

        self.assertEqual(res["status"], "deleted")

    async def test_control_resolve_can_be_switched_off(self) -> None:
        client = FakeClient(visible=frozenset())

        res = await ca.check_account(client, {**CHECK_PAYLOAD, "checkDeleted": False})

        self.assertEqual(res["status"], "active")
        self.assertEqual(client.resolved, [])


class CheckDeactivatedErrorTest(unittest.IsolatedAsyncioTestCase):
    async def _run_check(self, error: Exception) -> dict:
        client = FakeClient(visible=HEALTHY, me_error=error)
        with mock.patch.object(ca, "open_client", mock.AsyncMock(return_value=client)):
            return await ca.run_check(CHECK_PAYLOAD)

    async def test_user_deactivated_on_check_is_deleted(self) -> None:
        res = await self._run_check(UserDeactivatedError(request=None))

        self.assertEqual(res["status"], "deleted")

    async def test_user_deactivated_ban_on_check_is_deleted(self) -> None:
        res = await self._run_check(UserDeactivatedBanError(request=None))

        self.assertEqual(res["status"], "deleted")

    async def test_user_deactivated_on_join_keeps_the_action_contract(self) -> None:
        client = FakeClient(visible=HEALTHY)
        with mock.patch.object(ca, "open_client", mock.AsyncMock(return_value=client)), mock.patch.object(
            ca, "join_group", mock.AsyncMock(side_effect=UserDeactivatedError(request=None))
        ):
            res = await ca.run_action({"action": "join", "url": "https://t.me/x"})

        # Only the account check names «deleted»; other actions keep classify_error's verdict.
        self.assertEqual(res["status"], ca.classify_error(UserDeactivatedError(request=None)))
        self.assertNotEqual(res["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
