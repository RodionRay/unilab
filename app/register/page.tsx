import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/marketing/auth-form";

export const metadata: Metadata = {
  title: "Регистрация",
  description:
    "Создайте кабинет UniLab: почта и пароль или вход через Google, Яндекс, VK и Telegram.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/register" },
  openGraph: {
    title: "Регистрация в UniLab",
    description: "Свой кабинет тёплых заявок из Telegram.",
  },
};

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="login-shell">
          <div className="login-card">
            <p className="muted">Загрузка…</p>
          </div>
        </main>
      }
    >
      <AuthForm mode="register" />
    </Suspense>
  );
}
