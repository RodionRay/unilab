"""Unit tests for check_account security guards.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
(stdlib only; heavy deps are imported lazily inside check_account).
"""
from __future__ import annotations

import socket
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


def fake_resolver(*addrs: str):
    def resolve(host, port, *args, **kwargs):
        out = []
        for a in addrs:
            fam = socket.AF_INET6 if ":" in a else socket.AF_INET
            out.append((fam, socket.SOCK_STREAM, 6, "", (a, port)))
        return out

    return resolve


class ProxyHostGuardTest(unittest.TestCase):
    def test_accepts_public_address(self) -> None:
        ip = ca.resolve_public_host("proxy.example", 1080, resolver=fake_resolver("8.8.8.8"))
        self.assertEqual(ip, "8.8.8.8")

    def test_rejects_internal_ranges(self) -> None:
        for bad in (
            "127.0.0.1",
            "10.0.0.5",
            "172.16.1.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "224.0.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ):
            with self.subTest(addr=bad):
                with self.assertRaises(ca.ProxyHostRejected):
                    ca.resolve_public_host("h", 1080, resolver=fake_resolver(bad))

    def test_rejects_when_any_resolved_address_is_internal(self) -> None:
        with self.assertRaises(ca.ProxyHostRejected):
            ca.resolve_public_host("h", 1080, resolver=fake_resolver("8.8.8.8", "127.0.0.1"))

    def test_rejects_unresolvable_host(self) -> None:
        def boom(*a, **k):
            raise socket.gaierror("nope")

        with self.assertRaises(ca.ProxyHostRejected):
            ca.resolve_public_host("h", 1080, resolver=boom)

    def test_check_proxy_does_not_connect_to_loopback(self) -> None:
        import asyncio

        result = asyncio.run(ca.check_proxy_alive({"host": "127.0.0.1", "port": 1080}))
        self.assertFalse(result["ok"])
        self.assertNotIn("127.0.0.1", result["error"])


class ZipGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def _zip(self, entries: dict[str, bytes]) -> Path:
        path = self.tmp / "a.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in entries.items():
                zf.writestr(name, data)
        return path

    def test_extracts_normal_archive(self) -> None:
        z = self._zip({"tdata/key_datas": b"x", "a.session": b"y"})
        ca.safe_extract_zip(z, self.tmp / "out")
        self.assertTrue((self.tmp / "out" / "tdata" / "key_datas").exists())

    def test_rejects_too_many_entries(self) -> None:
        z = self._zip({f"f{i}": b"" for i in range(11)})
        with self.assertRaises(ca.ArchiveRejected):
            ca.safe_extract_zip(z, self.tmp / "out", max_entries=10)
        self.assertFalse((self.tmp / "out").exists())

    def test_rejects_oversized_uncompressed_total(self) -> None:
        z = self._zip({"big": b"0" * 5000})
        with self.assertRaises(ca.ArchiveRejected):
            ca.safe_extract_zip(z, self.tmp / "out", max_total_bytes=4096)


if __name__ == "__main__":
    unittest.main()
