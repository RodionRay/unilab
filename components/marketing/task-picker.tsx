"use client";

import { useState } from "react";
import { tasks } from "@/components/marketing/content";
import { MagicCard } from "@/components/marketing/fx";

export function TaskPicker() {
  const [id, setId] = useState(tasks[0]!.id);
  const task = tasks.find((t) => t.id === id) ?? tasks[0]!;

  return (
    <div className="us-picker">
      <div className="us-picker-tabs" role="tablist" aria-label="Задачи">
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === id}
            className={t.id === id ? "on" : undefined}
            onClick={() => setId(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div className="us-picker-body">
        <p className="us-picker-lead">{task.does}</p>
        <div className="us-grid-3">
          <MagicCard className="us-block">
            <h3>Какие данные нужны</h3>
            <ul>
              {task.need.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </MagicCard>
          <MagicCard className="us-block">
            <h3>Какие есть ограничения</h3>
            <ul>
              {task.limits.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </MagicCard>
          <MagicCard className="us-block us-block-accent">
            <h3>Первый результат</h3>
            <p>{task.first}</p>
          </MagicCard>
        </div>
      </div>
    </div>
  );
}
