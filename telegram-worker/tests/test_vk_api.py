"""Unit tests for vk_api (worker route /vk-call): pacing, retries, deadline, error passthrough.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
Network-free: a fake transport with a fake clock, plus a loopback stub HTTP server for
the real urllib transport. PySocks is only needed for the proxy path (not exercised here).
"""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402
import vk_api  # noqa: E402

TOKEN = "vk1.a.synthetic-token-for-tests"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def ok(response) -> vk_api.HttpReply:
    return vk_api.HttpReply(200, json.dumps({"response": response}).encode())


def vk_error(code: int, msg: str) -> vk_api.HttpReply:
    body = {"error": {"error_code": code, "error_msg": msg, "request_params": []}}
    return vk_api.HttpReply(200, json.dumps(body).encode())


class ScriptedTransport:
    """Replies from a script; each request costs `latency` seconds of fake time."""

    def __init__(self, clock: FakeClock, script: list, latency: float = 0.05) -> None:
        self.clock = clock
        self.script = list(script)
        self.latency = latency
        self.calls: list[tuple[str, dict[str, str], float, float]] = []

    def post(self, method: str, form: bytes, timeout: float) -> vk_api.HttpReply:
        fields = dict(urllib.parse.parse_qsl(form.decode()))
        self.calls.append((method, fields, timeout, self.clock.now))
        self.clock.now += self.latency
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def run(payload: dict, transport: ScriptedTransport, clock: FakeClock, **kw) -> dict:
    return vk_api.run_batch(
        payload,
        make_proxy=lambda _p: None,
        transport=transport,
        clock=clock,
        sleep=clock.sleep,
        **kw,
    )


def batch(*methods: str) -> dict:
    return {"token": TOKEN, "proxy": None, "calls": [{"method": m, "params": {}} for m in methods]}


class RunBatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()

    def test_returns_one_result_per_call_in_order(self) -> None:
        t = ScriptedTransport(self.clock, [ok([{"id": 1}]), ok({"count": 0, "items": []})])
        out = run(batch("users.get", "wall.get"), t, self.clock)
        self.assertEqual(
            out,
            {
                "ok": True,
                "results": [
                    {"ok": True, "response": [{"id": 1}]},
                    {"ok": True, "response": {"count": 0, "items": []}},
                ],
            },
        )

    def test_sends_version_token_and_encoded_params(self) -> None:
        t = ScriptedTransport(self.clock, [ok([])])
        payload = {
            "token": TOKEN,
            "calls": [{"method": "groups.getById", "params": {"group_ids": [1, 2], "extended": True}}],
        }
        run(payload, t, self.clock)
        method, fields, timeout, _ = t.calls[0]
        self.assertEqual(method, "groups.getById")
        self.assertEqual(fields["v"], "5.199")
        self.assertEqual(fields["access_token"], TOKEN)
        self.assertEqual(fields["group_ids"], "1,2")
        self.assertEqual(fields["extended"], "1")
        self.assertLessEqual(timeout, vk_api.CALL_TIMEOUT_S)

    def test_paces_requests_to_at_most_three_per_second(self) -> None:
        t = ScriptedTransport(self.clock, [ok(i) for i in range(7)], latency=0.01)
        run(batch(*["users.get"] * 7), t, self.clock)
        starts = [c[3] for c in t.calls]
        for a, b in zip(starts, starts[1:]):
            self.assertGreaterEqual(b - a, 1 / 3 - 1e-9)
        in_first_second = [s for s in starts if s < starts[0] + 1.0]
        self.assertLessEqual(len(in_first_second), 3)

    def test_passes_vk_errors_through_without_retry(self) -> None:
        t = ScriptedTransport(self.clock, [vk_error(5, "User authorization failed")])
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(
            out["results"], [{"ok": False, "error": {"code": 5, "msg": "User authorization failed"}}]
        )
        self.assertEqual(len(t.calls), 1)

    def test_retries_error_6_on_the_same_token_after_a_pause(self) -> None:
        t = ScriptedTransport(self.clock, [vk_error(6, "Too many requests per second"), ok([1])])
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(out["results"], [{"ok": True, "response": [1]}])
        self.assertEqual([c[1]["access_token"] for c in t.calls], [TOKEN, TOKEN])
        self.assertIn(vk_api.TOO_MANY_REQUESTS_PAUSE_S, self.clock.sleeps)

    def test_gives_up_on_error_6_after_bounded_retries(self) -> None:
        t = ScriptedTransport(self.clock, [vk_error(6, "Too many")] * 5)
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(out["results"][0]["error"]["code"], 6)
        self.assertEqual(len(t.calls), 1 + vk_api.MAX_TOO_MANY_RETRIES)

    def test_retries_network_failures_at_most_twice(self) -> None:
        fail = vk_api.TransientError("timeout")
        t = ScriptedTransport(self.clock, [fail, fail, fail, ok([1])])
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(out["results"][0]["error"]["code"], vk_api.CODE_NETWORK)
        self.assertEqual(len(t.calls), 1 + vk_api.MAX_NETWORK_RETRIES)

    def test_recovers_after_one_network_failure(self) -> None:
        t = ScriptedTransport(self.clock, [vk_api.TransientError("http 502"), ok([1])])
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(out["results"], [{"ok": True, "response": [1]}])

    def test_unrun_calls_end_as_deadline_errors(self) -> None:
        t = ScriptedTransport(self.clock, [ok(i) for i in range(10)], latency=4.0)
        out = run(batch(*["wall.get"] * 10), t, self.clock, deadline_s=10.0)
        results = out["results"]
        self.assertEqual(len(results), 10)
        self.assertEqual(len(t.calls), 3)  # starts at 0 s, 4 s, 8 s; 12 s is past the deadline
        self.assertTrue(all(r["ok"] for r in results[:3]))
        for r in results[3:]:
            self.assertEqual(r, {"ok": False, "error": {"code": -1, "msg": "deadline"}})

    def test_per_call_timeout_never_exceeds_time_left(self) -> None:
        t = ScriptedTransport(self.clock, [ok(1), ok(2)], latency=7.0)
        run(batch("wall.get", "wall.get"), t, self.clock, deadline_s=10.0)
        self.assertAlmostEqual(t.calls[1][2], 10.0 - 7.0, places=6)

    def test_error_message_never_echoes_the_token(self) -> None:
        t = ScriptedTransport(self.clock, [vk_error(100, f"bad param access_token={TOKEN}")])
        out = run(batch("wall.get"), t, self.clock)
        self.assertNotIn(TOKEN, json.dumps(out))

    def test_rejects_malformed_batches_before_any_request(self) -> None:
        cases = [
            {"token": "", "calls": [{"method": "users.get"}]},
            {"token": TOKEN, "calls": []},
            {"token": TOKEN, "calls": [{"method": "users.get"}] * 26},
            {"token": TOKEN, "calls": [{"method": "../execute"}]},
            {"token": TOKEN, "calls": [{"method": "users.get", "params": {"v": "5.0"}}]},
            {"token": TOKEN, "calls": [{"method": "users.get", "params": {"x": {"a": 1}}}]},
        ]
        for payload in cases:
            t = ScriptedTransport(self.clock, [])
            with self.subTest(payload=str(payload)[:60]):
                out = run(payload, t, self.clock)
                self.assertFalse(out["ok"])
                self.assertEqual(t.calls, [])

    def test_rejects_methods_outside_the_read_only_allowlist(self) -> None:
        for method in ("wall.post", "messages.send", "execute", "account.ban", "groups.join"):
            t = ScriptedTransport(self.clock, [])
            with self.subTest(method=method):
                out = run(batch("users.get", method), t, self.clock)
                self.assertEqual(out, {"ok": False, "error": "Недопустимый метод VK"})
                self.assertEqual(t.calls, [])

    def test_accepts_every_read_only_method_the_app_uses(self) -> None:
        used = (
            "users.get", "newsfeed.search", "wall.get", "wall.getComments",
            "board.getTopics", "board.getComments", "groups.getById", "utils.resolveScreenName",
        )
        t = ScriptedTransport(self.clock, [ok([]) for _ in used])
        out = run(batch(*used), t, self.clock)
        self.assertTrue(out["ok"])
        self.assertEqual([c[0] for c in t.calls], list(used))

    def test_http_error_status_is_reported(self) -> None:
        t = ScriptedTransport(self.clock, [vk_api.HttpReply(404, b"")])
        out = run(batch("users.get"), t, self.clock)
        self.assertEqual(out["results"][0]["error"]["code"], vk_api.CODE_HTTP)


