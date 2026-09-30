"""Minus-keyword matching used by scan_group (word start, not substring).

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "minus-match.json"


def hit(text: str, terms: list[str]) -> str | None:
    return ca.find_minus_hit(text, ca.compile_minus_terms(terms))


class MinusMatchTest(unittest.TestCase):
    def test_short_fragment_inside_word_does_not_match(self) -> None:
        self.assertIsNone(hit("Подскажите канал про анализ продаж", ["нал"]))
        self.assertIsNone(hit("У кого что работает для остатков?", ["бот"]))

    def test_term_matches_at_word_start(self) -> None:
        self.assertEqual(hit("Продаю ботов для рассылок", ["бот"]), "бот")
        self.assertEqual(hit("Лучшее Казино онлайн", ["казино"]), "казино")

    def test_phrase_matches_as_phrase(self) -> None:
        self.assertEqual(hit("Продаю курсы   инфобиз", ["курсы инфобиз"]), "курсы инфобиз")
        self.assertIsNone(hit("Курсы валют и инфобиз", ["курсы инфобиз"]))
        self.assertIsNone(hit("Ресурсы инфобиз-тематики", ["курсы инфобиз"]))

    def test_terms_shorter_than_three_chars_are_ignored(self) -> None:
        self.assertIsNone(hit("вб и озон", ["вб", "  ", ""]))

    def test_special_characters_are_literal(self) -> None:
        self.assertEqual(hit("Пишите: писать @ivan", ["писать @"]), "писать @")
        self.assertIsNone(hit("c++ разработчик", ["c+++"]))


class SharedFixtureTest(unittest.TestCase):
    """Same cases as tests/lead-stopwords.test.ts runs against lib/lead-filter.ts::findMinusHit."""

    def test_python_matches_ts_fixture(self) -> None:
        cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
        self.assertGreater(len(cases), 10)
        for case in cases:
            with self.subTest(text=case["text"][:40], terms=case["terms"][:3]):
                self.assertEqual(hit(case["text"], case["terms"]), case["hit"])


class AdMarkersTest(unittest.TestCase):
    def test_ad_markers_match_at_word_start(self) -> None:
        self.assertEqual(ca.find_minus_hit("Расклад на Таро недорого", ca.AD_MARKERS), "таро")
        self.assertEqual(ca.find_minus_hit("Пишите @ivan", ca.AD_MARKERS), "пишите @")

    def test_ad_markers_ignore_word_middles(self) -> None:
        self.assertIsNone(ca.find_minus_hit("Кто пользовался старой версией МойСклад?", ca.AD_MARKERS))
        self.assertIsNone(ca.find_minus_hit("Нужна математрица? нет, просто вопрос", ca.AD_MARKERS))


if __name__ == "__main__":
    unittest.main()
