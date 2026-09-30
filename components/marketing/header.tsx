import Link from "next/link";
import { UniLabLogo } from "@/components/marketing/logo";

export function MarketingHeader({
  registerHref = "/register",
}: {
  registerHref?: string;
}) {
  return (
    <div className="us-chrome">
      <div className="us-topbar">
        <div className="us-container us-topbar-inner">
          <span>Лиды из Telegram-чатов и очередь вступлений без спамблока</span>
          <a href="#contact">Обсудить задачу →</a>
        </div>
      </div>
      <header className="us-header">
        <div className="us-glass">
          <UniLabLogo />
          <nav className="us-nav" aria-label="Разделы">
            <a href="#product">О продукте</a>
            <a href="#tasks">Задачи</a>
            <a href="#practice">Как работает</a>
            <a href="#faq">Вопросы</a>
            <a href="#contact">Контакты</a>
          </nav>
          <div className="us-header-actions">
            <Link href="/login?return_to=%2Fapp" className="us-btn-login">
              Войти
            </Link>
            <Link href={registerHref} className="us-btn-login us-btn-login-primary">
              Попробовать
            </Link>
          </div>
        </div>
      </header>
    </div>
  );
}
