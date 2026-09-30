export function HeroStage() {
  return (
    <div className="us-dashboard us-hero-stage" aria-hidden>
      <div className="us-stage">
        <aside className="us-stage-nav">
          <span className="on">Обзор</span>
          <span>Лиды</span>
          <span>Переписки</span>
          <span>Группы</span>
          <span>Аудитория</span>
          <span>Инвайтинг</span>
          <span>Рассылка</span>
        </aside>
        <div className="us-stage-main">
          <div className="us-stage-kpis">
            <div>
              <small>Горячие</small>
              <strong>24</strong>
            </div>
            <div>
              <small>Тёплые</small>
              <strong>61</strong>
            </div>
            <div>
              <small>В очереди</small>
              <strong>8</strong>
            </div>
          </div>
          <div className="us-stage-rows">
            <div className="hot">
              <b>Ищу подрядчика на внедрение</b>
              <em>горячий</em>
            </div>
            <div>
              <b>Кто делает рассылку под ключ?</b>
              <em>тёплый</em>
            </div>
            <div>
              <b>Нужен кабинет и аккаунты</b>
              <em>тёплый</em>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
