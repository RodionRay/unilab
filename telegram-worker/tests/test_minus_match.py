"""Minus-keyword matching used by scan_group (word start, not substring).

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


def hit(text: str, terms: list[str]) -> str | None:
    return ca.find_minus_hit(text.lower(), ca.compile_minus_terms(terms))


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


if __name__ == "__main__":
    unittest.main()