class StubVk(BaseHTTPRequestHandler):
    seen: list[tuple[str, dict[str, str]]] = []

    def do_POST(self) -> None:  # noqa: N802
        size = int(self.headers.get("Content-Length") or 0)
        fields = dict(urllib.parse.parse_qsl(self.rfile.read(size).decode()))
        StubVk.seen.append((self.path, fields))
        if self.path.endswith("/groups.getById"):  # stands in for a redirecting host
            self.send_response(302)
            self.send_header("Location", "http://example.com/")
            self.end_headers()
            return
        if self.path.endswith("/board.getTopics"):  # stands in for a failing host
            self.send_response(503)
            self.end_headers()
            return
        body = (
            {"response": [{"id": 7}]}
            if self.path.endswith("/users.get")
            else {"error": {"error_code": 15, "error_msg": "Access denied"}}
        )
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args) -> None:  # keep test output clean
        return


class UrllibTransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), StubVk)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        port = cls.server.server_address[1]
        cls.transport = vk_api.UrllibTransport(None, base_url=f"http://127.0.0.1:{port}/method/")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        StubVk.seen.clear()

    def _run(self, *methods: str) -> dict:
        return vk_api.run_batch(batch(*methods), make_proxy=lambda _p: None, transport=self.transport)

    def test_posts_form_to_method_path_and_parses_success_and_error(self) -> None:
        out = self._run("users.get", "wall.getComments")
        self.assertEqual(out["results"][0], {"ok": True, "response": [{"id": 7}]})
        self.assertEqual(out["results"][1], {"ok": False, "error": {"code": 15, "msg": "Access denied"}})
        path, fields = StubVk.seen[0]
        self.assertEqual(path, "/method/users.get")
        self.assertEqual(fields["v"], "5.199")
        self.assertEqual(fields["access_token"], TOKEN)

    def test_does_not_follow_redirects(self) -> None:
        out = self._run("groups.getById")
        self.assertEqual(out["results"][0]["error"]["code"], vk_api.CODE_HTTP)
        self.assertEqual(len(StubVk.seen), 1)

    def test_5xx_is_retried_then_reported_as_network(self) -> None:
        out = vk_api.run_batch(
            batch("board.getTopics"),
            make_proxy=lambda _p: None,
            transport=self.transport,
            sleep=lambda _s: None,
        )
        self.assertEqual(out["results"][0]["error"]["code"], vk_api.CODE_NETWORK)
        self.assertEqual(len(StubVk.seen), 1 + vk_api.MAX_NETWORK_RETRIES)


class RunActionVkCallTest(unittest.TestCase):
    def test_route_rejects_a_batch_without_token(self) -> None:
        out = asyncio.run(ca.run_action({"action": "vk_call", "calls": [{"method": "users.get"}]}))
        self.assertEqual(out, {"ok": False, "error": "Нет токена VK"})

    def test_route_refuses_an_internal_proxy_host(self) -> None:
        payload = {
            "action": "vk_call",
            "token": TOKEN,
            "proxy": {"host": "127.0.0.1", "port": 1080, "protocol": "socks5"},
            "calls": [{"method": "users.get", "params": {}}],
        }
        out = asyncio.run(ca.run_action(payload))
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "proxy_error")
        self.assertIn("внутренняя сеть", out["error"])


if __name__ == "__main__":
    unittest.main()
