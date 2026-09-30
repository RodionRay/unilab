import Link from "next/link";
import { UniLabLogo } from "@/components/marketing/logo";

export function MarketingFooter() {
  return (
    <footer className="us-footer">
      <div className="us-container us-footer-inner">
        <div className="us-footer-brand">
          <UniLabLogo size={28} />
          <span>кабинет тёплых заявок из Telegram</span>
        </div>
        <div className="us-footer-links">
          <Link href="/register">Кабинет</Link>
          <a href="#tasks">Задачи</a>
          <a href="#faq">Вопросы</a>
          <a href="#contact">Контакты</a>
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/terms">Условия</Link>
        </div>
      </div>
    </footer>
  );
}
