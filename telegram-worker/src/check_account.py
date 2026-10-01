#!/usr/bin/env python3
"""Telegram worker actions: check / join / scan / send / inbox / profile."""
from __future__ import annotations

import argparse
import asyncio
import base64
import ipaddress
import json
import random
import re
import shutil
import socket
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

TDESKTOP_API_ID = 2040
TDESKTOP_API_HASH = "b18441a1ff607e10a989891a5462e627"


def classify_error(exc: BaseException) -> str:
    name = type(exc).__name__
    text = str(exc).lower()
    combined = f"{name} {text}"
    if any(
        x in combined
        for x in (
            "authkeyunregistered",
            "sessionrevoked",
            "userdeactivated",
            "auth_key",
            "session_revoked",
            "authorization key",
        )
    ):
        if "deactivated" in combined or "banned" in combined:
            return "frozen"
        return "unauthorized"
    if "frozen" in combined or "freeze" in combined or "420" in combined:
        return "frozen"
    if "flood" in combined:
        return "disconnected"
    if any(
        x in combined
        for x in (
            "proxy",
            "socks",
            "connection to telegram failed",
            "connection",
            "timeout",
            "network",
            "oserror",
            "errno",
        )
    ):
        if (
            "proxy" in combined
            or "socks" in combined
            or "connection to telegram failed" in combined
        ):
            return "proxy_error"
        return "disconnected"
    return "disconnected"


def humanize_connect_error(exc: BaseException, has_proxy: bool) -> str:
    raw = str(exc).strip()
    low = raw.lower()
    if "connection to telegram failed" in low or "failed" in low and "time" in low:
        if has_proxy:
            return (
                "Не удалось подключиться к Telegram через прокси (5+ попыток). "
                "Проверьте прокси аккаунта: статус Active, host:port и пароль. "
                f"({raw[:120]})"
            )
        return (
            "Не удалось подключиться к Telegram. "
            "Нужен рабочий прокси на аккаунте или доступ к DC Telegram с этой сети. "
            f"({raw[:120]})"
        )
    return raw[:400]


def is_frozen_rpc(exc: BaseException) -> bool:
    text = str(exc).upper()
    code = getattr(exc, "code", None)
    return code == 420 or "FROZEN_METHOD_INVALID" in text or "FROZEN" in text


def frozen_action_error(action: str) -> dict[str, Any]:
    return {
        "ok": False,
        "status": "frozen",
        "join": "frozen",
        "error": (
            "Аккаунт заморожен Telegram (FROZEN_METHOD_INVALID). "
            f"«{action}» недоступно — назначьте другой рабочий аккаунт."
        ),
        "messages": [],
        "title": "",
    }


class ProxyHostRejected(ValueError):
    """Proxy host resolves to an internal address (SSRF guard) or does not resolve."""


class ArchiveRejected(ValueError):
    """Uploaded account archive exceeds extraction limits (zip bomb guard)."""


_CGNAT = ipaddress.ip_network("100.64.0.0/10")
MAX_ZIP_ENTRIES = 5000
MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024


def _is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    ):
        return False
    if isinstance(ip, ipaddress.IPv4Address) and ip in _CGNAT:
        return False
    return ip.is_global


def resolve_public_host(host: str, port: int, *, resolver=socket.getaddrinfo) -> str:
    """Resolve host; reject if ANY address is internal. Returns an IP to connect to,
    so a second (rebinding) DNS answer cannot redirect the connection."""
    try:
        infos = resolver(host, port, 0, socket.SOCK_STREAM)
    except (OSError, UnicodeError) as e:
        raise ProxyHostRejected("Адрес прокси не резолвится") from e
    addrs = [str(info[4][0]).split("%", 1)[0] for info in infos]
    if not addrs:
        raise ProxyHostRejected("Адрес прокси не резолвится")
    for addr in addrs:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError as e:
            raise ProxyHostRejected("Недопустимый адрес прокси") from e
        if not _is_public_ip(ip):
            raise ProxyHostRejected("Недопустимый адрес прокси (внутренняя сеть)")
    return addrs[0]


def safe_extract_zip(
    zpath: Path,
    dest: Path,
    *,
    max_entries: int = MAX_ZIP_ENTRIES,
    max_total_bytes: int = MAX_ZIP_TOTAL_BYTES,
) -> None:
    # zipfile caps each member's output at its declared file_size, so summing
    # declared sizes bounds the real extraction size.
    with zipfile.ZipFile(zpath, "r") as zf:
        infos = zf.infolist()
        if len(infos) > max_entries:
            raise ArchiveRejected("Архив содержит слишком много файлов")
        if sum(i.file_size for i in infos) > max_total_bytes:
            raise ArchiveRejected("Архив слишком большой после распаковки")
        zf.extractall(dest)


def make_proxy(proxy: dict | None):
    if not proxy or not proxy.get("host"):
        return None
    import socks

    kind = socks.SOCKS5 if proxy.get("protocol", "socks5") == "socks5" else socks.HTTP
    return (
        kind,
        resolve_public_host(str(proxy["host"]).strip(), int(proxy["port"])),
        int(proxy["port"]),
        True,
        proxy.get("username") or None,
        proxy.get("password") or None,
    )


# Быстрый TG-probe: один таргет. Полная проверка — через Telethon на аккаунте.
_TG_PROBE_TARGETS: tuple[tuple[str, int], ...] = (
    ("api.telegram.org", 443),
)


def probe_telegram_via_proxy(
    host: str,
    port: int,
    protocol: str,
    username: str | None,
    password: str | None,
    timeout: float = 2.5,
) -> tuple[bool, str]:
    """TCP до Telegram через прокси. True = канал до TG живой."""
    import socket
    import time

    import socks

    proto = (protocol or "socks5").lower()
    last_err = "TG недоступен"
    deadline = time.monotonic() + 3.0
    for dc_host, dc_port in _TG_PROBE_TARGETS:
        if time.monotonic() >= deadline:
            break
        sock = None
        try:
            slot = max(1.0, min(timeout, deadline - time.monotonic()))
            if proto == "http":
                sock = socket.create_connection((host, port), timeout=slot)
                sock.settimeout(slot)
                auth = ""
                if username or password:
                    import base64 as _b64

                    token = _b64.b64encode(
                        f"{username or ''}:{password or ''}".encode()
                    ).decode()
                    auth = f"Proxy-Authorization: Basic {token}\r\n"
                req = (
                    f"CONNECT {dc_host}:{dc_port} HTTP/1.1\r\n"
                    f"Host: {dc_host}:{dc_port}\r\n"
                    f"{auth}\r\n"
                ).encode()
                sock.sendall(req)
                resp = b""
                while len(resp) < 256 and b"\r\n\r\n" not in resp:
                    chunk = sock.recv(256)
                    if not chunk:
                        break
                    resp += chunk
                text = resp.decode("utf-8", errors="ignore")
                first = text.split("\r\n", 1)[0]
                if " 200 " in first or first.startswith("HTTP/1.0 200") or first.startswith(
                    "HTTP/1.1 200"
                ):
                    return True, f"{proto}:{dc_host}:{dc_port}"
                code = re.match(r"HTTP/\d(?:\.\d)? (\d{3})", first)
                last_err = f"HTTP CONNECT отказ ({code.group(1)})" if code else "HTTP CONNECT отказ"
            else:
                sock = socks.socksocket()
                sock.set_proxy(
                    socks.SOCKS5,
                    host,
                    port,
                    True,
                    username,
                    password,
                )
                sock.settimeout(slot)
                sock.connect((dc_host, dc_port))
                return True, f"{proto}:{dc_host}:{dc_port}"
        except Exception as e:
            last_err = f"нет соединения ({type(e).__name__})"
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
    return False, last_err


def _http_exit_ip(
    host: str,
    port: int,
    username: str | None,
    password: str | None,
    timeout: float = 4.0,
) -> tuple[bool, str, str]:
    import urllib.request
    from urllib.parse import quote

    proxy_url = f"http://{host}:{port}"
    if username or password:
        u = quote(username or "", safe="")
        p = quote(password or "", safe="")
        proxy_url = f"http://{u}:{p}@{host}:{port}"
    handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
    opener = urllib.request.build_opener(handler)
    with opener.open("http://api.ipify.org/", timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="ignore").strip()
    ip = body if body.count(".") == 3 else ""
    if not ip:
        return False, "", "HTTP-прокси ответил без IP"
    return True, ip, ""


def _socks_exit_ip(
    host: str,
    port: int,
    username: str | None,
    password: str | None,
    timeout: float = 4.0,
) -> tuple[bool, str, str]:
    import re as _re
    import socket

    import socks

    s = socks.socksocket()
    try:
        s.set_proxy(socks.SOCKS5, host, port, True, username, password)
        s.settimeout(timeout)
        s.connect(("api.ipify.org", 80))
        s.sendall(
            b"GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n"
            b"User-Agent: Uniseller-ProxyCheck/1\r\n\r\n"
        )
        chunks: list[bytes] = []
        while True:
            try:
                part = s.recv(4096)
            except socket.timeout:
                break
            if not part:
                break
            chunks.append(part)
            joined = b"".join(chunks)
            if b"\r\n\r\n" in joined and len(joined) > 40:
                break
        text = b"".join(chunks).decode("utf-8", errors="ignore")
        if "407" in text[:40]:
            return False, "", "SOCKS5/прокси: нужна авторизация"
        body = text.split("\r\n\r\n", 1)[-1].strip()
        m = _re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", body)
        if not m:
            return False, "", "SOCKS5: нет IP в ответе (проверьте логин/пароль)"
        return True, m.group(0), ""
    finally:
        try:
            s.close()
        except Exception:
            pass


