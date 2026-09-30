"""Worker lead prefilter and history window used by scan_group.

Run: python3 -m unittest telegram-worker/tests/test_lead_prefilter.py
"""
from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "lead-match.json"


class SharedFixtureTest(unittest.TestCase):
    """Same cases as tests/lead-match.test.ts runs against lib/lead-filter.ts."""

    def setUp(self) -> None:
        self.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_plus_term_hit_matches_ts_fixture(self) -> None:
        for case in self.fixture["plus"]:
            with self.subTest(term=case["term"], text=case["text"][:40]):
                self.assertEqual(ca.plus_term_hit(case["text"].lower(), case["term"]), case["hit"])

    def test_intent_matches_ts_fixture(self) -> None:
        for case in self.fixture["intent"]:
            with self.subTest(text=case["text"][:40]):
                self.assertEqual(ca.has_buyer_intent(case["text"]), case["buyer"])
                self.assertEqual(ca.has_soft_ask(case["text"]), case["soft"])


class PrefilterTest(unittest.TestCase):
    def test_buyer_intent_without_keyword_hit_passes(self) -> None:
        self.assertTrue(ca.passes_lead_prefilter("Посоветуйте CRM для маркетплейсов", ["остатки"]))
        self.assertTrue(ca.passes_lead_prefilter("Требуется интегратор 1С срочно", ["остатки"]))

    def test_soft_ask_without_keyword_hit_passes(self) -> None:
        self.assertTrue(ca.passes_lead_prefilter("Скажите пожалуйста, где взять выгрузку", ["остатки"]))

    def test_inflected_keyword_passes(self) -> None:
        self.assertTrue(ca.passes_lead_prefilter("У нас синхронизации нет вообще", ["синхронизация"]))

    def test_chatter_without_intent_or_keyword_is_dropped(self) -> None:
        self.assertFalse(ca.passes_lead_prefilter("Сегодня продажи упали, у кого так же?", ["остатки"]))
        self.assertFalse(ca.passes_lead_prefilter("Сегодня продажи упали, у кого так же?", []))


class HistoryWindowTest(unittest.TestCase):
    CUTOFF = datetime(2026, 9, 23, tzinfo=timezone.utc)

    def test_cursor_reads_forward_from_last_seen_id(self) -> None:
        kw = ca.history_window("150", self.CUTOFF)
        self.assertEqual(kw["offset_id"], 150)
        self.assertTrue(kw["reverse"])
        self.assertNotIn("offset_date", kw)
        self.assertGreater(kw["limit"], 200)

    def test_without_cursor_reads_forward_from_depth_cutoff(self) -> None:
        kw = ca.history_window("", self.CUTOFF)
        self.assertEqual(kw["offset_date"], self.CUTOFF)
        self.assertTrue(kw["reverse"])

    def test_without_cursor_and_depth_reads_newest(self) -> None:
        kw = ca.history_window("", None)
        self.assertFalse(kw.get("reverse", False))
        self.assertLessEqual(kw["limit"], 200)

    def test_garbage_cursor_is_ignored(self) -> None:
        self.assertNotIn("offset_id", ca.history_window("abc", self.CUTOFF))


if __name__ == "__main__":
    unittest.main()
