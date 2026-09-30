import type { Metadata } from "next";
import Link from "next/link";
import {
  aboutLong,
  faqs,
  fitHas,
  fitNeed,
  fitNot,
  launchSteps,
  practiceSteps,
  SITE_DESCRIPTION,
  SITE_TAGLINE,
  situations,
} from "@/components/marketing/content";
import { ContactForm } from "@/components/marketing/contact-form";
import { DemoPanels } from "@/components/marketing/demo-panels";
import {
  MagicCard,
  Marquee,
  Ripple,
} from "@/components/marketing/fx";
import { Reveal } from "@/components/marketing/reveal";
import { MarketingShell } from "@/components/marketing/shell";
import { TaskPicker } from "@/components/marketing/task-picker";
import { publicSiteUrl } from "@/lib/site-url";

const site = publicSiteUrl();

export const metadata: Metadata = {
  title: { absolute: `UniLab — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  keywords: [
    "UniLab",
    "тёплые заявки Telegram",
    "лиды из чатов",
    "очередь вступлений",
    "AI отбор лидов",
    "инвайтинг Telegram",
    "рассылка Telegram",
    "кабинет лидогенерации",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    url: site,
    title: `UniLab — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    siteName: "UniLab",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `UniLab — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "UniLab",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    url: site,
    brand: { "@type": "Brand", name: "UniLab" },
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "UniLab",
    url: site,
    description: SITE_DESCRIPTION,
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  },
];

export default function LandingPage() {
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="us-hero" id="product">
        <Ripple />
        <div className="us-container us-hero-grid">
          <div className="us-hero-copy">
            <p className="us-kicker us-shiny-text">
              UniLab — кабинет тёплых заявок из Telegram
            </p>
            <h1>
              Тёплые заявки из чатов, очередь вступлений и ответ из{" "}
              <span className="us-grad-text">одной карточки</span>
            </h1>
            <p className="us-hero-desc">
              Находим людей, которые уже ищут ваш продукт. Вступаем в группы с
              антибан-холдом, отбираем горячие и тёплые запросы через AI,
              пишем в личку или в чат. Рядом — сбор аудитории, инвайтинг и
              рассылка.
            </p>
            <p className="us-note">
              Начните с одной задачи — поможем подключить аккаунты и проверить
              первые лиды на ваших темах. Сессии через форму сайта не принимаем.
            </p>
            <div className="us-hero-cta">
              <Link href="/register" className="us-btn us-btn-primary">
                Создать кабинет
              </Link>
              <a href="#practice" className="us-btn us-btn-secondary">
                Посмотреть, как работает
              </a>
            </div>
            <p className="us-micro">
              Без привязки карты.{" "}
              <a href="#contact">Обсудить запуск</a>
              {" · "}
              <Link href="/login?return_to=%2Fapp">Войти</Link>
            </p>
            <p className="us-platforms">Telegram-чаты · группы · каналы · личные сообщения</p>
          </div>
          <DemoPanels />
        </div>
        <div className="us-marquee-band">
          <Marquee
            items={[
              "Тёплые лиды",
              "Очередь вступлений",
              "AI-отбор",
              "Инвайтинг",
              "Рассылка",
              "Антибан-холд",
              "Черновик ответа",
              "Прокси и аккаунты",
            ]}
          />
        </div>
      </section>

      <section className="us-section" id="tasks">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">ЗАДАЧА</p>
            <h2 className="us-h2">Что вы хотите перестать делать вручную?</h2>
            <p className="us-lead">
              Выберите задачу — ниже: что делает UniLab, какие данные нужны,
              какие есть ограничения и какой первый результат вы проверяете.
              Контакты для этого не обязательны.
            </p>
            <TaskPicker />
          </Reveal>
        </div>
      </section>

      <section className="us-section us-section-dim" id="practice">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">КАК ЭТО ВЫГЛЯДИТ</p>
            <h2 className="us-h2">Посмотрите, как это работает на практике</h2>
            <p className="us-lead">
              Три шага до потока заявок. Экраны на главной — демонстрационная
              логика кабинета. Боевые данные появятся после ваших аккаунтов.
            </p>
            <ol className="us-practice">
              {practiceSteps.map((s) => (
                <li key={s.n}>
                  <span>{s.n}</span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      <section className="us-section" id="fit">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">ПОДХОДИТ ЛИ ВАМ</p>
            <h2 className="us-h2">Проверьте, закрывает ли UniLab вашу работу</h2>
            <p className="us-lead">
              Если продажи живут в тематических чатах Telegram — да. Если только
              в кабинетах маркетплейсов без чатов — нет, это другой продукт.
            </p>
            <div className="us-grid-3">
              <MagicCard className="us-block">
                <h3>Что доступно</h3>
                <ul>
                  {fitHas.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </MagicCard>
              <MagicCard className="us-block">
                <h3>Что потребуется</h3>
                <ul>
                  {fitNeed.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </MagicCard>
              <MagicCard className="us-block">
                <h3>Чего нет</h3>
                <ul>
                  {fitNot.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </MagicCard>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="us-section us-section-dim" id="modules">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">СИТУАЦИИ</p>
            <h2 className="us-h2">Подключайте контур под следующую боль</h2>
            <p className="us-lead">
              Не список иконок, а сценарий: что сломано сейчас и что кабинет
              делает вместо ручного мониторинга.
            </p>
            <div className="us-situations">
              {situations.map((s) => (
                <MagicCard key={s.sit} className="us-sit">
                  <p>
                    <strong>Ситуация.</strong> {s.sit}
                  </p>
                  <p>
                    <strong>Что делает UniLab.</strong> {s.does}
                  </p>
                  <p className="us-sit-note">{s.note}</p>
                </MagicCard>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="us-section" id="launch">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">ЗАПУСК</p>
            <h2 className="us-h2">Подключим выбранную задачу и сверим результат</h2>
            <p className="us-lead">
              Начнём с вашей ниши и согласованных чатов. Настроим доступный
              сценарий и покажем, как повторять это каждый день.
            </p>
            <ol className="us-practice">
              {launchSteps.map((s, i) => (
                <li key={s.title}>
                  <span>{i + 1}</span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="us-note">
              Состав работ и стоимость сопровождения согласуем до старта.
              Регистрация кабинета — отдельные условия и не означает бесплатную
              настройку специалистом.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="us-section us-section-dim" id="about">
        <div className="us-container us-about">
          <Reveal>
            <p className="us-eyebrow">О ПРОДУКТЕ</p>
            <h2 className="us-h2">
              UniLab — платформа тёплых заявок из Telegram: чаты, AI и касание в
              одном кабинете
            </h2>
            {aboutLong.split("\n\n").map((p) => (
              <p key={p.slice(0, 40)} className="us-about-p">
                {p}
              </p>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="us-section" id="faq">
        <div className="us-container">
          <Reveal>
            <p className="us-eyebrow">ЧАСТЫЕ ВОПРОСЫ</p>
            <h2 className="us-h2">Коротко и по делу</h2>
            <div className="us-faq">
              {faqs.map((item) => (
                <details key={item.q} className="us-faq-item">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="us-section us-section-dim" id="contact">
        <div className="us-container us-contact-layout">
          <Reveal>
            <p className="us-eyebrow">КОНТАКТЫ</p>
            <h2 className="us-h2">Напишите задачу — ответим по запуску</h2>
            <p className="us-lead">
              Ниша, есть ли аккаунты и прокси, какие чаты, что считаете лидом.
              Подберём сценарий и скажем, что настраиваете вы, а что можем взять
              на сопровождение.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <MagicCard className="us-contact-card">
              <ContactForm />
            </MagicCard>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
