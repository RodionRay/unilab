"use client";

import { ChartNoAxesColumn, Inbox, ListChecks, Smartphone, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabId } from "@/components/tma/overview-screen";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "accounts", label: "Аккаунты", icon: Smartphone },
  { id: "tasks", label: "Задачи", icon: ListChecks },
  { id: "overview", label: "Сводка", icon: ChartNoAxesColumn },
];

export function TabBar({
  active,
  visible,
  badges,
  onSelect,
}: {
  active: TabId;
  visible: ReadonlySet<TabId>;
  badges: Partial<Record<TabId, { count: number; tone: "info" | "danger" }>>;
  onSelect(tab: TabId): void;
}) {
  return (
    <nav aria-label="Разделы" className="shrink-0 border-t border-(--tma-separator) bg-(--tma-bar) pb-(--tma-inset-bottom)">
      <ul className="flex">
        {TABS.filter((t) => visible.has(t.id)).map((t) => {
          const badge = badges[t.id];
          const on = t.id === active;
          return (
            <li key={t.id} className="flex-1">
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={on ? "page" : undefined}
                className={cn("flex h-[54px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on ? "text-(--tma-link)" : "text-(--tma-hint)")}
              >
                <span className="relative">
                  <t.icon className="size-6" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                  {badge && badge.count > 0 ? (
                    <span
                      className={cn(
                        "tma-num absolute -top-1.5 left-4 min-w-[18px] rounded-full px-1 text-center text-[11px] leading-[18px] font-semibold text-white ring-2 ring-(--tma-bar)",
                        badge.tone === "danger" ? "bg-(--tma-destructive)" : "bg-(--tma-button)",
                      )}
                      aria-label={badge.tone === "danger" ? `проблем: ${badge.count}` : `непрочитанных: ${badge.count}`}
                    >
                      {badge.count > 99 ? "99+" : badge.count}
                    </span>
                  ) : null}
                </span>
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
