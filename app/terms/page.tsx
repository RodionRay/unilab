import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Условия использования",
  description: "Правила регистрации и работы в кабинете UniLab.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="us-section us-legal">
        <div className="us-container us-legal-body">
          <p className="us-eyebrow">ДОКУМЕНТ</p>
          <h1 className="us-h2">Условия использования</h1>
          <p className="us-lead">Последнее обновление: 17 сентября 2026.</p>
          <p>
            Регистрируясь в UniLab, вы подтверждаете, что используете сервис
            законно: соблюдаете правила Telegram, не рассылаете спам и не
            обрабатываете чужие персональные данные без оснований.
          </p>
          <h2>Кабинет</h2>
          <p>
            Каждый пользователь получает изолированное пространство. Вы
            отвечаете за сохранность пароля, подключённых аккаунтов и прокси.
          </p>
          <h2>Ограничения</h2>
          <p>
            Запрещены массовые нежелательные сообщения, обход блокировок в
            нарушение закона и передача доступа третьим лицам без согласия
            владельца.
          </p>
          <h2>Сервис</h2>
          <p>
            UniLab предоставляется «как есть». Мы можем менять функции,
            приостанавливать доступ при нарушении условий или угрозе
            безопасности.
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
