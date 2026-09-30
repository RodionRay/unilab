import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/marketing/auth-form";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в кабинет UniLab по почте или через соцсеть.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
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
      <AuthForm mode="login" />
    </Suspense>
  );
}