async def check_proxy_alive(payload: dict[str, Any]) -> dict[str, Any]:
    """Быстрая проверка: интернет (~4с) + один TG-probe (~2.5с). Soft-fail по TG."""
    import time

    import socks

    host = str(payload.get("host") or "").strip()
    port = int(payload.get("port") or 0)
    protocol = str(payload.get("protocol") or "socks5").lower()
    if protocol not in ("http", "socks5"):
        protocol = "socks5"
    username = str(payload.get("username") or "") or None
    password = str(payload.get("password") or "") or None
    if not host or not (1 <= port <= 65535):
        return {"ok": False, "error": "Некорректный host/port", "latencyMs": 0}
    try:
        host = resolve_public_host(host, port)
    except ProxyHostRejected as e:
        return {"ok": False, "error": str(e), "latencyMs": 0, "telegramOk": False}

    started = time.time()
    # Заявленный протокол → при фейле сразу альтернатива (мобильные часто SOCKS5).
    order = [protocol, "socks5" if protocol == "http" else "http"]
    net_ok = False
    exit_ip = ""
    used_proto = protocol
    net_err = "Нет ответа"

    for proto in order:
        try:
            if proto == "http":
                ok, ip, err = _http_exit_ip(host, port, username, password, timeout=4.0)
            else:
                ok, ip, err = _socks_exit_ip(host, port, username, password, timeout=4.0)
            if ok:
                net_ok = True
                exit_ip = ip
                used_proto = proto
                net_err = ""
                break
            net_err = err or net_err
        except socks.ProxyConnectionError:
            net_err = "Не удалось подключиться к прокси"
        except socks.ProxyError as e:
            net_err = (
                "Неверный логин или пароль прокси"
                if "auth" in str(e).lower()
                else "Ошибка прокси"
            )
        except Exception as e:
            # Текст исключения может содержать ответ удалённого сервера — наружу только код.
            msg = str(e)
            if "407" in msg or "authentication" in msg.lower():
                net_err = "Неверный логин или пароль прокси"
            else:
                net_err = f"Прокси не отвечает ({type(e).__name__})"

    if not net_ok:
        return {
            "ok": False,
            "error": net_err[:400],
            "latencyMs": int((time.time() - started) * 1000),
            "telegramOk": False,
        }

    # Один быстрый TG-probe без второй протоколной попытки (экономия ~10–15с).
    tg_ok, tg_detail = probe_telegram_via_proxy(
        host, port, used_proto, username, password, timeout=2.5
    )
    warn = ""
    if not tg_ok:
        warn = (
            "Интернет ок, быстрый TG-probe не прошёл "
            f"({tg_detail}). Прокси активен — проверьте аккаунтом."
        )[:500]

    return {
        "ok": True,
        "exitIp": exit_ip,
        "telegramOk": bool(tg_ok),
        "protocol": used_proto,
        "latencyMs": int((time.time() - started) * 1000),
        "warning": warn,
        "error": warn if not tg_ok else "",
    }


async def load_client_from_tdata(
    tdata_dir: Path,
    proxy: dict | None,
    two_fa: str,
    *,
    allow_session_refresh: bool = True,
):
    """tdata → Telethon. Сначала текущая сессия, при отказе — CreateNewSession (авто-смена)."""
    from opentele.td import TDesktop
    from opentele.api import UseCurrentSession, CreateNewSession, API

    td = TDesktop(str(tdata_dir))
    if not td.isLoaded():
        raise RuntimeError("Не удалось прочитать tdata")

    flags = [UseCurrentSession]
    if allow_session_refresh:
        flags.append(CreateNewSession)

    last_err: BaseException | None = None
    for flag in flags:
        session_path = str(
            tdata_dir
            / ("uniseller_new.session" if flag is CreateNewSession else "uniseller.session")
        )
        client = None
        try:
            kwargs = dict(
                session=session_path,
                flag=flag,
                api=API.TelegramDesktop,
                proxy=proxy,
                connection_retries=1,
                retry_delay=0,
                timeout=6,
                request_retries=1,
            )
            try:
                client = await td.ToTelethon(**kwargs, password=two_fa or None)
            except TypeError:
                client = await td.ToTelethon(**kwargs)
            await client.connect()
            if await client.is_user_authorized():
                client._uniseller_session_refreshed = flag is CreateNewSession  # type: ignore[attr-defined]
                return client
            try:
                await client.disconnect()
            except Exception:
                pass
            last_err = RuntimeError("Сессия больше не действительна")
            continue
        except Exception as e:
            last_err = e
            try:
                if client:
                    await client.disconnect()
            except Exception:
                pass
            low = str(e).lower()
            if any(
                x in low
                for x in (
                    "proxy",
                    "socks",
                    "connection to telegram failed",
                    "timeout",
                    "network",
                    "не удалось подключиться",
                )
            ):
                raise RuntimeError(humanize_connect_error(e, bool(proxy))) from e
            continue

    if last_err:
        raise RuntimeError(humanize_connect_error(last_err, bool(proxy))) from last_err
    raise RuntimeError("Сессия больше не действительна")
    _ = two_fa


async def load_client_from_session_file(
    session_path: Path, api_id: int, api_hash: str, proxy: dict | None
):
    from telethon import TelegramClient

    client = TelegramClient(
        str(session_path.with_suffix("")),
        api_id,
        api_hash,
        proxy=proxy,
        connection_retries=1,
        retry_delay=0,
        timeout=6,
        request_retries=1,
    )
    try:
        await client.connect()
    except Exception as e:
        raise RuntimeError(humanize_connect_error(e, bool(proxy))) from e
    return client


async def open_client(payload: dict[str, Any], work: Path):
    """Открыть клиент: tdata и/или .session с авто-fallback (безопасная смена источника сессии)."""
    fmt = payload.get("format") or "tdata"
    proxy_raw = payload.get("proxy") if isinstance(payload.get("proxy"), dict) else None
    proxy = make_proxy(proxy_raw)
    two_fa = (payload.get("twoFA") or "").strip()
    allow_refresh = payload.get("allowSessionRefresh", True) is not False
    zip_b64 = payload.get("zipBase64") or ""
    if not zip_b64:
        raise RuntimeError("Нет данных сессии")

    raw = base64.b64decode(zip_b64)
    zpath = work / "account.zip"
    zpath.write_bytes(raw)
    safe_extract_zip(zpath, work / "unz")

    root = work / "unz"
    tdata = None
    for p in [root / "tdata", *root.rglob("tdata")]:
        if p.is_dir() and (p / "key_datas").exists():
            tdata = p
            break
    session_files = [p for p in root.rglob("*.session") if p.is_file()]
    # не брать наши временные первыми
    session_files.sort(key=lambda p: (0 if "uniseller" not in p.name else 1, str(p)))

    api_id = int(payload.get("apiId") or TDESKTOP_API_ID)
    api_hash = payload.get("apiHash") or TDESKTOP_API_HASH

    errors: list[str] = []
    # Порядок: по format, затем fallback на второй источник
    attempts: list[tuple[str, Any]] = []
    if fmt in ("tdata", "manual") and tdata:
        attempts.append(("tdata", tdata))
        if session_files:
            attempts.append(("session", session_files[0]))
    elif session_files:
        attempts.append(("session", session_files[0]))
        if tdata:
            attempts.append(("tdata", tdata))
    elif tdata:
        attempts.append(("tdata", tdata))
    else:
        raise RuntimeError("В архиве нет tdata или session")

    last_exc: BaseException | None = None
    for kind, src in attempts:
        try:
            if kind == "tdata":
                client = await load_client_from_tdata(
                    src, proxy, two_fa, allow_session_refresh=allow_refresh
                )
            else:
                client = await load_client_from_session_file(src, api_id, api_hash, proxy)
                if not await client.is_user_authorized():
                    try:
                        await client.disconnect()
                    except Exception:
                        pass
                    raise RuntimeError("Сессия больше не действительна")
            return client
        except Exception as e:
            last_exc = e
            errors.append(f"{kind}: {str(e)[:120]}")
            # Сетевой сбой — нет смысла пробовать второй файл на том же прокси
            low = str(e).lower()
            if any(
                x in low
                for x in (
                    "proxy",
                    "socks",
                    "connection to telegram failed",
                    "не удалось подключиться",
                    "timeout",
                )
            ):
                raise
            continue

    msg = str(last_exc or "Не удалось открыть сессию")
    if "Сессия больше не действительна" in msg or "auth" in msg.lower():
        raise RuntimeError(
            "Сессия больше не действительна"
            + (f" ({'; '.join(errors)})" if errors else "")
        )
    if "Не удалось подключиться" not in msg and (
        "connection to telegram failed" in msg.lower() or "failed" in msg.lower()
    ):
        raise RuntimeError(humanize_connect_error(last_exc or RuntimeError(msg), bool(proxy)))
    raise RuntimeError(msg[:400])


async def check_spambot(client) -> str | None:
    try:
        from telethon.tl.functions.contacts import ResolveUsernameRequest

        await client(ResolveUsernameRequest("SpamBot"))
        await client.send_message("SpamBot", "/start")
        await asyncio.sleep(2.5)
        msgs = await client.get_messages("SpamBot", limit=3)
        body = " ".join((m.message or "") for m in msgs if m and m.message).lower()
        if not body:
            return None
        if any(
            x in body
            for x in (
                "limited",
                "ограничен",
                "spam",
                "спам",
                "can't send",
                "не можете отправлять",
            )
        ):
            return "spamblock"
        if any(x in body for x in ("frozen", "заморожен", "deactivate")):
            return "frozen"
    except Exception as e:
        err = classify_error(e)
        if err in ("frozen", "unauthorized", "spamblock"):
            return err
    return None


