import { BorderGlow, Orbit } from "@/components/marketing/fx";

export function DemoPanels() {
  return (
    <div className="us-demo-wrap">
      <Orbit />
      <BorderGlow className="us-demo-stack">
      <article className="us-demo-card">
        <header>
          <span>Лиды</span>
          <em>демонстрационные данные</em>
        </header>
        <table>
          <thead>
            <tr>
              <th>Запрос</th>
              <th>Чат</th>
              <th>Темп.</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>Ищу подрядчика на внедрение кабинета</b>
                <small>сегодня · 14:22</small>
              </td>
              <td>B2B услуги · Москва</td>
              <td>
                <span className="us-chip hot">Горячий</span>
              </td>
            </tr>
            <tr>
              <td>
                <b>Кто делает рассылку под ключ?</b>
                <small>сегодня · 13:04</small>
              </td>
              <td>Маркетинг · чат агентств</td>
              <td>
                <span className="us-chip warm">Тёплый</span>
              </td>
            </tr>
            <tr>
              <td>
                <b>Нужны аккаунты и прокси в одном месте</b>
                <small>вчера · 19:40</small>
              </td>
              <td>Telegram growth</td>
              <td>
                <span className="us-chip warm">Тёплый</span>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
      <article className="us-demo-card">
        <header>
          <span>Очередь вступлений</span>
          <em>демонстрационные данные</em>
        </header>
        <table>
          <thead>
            <tr>
              <th>Группа</th>
              <th>Аккаунт</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Подрядчики IT</td>
              <td>session · 02</td>
              <td>
                <span className="us-chip wait">Холд 3:12</span>
              </td>
            </tr>
            <tr>
              <td>Закупки B2B</td>
              <td>session · 01</td>
              <td>
                <span className="us-chip scan">Скан</span>
              </td>
            </tr>
            <tr>
              <td>Маркетинг RU</td>
              <td>session · 03</td>
              <td>
                <span className="us-chip ok">Вступили</span>
              </td>
            </tr>
          </tbody>
        </table>
      </article>
      </BorderGlow>
    </div>
  );
}
