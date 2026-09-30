"use client";

import { useMemo, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  explainLeadDecision,
  LEAD_SCORE_HOT,
  LEAD_SCORE_WARM,
  type LeadCoreSettings,
} from "@/lib/lead-core";

type Props = {
  settings: LeadCoreSettings;
  aiQualify: boolean;
  lastFunnel?: { worker?: number; core?: number; matched?: number; added?: number } | null;
};

export function LeadCorePanel({ settings, aiQualify, lastFunnel }: Props) {
  const [sample, setSample] = useState(
    "Ищу сервис для синхронизации остатков WB и МойСклад, можно на демо",
  );

  const decision = useMemo(
    () => explainLeadDecision(sample, settings),
    [sample, settings],
  );

  return (
    <section className="panel lead-core-panel">
      <div className="title-icon mb-3">
        <div>
          <h2 className="m-0">Ядро поиска лидов</h2>
          <p className="small-note mt-1">
            Лид — запрос сервиса под продукт из «Настройки AI-ассистента». Лучше 0, чем шум.
          </p>
        </div>
      </div>

      <ul className="lead-core-checklist">
        <li>
          <span className="badge success">1</span> Запрос услуги («ищу сервис», «кто
          пользуется», «нужна CRM»)
        </li>
        <li>
          <span className="badge success">2</span> Совпадение с настройками AI: продукт,
          критерии, плюс-слова, горячие сигналы
        </li>
        <li>
          <span className="badge success">3</span> Не стоп / не реклама / не болтовня чата
        </li>
      </ul>

      <div className="lead-core-meta">
        <span className={`badge ${aiQualify ? "success" : "warning"}`}>
          AI-шлюз {aiQualify ? "вкл." : "выкл."}
        </span>
        <span className="badge neutral">warm ≥ {LEAD_SCORE_WARM}</span>
        <span className="badge neutral">hot ≥ {LEAD_SCORE_HOT}</span>
      </div>

      {lastFunnel && (lastFunnel.worker != null || lastFunnel.core != null) && (
        <p className="small-note mt-2">
          Последний скан: worker {lastFunnel.worker ?? "—"} → ядро {lastFunnel.core ?? "—"} →
          match {lastFunnel.matched ?? "—"} → +{lastFunnel.added ?? 0}
        </p>
      )}

      <label className="field mt-4">
        Превью: вставьте сообщение из чата
        <Textarea
          rows={4}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="Текст сообщения…"
        />
      </label>

      <div className={`lead-core-verdict ${decision.pass ? "is-pass" : "is-reject"}`}>
        <strong>{decision.summary}</strong>
        <ul>
          {decision.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="lead-core-flags">
          <span className={`badge ${decision.buyer ? "success" : "neutral"}`}>
            buyer {decision.buyer ? "да" : "нет"}
          </span>
          <span className={`badge ${decision.softAsk ? "success" : "neutral"}`}>
            soft {decision.softAsk ? "да" : "нет"}
          </span>
          <span className={`badge ${decision.fit ? "success" : "neutral"}`}>
            fit {decision.fit ? "да" : "нет"}
          </span>
        </div>
      </div>
    </section>
  );
}