def parse_group_ref(url: str) -> dict[str, str]:
    u = (url or "").strip()
    if u.startswith("@"):
        return {"kind": "username", "value": u[1:]}
    m = re.search(
        r"(?:https?://)?t\.me/(?:\+|joinchat/)([a-zA-Z0-9_-]+)", u, re.I
    )
    if m:
        return {"kind": "invite", "value": m.group(1)}
    # t.me/c/<id>/<msg> — ссылка на сообщение приватного канала: только внутренний id
    m = re.search(r"(?:https?://)?t\.me/c/(\d+)", u, re.I)
    if m:
        return {"kind": "channel_id", "value": m.group(1)}
    # t.me/s/<name> — веб-превью публичного канала
    m = re.search(r"(?:https?://)?t\.me/(?:s/)?([a-zA-Z0-9_]{5,32})", u, re.I)
    if m:
        return {"kind": "username", "value": m.group(1)}
    raise RuntimeError("Некорректная ссылка на группу/канал")


async def _is_member(client, entity) -> bool:
    """Единая проверка членства. Неизвестно → False (не цементируем ложный join)."""
    from telethon.tl.functions.channels import GetParticipantRequest
    from telethon.errors import UserNotParticipantError

    try:
        me = await client.get_me()
        await client(GetParticipantRequest(entity, me))
        return True
    except UserNotParticipantError:
        return False
    except Exception:
        try:
            perms = await client.get_permissions(entity)
            return bool(perms) and not getattr(perms, "has_left", False)
        except Exception:
            return False


async def _join_entity(client, entity) -> dict[str, Any]:
    """JoinChannel в уже найденный entity + проверка членства. FloodWait — наверх вызывающему."""
    from telethon.tl.functions.channels import JoinChannelRequest
    from telethon.errors import (
        UserAlreadyParticipantError,
        InviteRequestSentError,
        ChannelPrivateError,
        UserBannedInChannelError,
        RPCError,
    )

    title = getattr(entity, "title", None) or getattr(entity, "username", "") or ""
    peer = _peer_fields(entity)
    # Уже участник — сразу ok
    if await _is_member(client, entity):
        return {
            "ok": True,
            "status": "active",
            "join": "already",
            "title": title,
            "error": "",
            "member": True,
            **peer,
        }
    try:
        await client(JoinChannelRequest(entity))
    except UserAlreadyParticipantError:
        return {
            "ok": True,
            "status": "active",
            "join": "already",
            "title": title,
            "error": "",
            "member": True,
            **peer,
        }
    except InviteRequestSentError:
        return {
            "ok": True,
            "status": "pending",
            "join": "requested",
            "title": title,
            "error": "Заявка на вступление отправлена",
            "member": False,
            **peer,
        }
    except UserBannedInChannelError:
        return {
            "ok": False,
            "status": "error",
            "join": "banned",
            "title": title,
            "error": "Аккаунт забанен в этой группе",
            "member": False,
        }
    except ChannelPrivateError:
        return {
            "ok": False,
            "status": "error",
            "join": "private",
            "title": title,
            "error": "Группа приватная — нужен инвайт-ссылка",
            "member": False,
        }
    except RPCError as e:
        if is_frozen_rpc(e):
            return frozen_action_error("вступление в канал/группу")
        raise
    # Проверяем фактическое членство после JoinChannel
    ok_member = await _is_member(client, entity)
    if not ok_member:
        return {
            "ok": False,
            "status": "error",
            "join": "failed",
            "title": title,
            "error": "Telegram не подтвердил вступление. Попробуйте снова или инвайт-ссылку.",
            "member": False,
        }
    return {
        "ok": True,
        "status": "active",
        "join": "joined",
        "title": title,
        "error": "",
        "member": True,
        **peer,
    }


async def _resolve_for_join(client, url: str, peer_hint: dict | None):
    """entity группы/канала по ссылке или готовый ответ-ошибка join_group."""
    entity, resolve_err = await _resolve_entity(client, url, peer_hint=peer_hint)
    if resolve_err:
        return None, {
            "ok": False,
            "status": "error",
            "join": resolve_err.get("join") or "missing",
            "usernameMissing": bool(resolve_err.get("usernameMissing")),
            "accountBlind": bool(resolve_err.get("accountBlind")),
            "error": str(resolve_err.get("error") or "Не удалось найти группу")[:400],
            "member": False,
        }
    if entity is None:
        return None, {
            "ok": False,
            "status": "error",
            "join": "missing",
            "usernameMissing": True,
            "error": f"Слот не видит @{parse_group_ref(url)['value']}",
            "member": False,
        }
    return entity, None


async def _join_linked_discussion(client, url: str, peer_hint: dict | None) -> dict[str, Any]:
    """Вступить ТОЛЬКО в привязанное обсуждение канала, в котором аккаунт уже состоит."""
    from telethon.tl.functions.channels import GetFullChannelRequest

    channel, err = await _resolve_for_join(client, url, peer_hint)
    if err:
        return err
    if not await _is_member(client, channel):
        return {
            "ok": False,
            "status": "setup",
            "join": "need_join",
            "error": "Аккаунт не в канале — сначала нажмите «Вступить»",
            "member": False,
        }
    full = await client(GetFullChannelRequest(channel))
    linked_id = getattr(getattr(full, "full_chat", None), "linked_chat_id", None)
    if not linked_id:
        return {
            "ok": False,
            "status": "error",
            "join": "no_discussion",
            "error": "У канала нет обсуждения",
            "member": False,
        }
    linked = await client.get_entity(int(linked_id))
    res = await _join_entity(client, linked)
    # peer обсуждения не должен перезаписать peer канала в записи группы
    res.pop("channelId", None)
    res.pop("accessHash", None)
    res["discussionId"] = str(getattr(linked, "id", "") or "")
    res["discussionTitle"] = str(res.pop("title", "") or "")
    return res


async def join_group(
    client, url: str, peer_hint: dict | None = None, target: str = "group"
) -> dict[str, Any]:
    """target="discussion" — вступление только в обсуждение уже вступленного канала."""
    from telethon.tl.functions.messages import ImportChatInviteRequest, CheckChatInviteRequest
    from telethon.errors import (
        UserAlreadyParticipantError,
        InviteRequestSentError,
        FloodWaitError,
        RPCError,
    )

    ref = parse_group_ref(url)
    try:
        if target == "discussion":
            return await _join_linked_discussion(client, url, peer_hint)
        if ref["kind"] == "invite":
            try:
                await client(CheckChatInviteRequest(hash=ref["value"]))
            except RPCError as e:
                if is_frozen_rpc(e):
                    return frozen_action_error("вступление по инвайту")
            except Exception:
                pass
            try:
                updates = await client(ImportChatInviteRequest(ref["value"]))
                title = ""
                chats = getattr(updates, "chats", None) or []
                peer = _peer_fields(chats[0]) if chats else {}
                if chats:
                    title = peer.get("title") or getattr(chats[0], "title", "") or ""
                return {
                    "ok": True,
                    "status": "active",
                    "join": "joined",
                    "title": title,
                    "error": "",
                    "member": True,
                    **peer,
                }
            except UserAlreadyParticipantError:
                # Без entity — peer не известен; ниже username-ветка всегда отдаёт peer
                return {
                    "ok": True,
                    "status": "active",
                    "join": "already",
                    "title": "",
                    "error": "",
                    "member": True,
                }
            except InviteRequestSentError:
                return {
                    "ok": True,
                    "status": "pending",
                    "join": "requested",
                    "title": "",
                    "error": "Заявка на вступление отправлена",
                    "member": False,
                }
            except RPCError as e:
                if is_frozen_rpc(e):
                    return frozen_action_error("вступление по инвайту")
                raise
        entity, err = await _resolve_for_join(client, url, peer_hint)
        if err:
            return err
        return await _join_entity(client, entity)
    except FloodWaitError as e:
        return {
            "ok": False,
            "status": "setup",
            "join": "flood",
            "error": f"FloodWait {e.seconds}с",
            "member": False,
            "waitSec": int(e.seconds),
        }
    except RPCError as e:
        if is_frozen_rpc(e):
            return frozen_action_error("вступление")
        raise


# Messages returned per scan (REQ-5): the app judges them in ≤4 batches of 20.
SCAN_OUTPUT_CAP = 80
# Raw messages read per feed when paging forward from the cursor / first-scan start.
SCAN_FETCH_CAP = 1000
# First scan of a group (no cursor) looks back one day only, whatever the group depth (S8).
FIRST_SCAN_DEPTH = timedelta(days=1)
MIN_SCAN_TEXT_LENGTH = 3
# Channel without enough discussion messages: newest posts whose comments are read.
COMMENT_FALLBACK_POSTS = 40
COMMENT_FALLBACK_REPLIES = 40
COMMENT_FALLBACK_BELOW = 8


