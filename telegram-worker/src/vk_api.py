"""Batch VK API calls through the account's proxy (worker route /vk-call).

Transport only: the app (lib/vk/*) owns parsing, limits and error policy. This module
paces calls (<=3 rps per token), retries network/5xx failures and VK error 6 a bounded
number of times, and stops at a hard deadline so the worker slot is always released.
The access token never leaves the request body and is never logged or echoed.
"""
from __future__ import annotations

import http.client
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol

API_BASE = "https://api.vk.com/method/"
API_VERSION = "5.199"
MAX_CALLS = 25
DEADLINE_S = 45.0
CALL_TIMEOUT_S = 15.0
# 3 requests per second per token (VK limit for user tokens), retries included.
MIN_INTERVAL_S = 0.34
MAX_NETWORK_RETRIES = 2
MAX_TOO_MANY_RETRIES = 2
TOO_MANY_REQUESTS_PAUSE_S = 1.0
NETWORK_RETRY_PAUSE_S = 1.0
MAX_ERROR_MSG = 300

VK_TOO_MANY_REQUESTS = 6
# Transport-level codes (negative, never collide with VK's positive error codes).
CODE_DEADLINE = -1
CODE_NETWORK = -2
CODE_HTTP = -3
CODE_BAD_RESPONSE = -4

_METHOD_RE = re.compile(r"^[a-z]+\.[a-zA-Z]+$")
_SCALARS = (str, int, float, bool)


class BatchRejected(ValueError):
    """Payload is malformed; nothing was sent to VK."""


class TransientError(Exception):
    """Network failure or HTTP 5xx: worth one more attempt."""


@dataclass(frozen=True)
class HttpReply:
    status: int
    body: bytes


class Transport(Protocol):
    def post(self, method: str, form: bytes, timeout: float) -> HttpReply: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The host is fixed: a redirect elsewhere is an error, never followed."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


