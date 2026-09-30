"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UniLabLogo } from "@/components/marketing/logo";
import { safeRelativeReturnPath } from "@/lib/security/return-path";

function safeReturnTo(value: string | null): string {
  const safe = safeRelativeReturnPath(value || "/app");
  if (safe === "/" || safe.startsWith("/login") || safe.startsWith("/register")) {
    return "/app";
  }
  return safe;
}

const ERRORS: Record<string, string> = {
  oauth: "Не удалось войти через соцсеть. Проверьте настройки провайдера.",
  denied: "Вход через соцсеть отменён.",
  state: "Сессия входа устарела. Попробуйте ещё раз.",
  exists: "Аккаунт с этой почтой уже существует — войдите по паролю.",
};

type Providers = {
  google: boolean;
  yandex: boolean;
  vk: boolean;
  telegram: boolean;
  telegramBot: string;
  telegramState: string;
};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = useMemo(
    () => safeReturnTo(params.get("return_to")),
    [params],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(ERRORS[params.get("error") || ""] || "");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const tgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json() as Promise<Providers>)
      .then(setProviders)
      .catch(() =>
        setProviders({
          google: false,
          yandex: false,
          vk: false,
          telegram: false,
          telegramBot: "",
          telegramState: "",
        }),
      );
  }, []);

  useEffect(() => {
    const el = tgRef.current;
    if (
      !el ||
      !providers?.telegram ||
      !providers.telegramBot ||
      !providers.telegramState
    ) {
      return;
    }
    const authUrl = new URL("/api/auth/telegram", window.location.origin);
    authUrl.searchParams.set("state", providers.telegramState);
    authUrl.searchParams.set("return_to", returnTo);
    el.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", providers.telegramBot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-userpic", "false");
    s.setAttribute("data-auth-url", authUrl.toString());
    s.setAttribute("data-request-access", "write");
    el.appendChild(s);
  }, [providers, returnTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        mode === "register" ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Не удалось выполнить запрос");
      router.replace(returnTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const start = (provider: string) =>
    `/api/auth/${provider}/start?return_to=${encodeURIComponent(returnTo)}`;

  const anySocial =
    providers &&
    (providers.google || providers.yandex || providers.vk || providers.telegram);

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <UniLabLogo href="/" />
        <h1>{mode === "register" ? "Создать кабинет" : "Вход в кабинет"}</h1>
        <p className="muted">
          {mode === "register"
            ? "Почта или соцсеть — данные кабинета только ваши."
            : "Тёплые заявки из Telegram"}
        </p>
        {mode === "register" ? (
          <label className="field">
            Имя
            <Input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как к вам обращаться"
            />
          </label>
        ) : null}
        <label className="field">
          Email
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Пароль
          <Input
            type="password"
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
        </label>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" size={15} /> : null}
          {mode === "register" ? "Зарегистрироваться" : "Войти"}
        </Button>

        <div className="us-auth-split">или соцсеть</div>
        <div className="us-oauth">
          <a
            className="us-oauth-btn"
            href={providers?.google ? start("google") : undefined}
            aria-disabled={!providers?.google}
            onClick={(e) => {
              if (!providers?.google) e.preventDefault();
            }}
          >
            Google
          </a>
          <a
            className="us-oauth-btn"
            href={providers?.yandex ? start("yandex") : undefined}
            aria-disabled={!providers?.yandex}
            onClick={(e) => {
              if (!providers?.yandex) e.preventDefault();
            }}
          >
            Яндекс
          </a>
          <a
            className="us-oauth-btn"
            href={providers?.vk ? start("vk") : undefined}
            aria-disabled={!providers?.vk}
            onClick={(e) => {
              if (!providers?.vk) e.preventDefault();
            }}
          >
            VK
          </a>
          <div ref={tgRef} className="us-tg-widget" />
        </div>
        {!anySocial ? (
          <p className="login-hint">
            Кнопки соцсетей заработают, когда в env появятся client id и secret
            (Google, Яндекс, VK) и токен бота Telegram.
          </p>
        ) : null}

        <p className="us-auth-switch">
          {mode === "register" ? (
            <>
              Уже есть кабинет?{" "}
              <Link href={`/login?return_to=${encodeURIComponent(returnTo)}`}>
                Войти
              </Link>
            </>
          ) : (
            <>
              Нет аккаунта?{" "}
              <Link href={`/register?return_to=${encodeURIComponent(returnTo)}`}>
                Регистрация
              </Link>
            </>
          )}
        </p>
        {mode === "register" ? (
          <p className="login-hint">
            Регистрируясь, вы принимаете{" "}
            <Link href="/terms">условия</Link> и{" "}
            <Link href="/privacy">политику конфиденциальности</Link>.
          </p>
        ) : null}
      </form>
    </main>
  );
}
