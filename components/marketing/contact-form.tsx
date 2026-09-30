"use client";

import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { contactTasks } from "@/components/marketing/content";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [company, setCompany] = useState("");
  const [task, setTask] = useState("leads");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk(false);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, telegram, company, task, message }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Не удалось отправить");
      setOk(true);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (ok) {
    return (
      <p className="us-contact-ok" role="status">
        Заявку получили. Напишем на почту или в Telegram, если оставили контакт.
        Сессии и пароли в ответ не просим — их вводите только в кабинете.
      </p>
    );
  }

  return (
    <form className="us-contact" onSubmit={onSubmit}>
      <div className="us-contact-grid">
        <label>
          Имя
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoComplete="name"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={120}
            autoComplete="email"
          />
        </label>
        <label>
          Telegram
          <input
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            maxLength={64}
            placeholder="@username"
          />
        </label>
        <label>
          Компания
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={120}
          />
        </label>
      </div>
      <label>
        Задача
        <select value={task} onChange={(e) => setTask(e.target.value)}>
          {contactTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Что нужно сделать первым
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={10}
          maxLength={4000}
          rows={5}
          placeholder="Ниша, есть ли аккаунты и прокси, какие чаты, что считаете целевым лидом. Не присылайте tdata и пароли."
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="us-btn us-btn-primary" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" size={16} /> : null}
        Обсудить запуск
      </button>
      <p className="login-hint">
        Через форму не принимаем ключи API, архивы сессий и пароли от Telegram.
      </p>
    </form>
  );
}