def history_window(cursor: str, first_scan_since: datetime) -> dict[str, Any]:
    """iter_messages kwargs for scan_group: oldest-first from the per-group cursor (last seen id) or,
    on the first scan, from `first_scan_since`, so paging across scans never skips a message."""
    raw = str(cursor or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return {"reverse": True, "offset_id": int(raw), "limit": SCAN_FETCH_CAP}
    return {"reverse": True, "offset_date": first_scan_since, "limit": SCAN_FETCH_CAP}


def _sender_name(sender: Any) -> str:
    full = " ".join(
        x for x in [getattr(sender, "first_name", None) or "", getattr(sender, "last_name", None) or ""] if x
    ).strip()
    return full or getattr(sender, "username", "") or str(getattr(sender, "id", ""))


def _peer_id_of(entity: Any) -> str:
    from telethon.utils import get_peer_id

    try:
        return str(get_peer_id(entity))
    except Exception:
        return str(getattr(entity, "id", "") or "")


async def scan_group(
    client,
    url: str,
    *,
    days: int = 0,
    cursor: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Сырые сообщения переписки для LLM-судьи (REQ-5): группы + обсуждения/комментарии к каналам.

    Фильтров по ключам, минус-словам, рекламе и намерению нет — лид решает судья приложения.
    Отбрасываются только: посты канала, авторы не-люди (боты/каналы), сообщения старше глубины,
    сбой `get_sender`. Ответ ≤ SCAN_OUTPUT_CAP сообщений в порядке возрастания id ленты.

    Окно: с `cursor` (последний обработанный id ленты группы/обсуждения) вперёд; первый скан
    (нет курсора) — за FIRST_SCAN_DEPTH, независимо от `days`. Старше окна (первый скан —
    FIRST_SCAN_DEPTH, далее `days` > 0) сообщение считается `skippedOld`. Курсор в ответе — последний обработанный id ленты
    group/discussion; id комментариев (fallback по постам канала) курсор не двигают.

    Счётчики (события за прогон): `fetched` — сообщения с текстом ≥ MIN_SCAN_TEXT_LENGTH, впервые
    увиденные в прогоне; пустые/короткие (медиа, сервисные, «ок») в `fetched` не входят, но курсор
    двигают. Инвариант: fetched = len(messages) + skippedNotUser + skippedOld + skippedError.
    """
    from telethon.tl.functions.messages import CheckChatInviteRequest
    from telethon.tl.functions.channels import GetFullChannelRequest
    from telethon.tl.types import ChatInviteAlready, User
    from telethon.errors import RPCError

    async def member_of(entity) -> bool:
        return await _is_member(client, entity)

    def is_broadcast_channel(entity) -> bool:
        return bool(getattr(entity, "broadcast", False)) and not bool(
            getattr(entity, "megagroup", False)
        )

    clock = now or datetime.now(timezone.utc)
    first_scan_since = clock - FIRST_SCAN_DEPTH
    window = history_window(cursor, first_scan_since)
    if "offset_date" in window:
        cutoff: datetime | None = first_scan_since
    elif days and days > 0:
        cutoff = clock - timedelta(days=max(1, min(90, days)))
    else:
        cutoff = None
    out: list[dict[str, Any]] = []
    counts = {"fetched": 0, "skippedNotUser": 0, "skippedOld": 0, "skippedError": 0}
    seen_msg: set[str] = set()
    scan_mode = "group"
    discussion_id = ""
    discussion_title = ""
    last_id = int(cursor) if str(cursor or "").isdigit() else 0

    def full() -> bool:
        return len(out) >= SCAN_OUTPUT_CAP

    async def read_feed(peer, kind: str) -> None:
        """Лента чата/обсуждения по окну курсора; курсор двигается только по обработанным id."""
        nonlocal last_id
        async for m in client.iter_messages(peer, **window):
            if full():
                break
            await add_msg(m, kind=kind, peer_entity=peer)
            last_id = max(last_id, int(getattr(m, "id", 0) or 0))

    def is_old(m) -> bool:
        md = getattr(m, "date", None)
        if cutoff is None or md is None:
            return False
        if md.tzinfo is None:
            md = md.replace(tzinfo=timezone.utc)
        return md < cutoff

    async def add_msg(m, *, kind: str, peer_entity) -> None:
        text = (getattr(m, "message", None) or "").strip()
        if len(text) < MIN_SCAN_TEXT_LENGTH:
            return
        mid = str(getattr(m, "id", "") or "")
        if mid and mid in seen_msg:
            return
        if mid:
            seen_msg.add(mid)
        counts["fetched"] += 1
        if is_old(m):
            counts["skippedOld"] += 1
            return
        try:
            sender = await m.get_sender()
        except Exception:
            counts["skippedError"] += 1
            return
        if not isinstance(sender, User) or getattr(sender, "bot", False):
            counts["skippedNotUser"] += 1
            return
        out.append(
            {
                "tgMsgId": mid,
                "message": text[:8000],
                "name": _sender_name(sender) or "Участник",
                "date": m.date.isoformat() if getattr(m, "date", None) else "",
                "senderId": str(getattr(sender, "id", "") or ""),
                "senderUsername": (getattr(sender, "username", None) or "") or "",
                "senderAccessHash": str(getattr(sender, "access_hash", "") or ""),
                "messageKind": kind,
                "peerId": _peer_id_of(peer_entity),
                "replyToMsgId": str(
                    getattr(getattr(m, "reply_to", None), "reply_to_msg_id", "") or ""
                ),
            }
        )
    try:
        ref = parse_group_ref(url)
        if ref["kind"] == "invite":
            invite = await client(CheckChatInviteRequest(hash=ref["value"]))
            if not isinstance(invite, ChatInviteAlready):
                return {
                    "ok": False,
                    "status": "setup",
                    "join": "need_join",
                    "error": "Сначала вступите в группу по инвайту",
                    "messages": [],
                    "member": False,
                }
            entity = invite.chat
        else:
            entity, resolve_err = await _resolve_entity(client, url)
            if resolve_err:
                return {
                    "ok": False,
                    "status": "error" if resolve_err.get("usernameMissing") else "setup",
                    "join": resolve_err.get("join") or "missing",
                    "error": str(resolve_err.get("error") or "Не удалось найти группу")[:400],
                    "messages": [],
                    "member": False,
                    "usernameMissing": bool(resolve_err.get("usernameMissing")),
                    "title": "",
                }
            if entity is None:
                return {
                    "ok": False,
                    "status": "error",
                    "join": "missing",
                    "error": f"Слот не видит @{ref.get('value')}",
                    "messages": [],
                    "member": False,
                    "usernameMissing": True,
                }
            if not await member_of(entity):
                return {
                    "ok": False,
                    "status": "setup",
                    "join": "need_join",
                    "error": "Аккаунт не в группе — сначала нажмите «Вступить»",
                    "messages": [],
                    "member": False,
                    "title": getattr(entity, "title", None)
                    or getattr(entity, "username", "")
                    or url,
                }
        title = getattr(entity, "title", None) or getattr(entity, "username", "") or url

        if is_broadcast_channel(entity):
            # Канал: только обсуждение / комментарии, НЕ посты канала
            scan_mode = "channel_discussion"
            linked = None
            try:
                full_ch = await client(GetFullChannelRequest(entity))
                linked_id = getattr(full_ch.full_chat, "linked_chat_id", None)
                if linked_id:
                    linked = await client.get_entity(int(linked_id))
            except Exception:
                linked = None

            if linked is not None:
                discussion_id = str(getattr(linked, "id", "") or "")
                discussion_title = (
                    getattr(linked, "title", None)
                    or getattr(linked, "username", "")
                    or ""
                )
                if not await member_of(linked):
                    # Сам скан не вступает (REQ-6): любое вступление — только ручное,
                    # через join_group с темпом и дневной квотой.
                    return {
                        "ok": False,
                        "status": "setup",
                        "join": "need_join",
                        "error": (
                            "Нужно вступить в обсуждение канала "
                            f"«{discussion_title or discussion_id}» — иначе комментарии недоступны"
                        ),
                        "messages": [],
                        "member": False,
                        "title": title,
                        "scanMode": scan_mode,
                        "needDiscussionJoin": True,
                    }
                await read_feed(linked, "discussion")
                scan_mode = "discussion_messages"

            # Fallback: комментарии к постам (reply_to), сами посты не берём
            # (курсор не трогаем: id комментариев из другой ленты)
            if len(out) < COMMENT_FALLBACK_BELOW:
                posts_checked = 0
                async for post in client.iter_messages(entity, limit=COMMENT_FALLBACK_POSTS):
                    if full():
                        break
                    posts_checked += 1
                    try:
                        async for reply in client.iter_messages(
                            entity, reply_to=post.id, limit=COMMENT_FALLBACK_REPLIES
                        ):
                            if full():
                                break
                            await add_msg(reply, kind="comment", peer_entity=entity)
                    except Exception:
                        continue
                if posts_checked and not linked:
                    scan_mode = "channel_comments"
                elif linked and posts_checked:
                    scan_mode = "discussion_and_comments"
        else:
            # Группа / супергруппа / чат — лента переписки
            scan_mode = "group_messages"
            await read_feed(entity, "group")

    except RPCError as e:
        if is_frozen_rpc(e):
            return frozen_action_error("скан сообщений")
        raise

    return {
        "ok": True,
        "status": "active",
        "title": title,
        "messages": out,
        "error": "",
        "member": True,
        **counts,
        "scanMode": scan_mode,
        "discussionId": discussion_id,
        "discussionTitle": discussion_title,
        "cursor": str(last_id) if last_id else "",
    }


def _entity_usernames(ent) -> set[str]:
    out: set[str] = set()
    u = getattr(ent, "username", None)
    if u:
        out.add(str(u).lower().lstrip("@"))
    for x in getattr(ent, "usernames", None) or []:
        un = getattr(x, "username", None) or ""
        if un:
            out.add(str(un).lower().lstrip("@"))
    return out


def _peer_fields(entity) -> dict[str, str]:
    """channelId + accessHash этой сессии — чтобы сбор не зависел от ResolveUsername."""
    if entity is None:
        return {}
    cid = getattr(entity, "id", None)
    ah = getattr(entity, "access_hash", None)
    out: dict[str, str] = {}
    if cid is not None:
        out["channelId"] = str(cid)
    if ah is not None:
        out["accessHash"] = str(ah)
    title = getattr(entity, "title", None) or getattr(entity, "username", None) or ""
    if title:
        out["title"] = str(title)
    return out


async def _match_username_in_peers(peers, want: str):
    want = (want or "").lower().lstrip("@")
    if not want:
        return None
    for ent in peers or []:
        if ent is None:
            continue
        if want in _entity_usernames(ent):
            return ent
    return None


async def _resolve_from_peer_hint(client, peer_hint: dict | None):
    """InputChannel из кэша join (access_hash привязан к сессии слота)."""
    if not peer_hint:
        return None
    cid_raw = str(peer_hint.get("channelId") or "").strip()
    ah_raw = str(peer_hint.get("accessHash") or "").strip()
    if not cid_raw.lstrip("-").isdigit() or not ah_raw.lstrip("-").isdigit():
        return None
    try:
        from telethon.tl.types import InputPeerChannel, PeerChannel

        cid = int(cid_raw)
        ah = int(ah_raw)
        try:
            return await client.get_entity(InputPeerChannel(cid, ah))
        except Exception:
            return await client.get_entity(PeerChannel(cid))
    except Exception:
        return None


async def _resolve_username_via_search(client, want: str):
    """Ферма часто врёт на ResolveUsername; Search / SearchGlobal иногда видят тот же @."""
    want = (want or "").lower().lstrip("@")
    if not want:
        return None
    try:
        from telethon.tl.functions.contacts import SearchRequest

        res = await client(SearchRequest(q=want, limit=25))
        found = await _match_username_in_peers(
            list(getattr(res, "chats", None) or [])
            + list(getattr(res, "users", None) or []),
            want,
        )
        if found is not None:
            return found
    except Exception:
        pass
    try:
        from telethon.tl.functions.messages import SearchGlobalRequest
        from telethon.tl.types import InputMessagesFilterEmpty, InputPeerEmpty

        res = await client(
            SearchGlobalRequest(
                q=want,
                filter=InputMessagesFilterEmpty(),
                min_date=None,
                max_date=None,
                offset_rate=0,
                offset_peer=InputPeerEmpty(),
                offset_id=0,
                limit=25,
            )
        )
        found = await _match_username_in_peers(
            list(getattr(res, "chats", None) or [])
            + list(getattr(res, "users", None) or []),
            want,
        )
        if found is not None:
            return found
    except Exception:
        pass
    # Повторный Resolve после Search — иногда кэш сессии уже тёплый
    try:
        return await client.get_entity(want)
    except Exception:
        return None


RESOLVE_CONTROL_USERNAME = "telegram"


async def _account_resolve_blind(client) -> bool:
    """Аккаунт не резолвит даже @telegram → ограничен сам слот, группа ни при чём.

    Только явный UsernameNotOccupied/Invalid считаем слепотой; сеть/прочее — «не знаем» (False).
    """
    from telethon.tl.functions.contacts import ResolveUsernameRequest
    from telethon.errors import UsernameNotOccupiedError, UsernameInvalidError

    try:
        await client(ResolveUsernameRequest(RESOLVE_CONTROL_USERNAME))
        return False
    except (UsernameNotOccupiedError, UsernameInvalidError):
        return True
    except Exception:
        return False


PRIVATE_LINK_ERROR = (
    "Ссылка t.me/c/… открывается только участникам: слот не состоит в канале — "
    "нужна инвайт-ссылка или аккаунт, который уже в канале"
)


async def _resolve_channel_id(client, channel_id: int):
    """t.me/c/<id>: без access_hash канал виден только слоту, который в нём состоит."""
    from telethon.tl.types import PeerChannel

    try:
        async for dialog in client.iter_dialogs(limit=500):
            ent = getattr(dialog, "entity", None)
            if ent is not None and getattr(ent, "id", None) == channel_id:
                return ent, None
    except Exception:
        pass
    try:
        return await client.get_entity(PeerChannel(channel_id)), None
    except (ValueError, TypeError):
        return None, {
            "ok": False,
            "status": "error",
            "join": "private",
            "error": PRIVATE_LINK_ERROR,
            "users": [],
            "hasMore": False,
        }


async def _resolve_entity(client, url: str, peer_hint: dict | None = None):
    from telethon.tl.functions.messages import CheckChatInviteRequest
    from telethon.tl.types import ChatInviteAlready
    from telethon.errors import UsernameNotOccupiedError, UsernameInvalidError

    # 0) Кэш peer с того же слота, что уже вступал
    hinted = await _resolve_from_peer_hint(client, peer_hint)
    if hinted is not None:
        return hinted, None

    ref = parse_group_ref(url)
    if ref["kind"] == "invite":
        invite = await client(CheckChatInviteRequest(hash=ref["value"]))
        if not isinstance(invite, ChatInviteAlready):
            return None, {
                "ok": False,
                "join": "need_join",
                "error": "Сначала вступите в группу по инвайту",
                "users": [],
                "hasMore": False,
            }
        return invite.chat, None
    if ref["kind"] == "channel_id":
        return await _resolve_channel_id(client, int(ref["value"]))
    uname = str(ref.get("value") or "").lstrip("@")
    want = uname.lower()
    hint_cid = str((peer_hint or {}).get("channelId") or "").strip()
    # Если слот уже в канале/чате — берём entity из диалогов, не ResolveUsername
    if want or hint_cid:
        try:
            async for dialog in client.iter_dialogs(limit=500):
                ent = getattr(dialog, "entity", None)
                if ent is None:
                    continue
                if want and want in _entity_usernames(ent):
                    return ent, None
                if hint_cid and str(getattr(ent, "id", "")) == hint_cid:
                    return ent, None
        except Exception:
            pass
    try:
        entity = await client.get_entity(ref["value"])
        return entity, None
    except (UsernameNotOccupiedError, UsernameInvalidError, ValueError) as e:
        detail = str(e)
        # Любой fail резолва username → Search fallback (ферма часто врёт)
        found = await _resolve_username_via_search(client, want)
        if found is not None:
            return found, None
        if (
            isinstance(e, (UsernameNotOccupiedError, UsernameInvalidError))
            or "no user has" in detail.lower()
            or "nobody is using" in detail.lower()
            or "username not occupied" in detail.lower()
            or "cannot find any entity" in detail.lower()
            or "no user has" in detail.lower()
        ):
            if await _account_resolve_blind(client):
                return None, {
                    "ok": False,
                    "status": "error",
                    "join": "missing",
                    "usernameMissing": True,
                    "accountBlind": True,
                    "error": (
                        f"Аккаунт не резолвит даже @{RESOLVE_CONTROL_USERNAME} — ограничен Telegram, "
                        f"@{uname} тут ни при чём ({type(e).__name__}: {detail})"
                    )[:400],
                    "users": [],
                    "hasMore": False,
                }
            return None, {
                "ok": False,
                "status": "error",
                "join": "missing",
                "usernameMissing": True,
                "error": (
                    f"Слот не видит @{uname} (ResolveUsername). "
                    "Часто ложь фермы — нужен другой аккаунт или инвайт-ссылка."
                )[:400],
                "users": [],
                "hasMore": False,
            }
        raise


async def send_message(
    client,
    *,
    mode: str,
    text: str,
    url: str = "",
    reply_to: str = "",
    sender_id: str = "",
    sender_username: str = "",
    sender_access_hash: str = "",
    silent: bool = False,
    delete_dialog: bool = False,
) -> dict[str, Any]:
    from telethon.errors import (
        FloodWaitError,
        PeerFloodError,
        RPCError,
        UserPrivacyRestrictedError,
        UserBannedInChannelError,
        ChatWriteForbiddenError,
    )
    from telethon.tl.functions.channels import GetParticipantRequest
    from telethon.tl.functions.contacts import ResolveUsernameRequest
    from telethon.tl.types import InputPeerUser, User, Channel, Chat

    body = (text or "").strip()
    if len(body) < 1:
        return {"ok": False, "error": "Пустое сообщение"}
    if len(body) > 4000:
        return {"ok": False, "error": "Сообщение слишком длинное"}

    async def maybe_delete_dialog(peer_entity) -> None:
        if not delete_dialog or mode != "dm":
            return
        try:
            from telethon.tl.functions.messages import DeleteHistoryRequest

            await client(
                DeleteHistoryRequest(
                    peer=peer_entity,
                    max_id=0,
                    just_clear=False,
                    revoke=False,
                )
            )
        except Exception:
            try:
                await client.delete_dialog(peer_entity, revoke=False)
            except Exception:
                pass

    async def resolve_dm_peer(uid: str, uname: str, source_url: str, access_hash: str, msg_id: str):
        """Username → кэш/диалоги → группа → access_hash (только если get_entity ок)."""
        errors: list[str] = []
        clean = (uname or "").strip().lstrip("@")
        uid_clean = str(uid or "").replace("-", "").strip()
        # peer id вида -100… / bot mark — не user id для ЛС
        if uid and (str(uid).startswith("-") or not str(uid).lstrip("-").isdigit()):
            errors.append("bad uid shape")
            uid_clean = ""
        else:
            uid_clean = str(uid).strip()

        # 1) @username — работает между аккаунтами фермы
        if clean:
            try:
                ent = await client.get_input_entity(clean)
                return ent, ""
            except Exception as e:
                errors.append(("username/input: " + str(e))[:160])
            try:
                resolved = await client(ResolveUsernameRequest(clean))
                users = getattr(resolved, "users", None) or []
                if users:
                    return await client.get_input_entity(users[0]), ""
            except Exception as e:
                errors.append(("username/resolve: " + str(e))[:160])
            try:
                ent = await client.get_entity(clean)
                if isinstance(ent, User):
                    return await client.get_input_entity(ent), ""
                errors.append("username points to channel/chat")
            except Exception as e:
                errors.append(("username/entity: " + str(e))[:160])

        # 2) Уже есть диалог / entity в кэше этой сессии
        if uid_clean.isdigit():
            try:
                async for dialog in client.iter_dialogs(limit=200):
                    if not getattr(dialog, "is_user", False):
                        continue
                    ent = dialog.entity
                    if str(getattr(ent, "id", "")) == uid_clean:
                        return await client.get_input_entity(ent), ""
            except Exception as e:
                errors.append(("dialogs: " + str(e))[:160])
            try:
                return await client.get_input_entity(int(uid_clean)), ""
            except Exception as e:
                errors.append(("id/cache: " + str(e))[:160])

        # 3) Через исходную группу / сообщение лида (свежий access_hash для ЭТОЙ сессии)
        if uid_clean.isdigit() and source_url:
            try:
                source_entity, err = await _resolve_entity(client, source_url)
                if source_entity is not None and not err:
                    # Канал-витрина: участники/комментаторы часто в linked discussion
                    peer_targets = [source_entity]
                    try:
                        if (
                            isinstance(source_entity, Channel)
                            and bool(getattr(source_entity, "broadcast", False))
                            and not bool(getattr(source_entity, "megagroup", False))
                        ):
                            from telethon.tl.functions.channels import GetFullChannelRequest

                            full_ch = await client(GetFullChannelRequest(source_entity))
                            linked_id = getattr(full_ch.full_chat, "linked_chat_id", None)
                            if linked_id:
                                linked = await client.get_entity(int(linked_id))
                                if linked is not None:
                                    peer_targets.append(linked)
                    except Exception as e:
                        errors.append(("id/linked: " + str(e))[:160])

                    if msg_id and str(msg_id).isdigit():
                        for peer_ent in peer_targets:
                            try:
                                m = await client.get_messages(peer_ent, ids=int(msg_id))
                                if m:
                                    sender = await m.get_sender()
                                    if sender is not None and isinstance(sender, User):
                                        return await client.get_input_entity(sender), ""
                            except Exception as e:
                                errors.append(("id/msg: " + str(e))[:160])
                    for peer_ent in peer_targets:
                        try:
                            part = await client(
                                GetParticipantRequest(peer_ent, int(uid_clean))
                            )
                            users = getattr(part, "users", None) or []
                            if users:
                                return await client.get_input_entity(users[0]), ""
                        except Exception as e:
                            errors.append(("id/participant: " + str(e))[:160])
                    try:
                        return await client.get_input_entity(int(uid_clean)), ""
                    except Exception as e:
                        errors.append(("id/after-part: " + str(e))[:160])
            except Exception as e:
                errors.append(("id/source: " + str(e))[:160])

        # 4) access_hash только если сессия его принимает (чужой hash = invalid Peer)
        if (
            uid_clean.isdigit()
            and access_hash
            and str(access_hash).lstrip("-").isdigit()
        ):
            try:
                peer = InputPeerUser(int(uid_clean), int(access_hash))
                ent = await client.get_entity(peer)
                if isinstance(ent, User):
                    return await client.get_input_entity(ent), ""
            except Exception as e:
                errors.append(("access_hash: " + str(e))[:160])

        detail = errors[-1] if errors else "peer not found"
        low = detail.lower()
        if "invalid peer" in low:
            hint = (
                "Неверный peer для этого аккаунта. "
                "Ответьте тем же аккаунтом, что писал ранее, или укажите @username клиента."
            )
            return None, hint
        if (
            "could not find the input entity" in low
            or "cannot find any entity" in low
            or "access_hash" in low
            or detail == "peer not found"
        ):
            hint = (
                "Не удалось открыть пользователя (нет access_hash). "
                "Нужен @username или аккаунт фермы из той же группы/сбора."
            )
            return None, hint
        if "username" in low and ("not occupied" in low or "invalid" in low or "no user" in low):
            return None, f"Username @{clean or uid_clean} не существует"
        return None, (detail or "Не удалось найти пользователя")[:400]

    try:
        if mode == "dm":
            entity, peer_err = await resolve_dm_peer(
                sender_id,
                sender_username,
                url,
                sender_access_hash,
                reply_to,
            )
            if entity is None:
                if not sender_username and not sender_id:
                    return {
                        "ok": False,
                        "error": "Нет senderId/username — нельзя написать в личку (пересканируйте группу)",
                    }
                return {
                    "ok": False,
                    "error": peer_err or "Не удалось найти пользователя",
                }
            # ЛС только пользователю — иначе Telegram отвечает «banned … in superroups/channels»
            try:
                resolved = await client.get_entity(entity)
            except Exception:
                resolved = entity
            if isinstance(resolved, (Channel, Chat)) or (
                not isinstance(resolved, User)
                and not isinstance(entity, InputPeerUser)
                and getattr(resolved, "broadcast", False)
            ):
                return {
                    "ok": False,
                    "error": "Peer оказался каналом/чатом, а не пользователем — для ЛС нужен @username человека",
                }
            if isinstance(resolved, User):
                if getattr(resolved, "bot", False):
                    return {"ok": False, "error": "Это бот — в личку по рассылке не пишем"}
                entity = resolved
            sent = await client.send_message(entity, body, silent=bool(silent))
            msg_id = str(getattr(sent, "id", "") or "")
            uname = (
                sender_username.lstrip("@")
                if sender_username
                else (getattr(entity, "username", None) or "")
            ).strip()
            chat_id = ""
            fresh_hash = ""
            try:
                from telethon.utils import get_peer_id

                chat_id = str(get_peer_id(entity))
            except Exception:
                chat_id = str(getattr(entity, "id", "") or sender_id or "")
            try:
                if isinstance(entity, User):
                    fresh_hash = str(getattr(entity, "access_hash", "") or "")
                else:
                    ent2 = await client.get_entity(entity)
                    if isinstance(ent2, User):
                        fresh_hash = str(getattr(ent2, "access_hash", "") or "")
                        if not uname:
                            uname = str(getattr(ent2, "username", "") or "")
            except Exception:
                pass
            link = ""
            if uname and msg_id:
                link = f"https://t.me/{uname}"
            elif chat_id and msg_id:
                link = f"tg://openmessage?user_id={str(chat_id).lstrip('-')}&message_id={msg_id}"
            await maybe_delete_dialog(entity)
            return {
                "ok": True,
                "mode": "dm",
                "error": "",
                "messageId": msg_id,
                "chatId": chat_id,
                "chatUsername": uname,
                "senderAccessHash": fresh_hash,
                "link": link,
                "silent": bool(silent),
                "deletedDialog": bool(delete_dialog),
            }

        if mode == "chat":
            if not url:
                return {"ok": False, "error": "Нет ссылки на группу"}
            ref = parse_group_ref(url)
            if ref["kind"] == "invite":
                from telethon.tl.functions.messages import CheckChatInviteRequest
                from telethon.tl.types import ChatInviteAlready

                invite = await client(CheckChatInviteRequest(hash=ref["value"]))
                if not isinstance(invite, ChatInviteAlready):
                    return {"ok": False, "error": "Сначала вступите в группу"}
                entity = invite.chat
            else:
                entity = await client.get_entity(ref["value"])
            kwargs: dict[str, Any] = {"silent": bool(silent)}
            if reply_to and str(reply_to).isdigit():
                kwargs["reply_to"] = int(reply_to)
            sent = await client.send_message(entity, body, **kwargs)
            msg_id = str(getattr(sent, "id", "") or "")
            username = (getattr(entity, "username", None) or "").strip()
            chat_id = ""
            try:
                from telethon.utils import get_peer_id

                chat_id = str(get_peer_id(entity))
            except Exception:
                chat_id = str(getattr(entity, "id", "") or "")
            link = ""
            if username and msg_id:
                link = f"https://t.me/{username}/{msg_id}"
            elif chat_id and msg_id:
                raw = chat_id
                if raw.startswith("-100"):
                    raw = raw[4:]
                elif raw.startswith("-"):
                    raw = raw[1:]
                if raw.isdigit():
                    link = f"https://t.me/c/{raw}/{msg_id}"
            return {
                "ok": True,
                "mode": "chat",
                "error": "",
                "messageId": msg_id,
                "chatId": chat_id,
                "chatUsername": username,
                "link": link,
                "replyTo": str(reply_to or ""),
                "silent": bool(silent),
            }

        return {"ok": False, "error": f"Неизвестный режим: {mode}"}
    except UserPrivacyRestrictedError:
        return {"ok": False, "error": "Пользователь ограничил личные сообщения"}
    except (UserBannedInChannelError, ChatWriteForbiddenError) as e:
        # Часто приходит и на «ЛС», если аккаунт ограничен Telegram / peer = канал
        return {
            "ok": False,
            "status": "spamblock",
            "error": (
                "Аккаунт ограничен Telegram: нельзя писать в чаты/каналы "
                "(You're banned from sending messages in superroups/channels). "
                "Смените аккаунт фермы или подождите 24ч."
            )[:400],
        }
    except PeerFloodError as e:
        # str(PeerFloodError) = «Too many requests …» — это спамблок аккаунта, не FloodWait
        return {"ok": False, "status": "spamblock", "error": f"PEER_FLOOD: {e}"[:400]}
    except FloodWaitError as e:
        return {"ok": False, "status": "flood", "error": f"FloodWait {e.seconds}с", "waitSec": int(e.seconds)}
    except RPCError as e:
        if is_frozen_rpc(e):
            return frozen_action_error("отправка сообщения")
        msg = str(e)
        low = msg.lower()
        if "banned from sending" in low or "chat_write_forbidden" in low or "user_banned_in_channel" in low:
            return {
                "ok": False,
                "status": "spamblock",
                "error": (
                    "Аккаунт ограничен Telegram: нельзя писать в чаты/каналы. "
                    "Смените аккаунт фермы или подождите 24ч."
                )[:400],
            }
        if "invalid peer" in low:
            return {
                "ok": False,
                "error": (
                    "Неверный peer для этого аккаунта (часто чужой access_hash). "
                    "Ответьте тем же аккаунтом или укажите @username клиента."
                )[:400],
            }
        # Telethon иногда отдаёт Flood как обычный RPC «Too many requests» без FloodWaitError
        if "too many requests" in low or ("flood" in low and "peer_flood" not in low and "banned" not in low):
            wait = 900
            m = re.search(r"(\d+)\s*(?:seconds?|s\b)", msg, re.I)
            if m:
                try:
                    wait = max(60, min(86400, int(m.group(1))))
                except Exception:
                    wait = 900
            return {
                "ok": False,
                "status": "flood",
                "error": msg[:400],
                "waitSec": wait,
            }
        return {"ok": False, "error": msg[:400]}
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "banned from sending" in low:
            return {
                "ok": False,
                "status": "spamblock",
                "error": (
                    "Аккаунт ограничен Telegram: нельзя писать в чаты/каналы. "
                    "Смените аккаунт фермы или подождите 24ч."
                )[:400],
            }
        if "too many requests" in low:
            return {
                "ok": False,
                "status": "flood",
                "error": msg[:400],
                "waitSec": 900,
            }
        return {"ok": False, "error": msg[:400]}


INBOX_DEFAULT_LOOKBACK_SEC = 36 * 3600
INBOX_MAX_USER_DIALOGS = 30
INBOX_MAX_DIALOGS_SCANNED = 400
INBOX_MESSAGES_PER_DIALOG = 100


def _unix_ts(date: Any) -> int:
    return int(date.timestamp()) if date is not None else 0


def _is_dm_dialog(dialog: Any) -> bool:
    if not getattr(dialog, "is_user", False):
        return False
    entity = dialog.entity
    return not (getattr(entity, "bot", False) or getattr(entity, "is_self", False))


async def _incoming_after(client: Any, dialog: Any, floor: int) -> list[dict[str, Any]]:
    """Incoming messages of one private dialog newer than floor (newest first until the floor)."""
    entity = dialog.entity
    user_id = str(getattr(entity, "id", "") or "")
    username = str(getattr(entity, "username", None) or "").strip()
    name = " ".join(
        x
        for x in (
            str(getattr(entity, "first_name", None) or "").strip(),
            str(getattr(entity, "last_name", None) or "").strip(),
        )
        if x
    ).strip()
    out: list[dict[str, Any]] = []
    async for m in client.iter_messages(entity, limit=INBOX_MESSAGES_PER_DIALOG):
        if not m:
            continue
        date = getattr(m, "date", None)
        ts = _unix_ts(date)
        if ts and ts <= floor:
            break
        if getattr(m, "out", False):
            continue
        text = str(getattr(m, "message", None) or getattr(m, "raw_text", None) or "").strip()
        has_media = bool(getattr(m, "media", None))
        if not text and not has_media:
            continue
        out.append(
            {
                "userId": user_id,
                "username": username,
                "name": name or username or user_id,
                "text": (text or "[медиа]")[:4000],
                "messageId": str(getattr(m, "id", "") or ""),
                "at": date.isoformat() if date is not None else "",
                "ts": ts,
                "hasMedia": has_media,
            }
        )
    return out


async def poll_dm_inbox(
    client: Any,
    *,
    since_ts: int = 0,
    offset_date: int = 0,
    max_user_dialogs: int = INBOX_MAX_USER_DIALOGS,
    now: int | None = None,
) -> dict[str, Any]:
    """Incoming DMs newer than since_ts (unix), bots and Saved Messages excluded.

    Dialogs come newest first; every private dialog above the floor is read down to the floor. The pass is
    complete at the first non-pinned dialog at/below the floor. When the dialog budget or a FloodWait stops it
    earlier, complete=False and nextOffsetDate lets the next call resume from the first unscanned dialog, so
    the caller's cursor never jumps over unscanned dialogs.
    """
    import time as _time
    from datetime import datetime, timezone

    started = int(now if now is not None else _time.time())
    floor = int(since_ts) if int(since_ts or 0) > 0 else started - INBOX_DEFAULT_LOOKBACK_SEC
    offset = max(0, int(offset_date or 0))
    budget = max(1, min(60, int(max_user_dialogs or INBOX_MAX_USER_DIALOGS)))
    messages: list[dict[str, Any]] = []

    def result(complete: bool, resume_ts: int = 0) -> dict[str, Any]:
        next_offset = 0
        if not complete:
            next_offset = resume_ts + 1 if resume_ts else offset
            if offset and next_offset >= offset:
                next_offset = offset - 1
        messages.sort(key=lambda x: int(x.get("ts") or 0))
        return {
            "ok": True,
            "messages": messages,
            "complete": complete,
            "nextOffsetDate": next_offset,
            "scanStartedTs": started,
            "error": "",
        }

    kwargs: dict[str, Any] = {"limit": None}
    if offset:
        kwargs["offset_date"] = datetime.fromtimestamp(offset, tz=timezone.utc)
    scanned = 0
    user_dialogs = 0
    try:
        async for dialog in client.iter_dialogs(**kwargs):
            d_ts = _unix_ts(getattr(dialog, "date", None))
            if d_ts and d_ts <= floor:
                if getattr(dialog, "pinned", False):
                    continue
                return result(True)
            if scanned >= INBOX_MAX_DIALOGS_SCANNED:
                return result(False, d_ts)
            scanned += 1
            if not _is_dm_dialog(dialog):
                continue
            if user_dialogs >= budget:
                return result(False, d_ts)
            user_dialogs += 1
            try:
                messages.extend(await _incoming_after(client, dialog, floor))
            except Exception as e:  # noqa: BLE001 — one broken peer must not stop the inbox
                if type(e).__name__ == "FloodWaitError":
                    return result(False, d_ts)
                print(f"inbox: dialog {getattr(dialog.entity, 'id', '?')} skipped: {str(e)[:200]}", file=sys.stderr)
        return result(True)
    except Exception as e:  # noqa: BLE001 — reported to the app, which keeps its cursor
        return {"ok": False, "error": str(e)[:400], "messages": []}


_USERNAME_A = (
    "nova", "mira", "lumen", "orbit", "pixel", "cedar", "harbor", "maple",
    "quark", "velvet", "cobalt", "nimbus", "atlas", "sierra", "echo", "zen",
    "fox", "oak", "iris", "sol", "river", "cloud",
)
_USERNAME_B = (
    "lab", "hub", "note", "desk", "path", "wave", "node", "mint",
    "peak", "kite", "flow", "nest", "spark", "field",
)


def sanitize_username(raw: str | None) -> str:
    u = re.sub(r"[^a-z0-9_]", "", (raw or "").lower().lstrip("@"))
    if u and u[0].isdigit():
        u = "u" + u
    return u[:32]


def suggest_username(phone: str | None, user_id: int, extra: str | None = None) -> list[str]:
    """Кандидаты @username по правилам Telegram (5–32, a-z0-9_)."""
    out: list[str] = []
    desired = sanitize_username(extra)
    if desired:
        out.append(desired)
    for _ in range(10):
        a = random.choice(_USERNAME_A)
        b = random.choice(_USERNAME_B)
        n = random.randint(10, 999)
        out.append(f"{a}{b}{n}")
    digits = re.sub(r"\D", "", phone or "")[-8:] or str(user_id)[-8:]
    out.extend([f"id{user_id}"[:32], f"u{digits}{random.randint(10, 99)}"])
    seen: set[str] = set()
    uniq: list[str] = []
    for u in out:
        u = sanitize_username(u)
        if u not in seen and 5 <= len(u) <= 32 and u[0].isalpha():
            seen.add(u)
            uniq.append(u)
    return uniq


async def ensure_account_username(
    client,
    desired: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Задать @username в Telegram: если нет — создать; force — перезаписать новым.
    На замороженных аккаунтах UpdateUsername даёт FROZEN_METHOD_INVALID — не падаем.
    """
    from telethon.tl.functions.account import CheckUsernameRequest, UpdateUsernameRequest
    from telethon.errors import UsernameOccupiedError, UsernameInvalidError, RPCError

    def profile_from(me, **extra):
        phone = me.phone or ""
        if phone and not str(phone).startswith("+"):
            phone = "+" + phone
        return {
            "username": me.username or "",
            "usernameCreated": False,
            "firstName": me.first_name or "",
            "lastName": me.last_name or "",
            "phone": phone,
            "userId": me.id,
            **extra,
        }

    me = await client.get_me()
    want = sanitize_username(desired)
    current = (me.username or "").lower()
    if current and not force:
        return profile_from(me)

    last_err = ""
    for candidate in suggest_username(me.phone, me.id, want or None):
        if current and candidate.lower() == current:
            if not force:
                return profile_from(me)
            continue
        try:
            try:
                free = await client(CheckUsernameRequest(username=candidate))
            except Exception:
                free = True
            if free is False:
                last_err = f"@{candidate} занят"
                continue
            await client(UpdateUsernameRequest(username=candidate))
            me = await client.get_me()
            out = profile_from(me)
            out["username"] = me.username or candidate
            out["usernameCreated"] = True
            return out
        except UsernameOccupiedError:
            last_err = f"@{candidate} занят"
            continue
        except UsernameInvalidError:
            last_err = f"@{candidate} недопустим"
            continue
        except RPCError as e:
            msg = str(e)
            if e.code == 420 or "FROZEN" in msg.upper() or "frozen" in msg.lower():
                me = await client.get_me()
                return profile_from(
                    me,
                    usernameError="Telegram ограничил смену username (заморозка)",
                    frozenMethod=not bool(me.username),
                )
            last_err = msg[:200]
            if "flood" in last_err.lower():
                break
            continue
        except Exception as e:
            last_err = str(e)[:200]
            if "flood" in last_err.lower() or "frozen" in last_err.lower():
                me = await client.get_me()
                return profile_from(
                    me,
                    usernameError="Telegram ограничил смену username (заморозка)",
                    frozenMethod=not bool(me.username),
                )
            continue

    me = await client.get_me()
    return profile_from(me, usernameError=last_err or "Не удалось задать username")


async def update_profile(client, payload: dict[str, Any]) -> dict[str, Any]:
    """Обновить имя / фамилию / about в Telegram (лимит about ≈ 70 символов)."""
    from telethon.tl.functions.account import UpdateProfileRequest
    from telethon.errors import RPCError

    first = payload.get("firstName")
    last = payload.get("lastName")
    about = payload.get("about")
    kwargs: dict[str, Any] = {}
    if first is not None:
        kwargs["first_name"] = str(first)[:64]
    if last is not None:
        kwargs["last_name"] = str(last)[:64]
    if about is not None:
        kwargs["about"] = str(about)[:70]
    if not kwargs:
        return {"ok": False, "error": "Нечего обновлять"}
    try:
        await client(UpdateProfileRequest(**kwargs))
    except RPCError as e:
        msg = str(e)
        if e.code == 420 or "FROZEN" in msg.upper():
            return {"ok": False, "status": "frozen", "error": "Telegram ограничил смену профиля (заморозка)"}
        return {"ok": False, "error": msg[:300]}
    me = await client.get_me()
    phone = me.phone or ""
    if phone and not str(phone).startswith("+"):
        phone = "+" + phone
    return {
        "ok": True,
        "profile": {
            "firstName": me.first_name or "",
            "lastName": me.last_name or "",
            "username": me.username or "",
            "phone": phone,
            "about": kwargs.get("about", ""),
            "userId": me.id,
        },
    }


async def upload_profile_photo(client, payload: dict[str, Any]) -> dict[str, Any]:
    """Загрузить фото профиля из base64."""
    import base64
    from telethon.tl.functions.photos import UploadProfilePhotoRequest
    from telethon.errors import RPCError

    b64 = payload.get("photoBase64") or payload.get("photo") or ""
    if not b64:
        return {"ok": False, "error": "Нет photoBase64"}
    if "," in b64[:80]:
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return {"ok": False, "error": "Некорректный base64 фото"}
    if len(raw) < 100:
        return {"ok": False, "error": "Файл слишком маленький"}
    if len(raw) > 5_000_000:
        return {"ok": False, "error": "Фото больше 5 МБ"}
    try:
        uploaded = await client.upload_file(raw, file_name="avatar.jpg")
        await client(UploadProfilePhotoRequest(file=uploaded))
    except RPCError as e:
        msg = str(e)
        if e.code == 420 or "FROZEN" in msg.upper():
            return {"ok": False, "status": "frozen", "error": "Telegram ограничил смену фото (заморозка)"}
        return {"ok": False, "error": msg[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return {"ok": True, "hasPhoto": True}

# Задаётся Node-воркером (--work-dir): он создаёт каталог 0700 и удаляет его сам,
# даже если процесс Python убит по таймауту (иначе сессии остаются в /tmp открытым текстом).
_WORK_DIR_OVERRIDE: Path | None = None


def acquire_work_dir() -> Path:
    if _WORK_DIR_OVERRIDE is not None:
        _WORK_DIR_OVERRIDE.mkdir(mode=0o700, parents=True, exist_ok=True)
        return Path(tempfile.mkdtemp(prefix="job-", dir=_WORK_DIR_OVERRIDE))
    return Path(tempfile.mkdtemp(prefix="uniseller-acc-"))


async def run_check(payload: dict[str, Any]) -> dict[str, Any]:
    work = acquire_work_dir()
    client = None
    try:
        client = await open_client(payload, work)
        create_username = payload.get("ensureUsername", True)
        force_username = bool(payload.get("forceUsername"))
        desired = str(payload.get("desiredUsername") or "").strip()
        if create_username or force_username:
            profile = await ensure_account_username(
                client,
                desired=desired or None,
                force=force_username,
            )
        else:
            me = await client.get_me()
            phone = me.phone or ""
            if phone and not str(phone).startswith("+"):
                phone = "+" + phone
            profile = {
                "firstName": me.first_name or "",
                "lastName": me.last_name or "",
                "username": me.username or "",
                "usernameCreated": False,
                "phone": phone,
                "userId": me.id,
            }
        restriction = None
        if payload.get("checkRestrictions", True):
            restriction = await check_spambot(client)
        status = "active"
        error = ""
        if profile.get("frozenMethod"):
            # UpdateUsername заморожен — часто и JoinChannel тоже; помечаем аккаунт
            status = "frozen"
            error = "Аккаунт заморожен Telegram (FROZEN_METHOD_INVALID). Вступление в группы недоступно — нужен другой аккаунт."
        elif restriction == "spamblock":
            status = "spamblock"
            error = "Ограничения по SpamBot"
        elif restriction == "frozen":
            status = "frozen"
            error = "Аккаунт заморожен"
        elif not profile.get("username") and profile.get("usernameError"):
            error = f"Без @username: {profile['usernameError']}"
        return {
            "ok": status == "active",
            "status": status,
            "error": error,
            "profile": profile,
            "sessionRefreshed": bool(
                getattr(client, "_uniseller_session_refreshed", False)
            ),
        }
    except asyncio.CancelledError:
        return {"ok": False, "status": "disconnected", "error": "Операция прервана (таймаут/отмена)"}
    except Exception as e:
        return {"ok": False, "status": classify_error(e), "error": str(e)[:400]}
    finally:
        try:
            if client:
                await client.disconnect()
        except Exception:
            pass
        shutil.rmtree(work, ignore_errors=True)


async def run_action(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action") or "check"
    try:
        if action == "check":
            return await run_check(payload)
        if action == "check_proxy":
            return await check_proxy_alive(payload)

        work = acquire_work_dir()
        client = None
        try:
            client = await open_client(payload, work)
            # Join/scan НЕ трогают username: UpdateUsername на frozen даёт FROZEN_METHOD_INVALID
            # и ломает вступление. @username нужен только по желанию при проверке аккаунта.
            url = payload.get("url") or ""
            if action == "join":
                peer_hint = payload.get("peerHint") if isinstance(payload.get("peerHint"), dict) else None
                target = "discussion" if payload.get("target") == "discussion" else "group"
                res = await join_group(client, url, peer_hint=peer_hint, target=target)
                # Диагностика: новая авторизация на каждый вызов — главный подозреваемый в «слепоте»
                res["sessionRefreshed"] = bool(getattr(client, "_uniseller_session_refreshed", False))
                return res
            if action == "scan":
                # keywords / minusKeywords / limit are still accepted from older apps and ignored (REQ-5).
                days = int(payload.get("days") or 0)
                cursor = str(payload.get("minId") or "")
                return await scan_group(client, url, days=days, cursor=cursor)
            if action == "send":
                return await send_message(
                    client,
                    mode=str(payload.get("mode") or "dm"),
                    text=str(payload.get("text") or ""),
                    url=str(payload.get("url") or ""),
                    reply_to=str(payload.get("replyTo") or payload.get("tgMsgId") or ""),
                    sender_id=str(payload.get("senderId") or ""),
                    sender_username=str(payload.get("senderUsername") or ""),
                    sender_access_hash=str(
                        payload.get("senderAccessHash")
                        or payload.get("accessHash")
                        or ""
                    ),
                    silent=bool(payload.get("silent") or False),
                    delete_dialog=bool(
                        payload.get("deleteDialog")
                        or payload.get("delete_dialog")
                        or False
                    ),
                )
            if action == "inbox":
                return await poll_dm_inbox(
                    client,
                    since_ts=int(payload.get("sinceTs") or payload.get("since_ts") or 0),
                    offset_date=int(payload.get("offsetDate") or 0),
                    max_user_dialogs=int(
                        payload.get("maxUserDialogs")
                        or payload.get("limitDialogs")
                        or INBOX_MAX_USER_DIALOGS
                    ),
                )
            if action == "update_profile":
                return await update_profile(client, payload)
            if action == "upload_photo":
                return await upload_profile_photo(client, payload)
            return {"ok": False, "error": f"Неизвестное действие: {action}"}
        except asyncio.CancelledError:
            return {
                "ok": False,
                "status": "disconnected",
                "error": "Операция прервана (таймаут/отмена)",
                "messages": [],
            }
        except Exception as e:
            return {
                "ok": False,
                "status": classify_error(e),
                "error": str(e)[:400],
                "messages": [],
            }
        finally:
            try:
                if client:
                    await client.disconnect()
            except Exception:
                pass
            shutil.rmtree(work, ignore_errors=True)
    except asyncio.CancelledError:
        return {
            "ok": False,
            "status": "disconnected",
            "error": "Операция прервана (таймаут/отмена)",
            "messages": [],
        }
    except Exception as e:
        return {
            "ok": False,
            "status": classify_error(e),
            "error": str(e)[:400],
            "messages": [],
        }


def _emit_error(exc: BaseException) -> int:
    name = type(exc).__name__
    if isinstance(exc, asyncio.CancelledError):
        text = "Операция прервана (таймаут/отмена)"
    else:
        # Сообщение исключения может содержать пути/секреты — наружу только тип.
        text = f"Ошибка воркера ({name})"
    print(f"[check_account] unhandled {name}", file=sys.stderr)
    err = {
        "ok": False,
        "status": "disconnected",
        "error": text[:400],
        "messages": [],
    }
    try:
        json.dump(err, sys.stdout, ensure_ascii=False)
        print()
    except Exception:
        sys.stdout.write('{"ok":false,"error":"worker crash"}\n')
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", help="JSON file or - for stdin")
    parser.add_argument("--work-dir", help="Scratch dir owned (and removed) by the caller")
    args = parser.parse_args()
    global _WORK_DIR_OVERRIDE
    if args.work_dir:
        _WORK_DIR_OVERRIDE = Path(args.work_dir)
    try:
        if args.payload == "-" or not args.payload:
            payload = json.load(sys.stdin)
        else:
            payload = json.loads(Path(args.payload).read_text())
        if not isinstance(payload, dict):
            raise ValueError("payload must be a JSON object")

        async def _runner():
            return await run_action(payload)

        try:
            result = asyncio.run(_runner())
        except RuntimeError as e:
            # Fallback for rare "loop already running" / closed-loop edge cases
            if "event loop" not in str(e).lower():
                raise
            loop = asyncio.new_event_loop()
            try:
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(_runner())
            finally:
                try:
                    loop.close()
                except Exception:
                    pass
                asyncio.set_event_loop(None)
        if not isinstance(result, dict):
            result = {"ok": False, "error": "Воркер вернул пустой ответ", "status": "disconnected"}
        json.dump(result, sys.stdout, ensure_ascii=False)
        print()
        return 0
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as e:
        # Python 3.9+: asyncio.CancelledError — BaseException, не Exception
        return _emit_error(e)


if __name__ == "__main__":
    sys.exit(main())