class UrllibTransport:
    """POSTs form data to `<base>/<method>`; `proxy` is a check_account.make_proxy tuple."""

    def __init__(self, proxy: tuple | None, base_url: str = API_BASE) -> None:
        handlers: list[urllib.request.BaseHandler] = [
            urllib.request.ProxyHandler({}),  # ignore HTTP(S)_PROXY from the environment
            _NoRedirect(),
        ]
        if proxy is not None:
            from sockshandler import SocksiPyHandler

            handlers.append(SocksiPyHandler(*proxy))
        self._opener = urllib.request.build_opener(*handlers)
        self._base = base_url

    def post(self, method: str, form: bytes, timeout: float) -> HttpReply:
        req = urllib.request.Request(
            self._base + method,
            data=form,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                return HttpReply(resp.status, resp.read())
        except urllib.error.HTTPError as e:
            if e.code >= 500:
                raise TransientError(f"http {e.code}") from None
            return HttpReply(e.code, b"")
        except (urllib.error.URLError, http.client.HTTPException, socket.timeout, OSError) as e:
            raise TransientError(type(e).__name__) from None


def _encode_value(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (list, tuple)):
        return ",".join(_encode_value(v) for v in value)
    return str(value)


def _validate(payload: dict[str, Any]) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
    token = payload.get("token")
    if not isinstance(token, str) or not token.strip():
        raise BatchRejected("Нет токена VK")
    calls = payload.get("calls")
    if not isinstance(calls, list) or not 1 <= len(calls) <= MAX_CALLS:
        raise BatchRejected(f"Нужно от 1 до {MAX_CALLS} вызовов")
    out: list[tuple[str, dict[str, Any]]] = []
    for call in calls:
        method = call.get("method") if isinstance(call, dict) else None
        params = call.get("params", {}) if isinstance(call, dict) else None
        if not isinstance(method, str) or not _METHOD_RE.match(method):
            raise BatchRejected("Недопустимый метод VK")
        if not isinstance(params, dict):
            raise BatchRejected("Параметры вызова должны быть объектом")
        for key, value in params.items():
            items = value if isinstance(value, (list, tuple)) else [value]
            if key in ("access_token", "v") or not all(isinstance(v, _SCALARS) for v in items):
                raise BatchRejected("Недопустимый параметр вызова")
        out.append((method, params))
    return token.strip(), out


def _error(code: int, msg: str, token: str) -> dict[str, Any]:
    clean = str(msg).replace(token, "***")[:MAX_ERROR_MSG]
    return {"ok": False, "error": {"code": code, "msg": clean}}


def _parse_reply(reply: HttpReply, token: str) -> dict[str, Any]:
    if reply.status != 200:
        return _error(CODE_HTTP, f"http {reply.status}", token)
    try:
        data = json.loads(reply.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _error(CODE_BAD_RESPONSE, "bad json", token)
    if isinstance(data, dict) and "response" in data:
        return {"ok": True, "response": data["response"]}
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict) and isinstance(err.get("error_code"), int):
        return _error(err["error_code"], str(err.get("error_msg") or ""), token)
    return _error(CODE_BAD_RESPONSE, "unexpected response", token)


class _Runner:
    def __init__(
        self,
        token: str,
        transport: Transport,
        clock: Callable[[], float],
        sleep: Callable[[float], None],
        deadline_s: float,
    ) -> None:
        self.token = token
        self.transport = transport
        self.clock = clock
        self.sleep = sleep
        self.deadline = clock() + deadline_s
        self.last_start: float | None = None

    def _left(self) -> float:
        return self.deadline - self.clock()

    def _wait(self, seconds: float) -> bool:
        """Sleep unless it would cross the deadline; False = out of time."""
        if seconds > 0:
            if seconds >= self._left():
                return False
            self.sleep(seconds)
        return self._left() > 0

    def _pace(self) -> bool:
        if self.last_start is None:
            return self._left() > 0
        return self._wait(self.last_start + MIN_INTERVAL_S - self.clock())

    def _attempt(self, method: str, form: bytes) -> dict[str, Any] | None:
        """One paced request; None = no time left to send it."""
        if not self._pace():
            return None
        self.last_start = self.clock()
        try:
            reply = self.transport.post(method, form, min(CALL_TIMEOUT_S, self._left()))
        except TransientError as e:
            return {"transient": True, **_error(CODE_NETWORK, str(e), self.token)}
        return _parse_reply(reply, self.token)

    def run_call(self, method: str, params: dict[str, Any]) -> dict[str, Any] | None:
        fields = {k: _encode_value(v) for k, v in params.items()}
        fields.update(access_token=self.token, v=API_VERSION)
        form = urllib.parse.urlencode(fields).encode("ascii")
        network_left = MAX_NETWORK_RETRIES
        too_many_left = MAX_TOO_MANY_RETRIES
        while True:
            result = self._attempt(method, form)
            if result is None:
                return None
            if result.pop("transient", False) and network_left > 0:
                network_left -= 1
                if not self._wait(NETWORK_RETRY_PAUSE_S):
                    return result
                continue
            code = result.get("error", {}).get("code")
            if code == VK_TOO_MANY_REQUESTS and too_many_left > 0:
                too_many_left -= 1
                if not self._wait(TOO_MANY_REQUESTS_PAUSE_S):
                    return result
                continue
            return result


def run_batch(
    payload: dict[str, Any],
    *,
    make_proxy: Callable[[dict | None], tuple | None],
    transport: Transport | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    deadline_s: float = DEADLINE_S,
) -> dict[str, Any]:
    """Run `payload.calls` in order; one result per call, unrun calls end as `deadline`."""
    try:
        token, calls = _validate(payload)
    except BatchRejected as e:
        return {"ok": False, "error": str(e)}
    if transport is None:
        proxy = payload.get("proxy") if isinstance(payload.get("proxy"), dict) else None
        try:
            transport = UrllibTransport(make_proxy(proxy))
        except (ValueError, KeyError, TypeError) as e:
            # ProxyHostRejected (SSRF guard / unresolvable host) carries a user-facing text.
            msg = str(e) if type(e).__name__ == "ProxyHostRejected" else "Некорректный прокси"
            return {"ok": False, "status": "proxy_error", "error": msg[:MAX_ERROR_MSG]}
    runner = _Runner(token, transport, clock, sleep, deadline_s)
    results: list[dict[str, Any]] = []
    for method, params in calls:
        result = runner.run_call(method, params)
        results.append(result or _error(CODE_DEADLINE, "deadline", token))
    return {"ok": True, "results": results}
