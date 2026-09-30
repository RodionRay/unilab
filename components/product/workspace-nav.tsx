"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Bell,
  Database,
  GripVertical,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Send,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";

export type NavName =
  | "Обзор"
  | "Лиды"
  | "Переписки"
  | "Группы и каналы"
  | "Сбор аудитории"
  | "Инвайтинг"
  | "Рассылка"
  | "Аккаунты"
  | "Прокси"
  | "AI-ассистент"
  | "Настройки"
  | "Уведомления"
  | "Сотрудники";

type NavSection = "workspace" | "audience" | "connections";

type NavDef = {
  name: NavName;
  section: NavSection;
  Icon: ComponentType<{ size?: number; className?: string }>;
};

const SECTION_LABEL: Record<NavSection, string> = {
  workspace: "Рабочее пространство",
  audience: "Аудитория",
  connections: "Подключения",
};

export const DEFAULT_NAV: NavDef[] = [
  { name: "Обзор", section: "workspace", Icon: LayoutDashboard },
  { name: "Уведомления", section: "workspace", Icon: Bell },
  { name: "Лиды", section: "workspace", Icon: Users },
  { name: "Переписки", section: "workspace", Icon: MessageSquare },
  { name: "Группы и каналы", section: "workspace", Icon: Radio },
  { name: "Сбор аудитории", section: "audience", Icon: Database },
  { name: "Инвайтинг", section: "audience", Icon: UserPlus },
  { name: "Рассылка", section: "connections", Icon: Send },
  { name: "Аккаунты", section: "connections", Icon: Users },
  { name: "Прокси", section: "connections", Icon: Shield },
  { name: "AI-ассистент", section: "connections", Icon: Sparkles },
  { name: "Сотрудники", section: "connections", Icon: UserRound },
  { name: "Настройки", section: "connections", Icon: Settings },
];

const NAV_ORDER_KEY = "unilab-nav-order";
const VIEW_STORAGE_KEY = "unilab-workspace-view";
export const WORKSPACE_VIEW_PARAM = "view";

const VIEW_SLUG: Record<NavName, string> = {
  "Обзор": "overview",
  "Уведомления": "notifications",
  "Лиды": "leads",
  "Переписки": "chats",
  "Группы и каналы": "groups",
  "Сбор аудитории": "audience",
  "Инвайтинг": "invite",
  "Рассылка": "mailing",
  "Аккаунты": "accounts",
  "Прокси": "proxies",
  "AI-ассистент": "ai",
  "Сотрудники": "staff",
  "Настройки": "settings",
};

const SLUG_VIEW = Object.fromEntries(
  (Object.entries(VIEW_SLUG) as [NavName, string][]).map(([name, slug]) => [slug, name]),
) as Record<string, NavName>;

function isNavName(v: unknown): v is NavName {
  return typeof v === "string" && DEFAULT_NAV.some((n) => n.name === v);
}

export function parseWorkspaceView(value: string | null | undefined): NavName {
  if (!value) return "Обзор";
  if (isNavName(value)) return value;
  return SLUG_VIEW[value.trim().toLowerCase()] ?? "Обзор";
}

export function persistWorkspaceView(name: string) {
  if (typeof window === "undefined") return;
  const view = isNavName(name) ? name : "Обзор";
  const url = new URL(window.location.href);
  if (view === "Обзор") url.searchParams.delete(WORKSPACE_VIEW_PARAM);
  else url.searchParams.set(WORKSPACE_VIEW_PARAM, VIEW_SLUG[view]);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) window.history.replaceState(window.history.state, "", next);
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
}

export function readStoredWorkspaceView(): NavName | null {
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    return isNavName(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function loadNavOrder(): NavName[] {
  try {
    const defaults = DEFAULT_NAV.map((n) => n.name);
    const raw = localStorage.getItem(NAV_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaults;
    const names = parsed.filter(isNavName);
    const missing = defaults.filter((n) => !names.includes(n));
    if (!missing.length) return names;
    const next = [...names];
    for (const name of missing) {
      const defaultIndex = defaults.indexOf(name);
      const before = defaults.slice(0, defaultIndex).reverse().find((n) => next.includes(n));
      const insertAt = before ? next.indexOf(before) + 1 : Math.max(0, defaultIndex);
      next.splice(Math.min(insertAt, next.length), 0, name);
    }
    return next;
  } catch {
    return DEFAULT_NAV.map((n) => n.name);
  }
}

function saveNavOrder(order: NavName[]) {
  try {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

type Props = {
  view: string;
  onNavigate: (name: NavName) => void;
  badges: Partial<Record<NavName, number>>;
  allowed?: NavName[] | null;
};

export function WorkspaceNav({ view, onNavigate, badges, allowed }: Props) {
  const [order, setOrder] = useState<NavName[]>(() => DEFAULT_NAV.map((n) => n.name));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setOrder(loadNavOrder());
  }, []);

  const byName = useMemo(() => new Map(DEFAULT_NAV.map((n) => [n.name, n])), []);
  const allowedSet = useMemo(
    () => (allowed ? new Set(allowed) : null),
    [allowed],
  );

  const items = useMemo(
    () =>
      order
        .map((name) => byName.get(name))
        .filter((n): n is NavDef => !!n && (!allowedSet || allowedSet.has(n.name))),
    [order, byName, allowedSet],
  );

  const move = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      saveNavOrder(next);
      return next;
    });
  }, []);

  return (
    <SidebarMenu className="px-3 gap-1 workspace-nav">
      {items.map((item, i) => {
        const prev = items[i - 1];
        const showCaption = !prev || prev.section !== item.section;
        const count = Number(badges[item.name] || 0);
        const Icon = item.Icon;
        const active = view === item.name;
        const isOver = overIndex === i && dragFrom !== null && dragFrom !== i;

        return (
          <SidebarMenuItem key={item.name}>
            {showCaption && <div className="nav-caption">{SECTION_LABEL[item.section]}</div>}
            <div
              className={`nav-row${active ? " is-active" : ""}${isOver ? " nav-item-drop" : ""}${dragFrom === i ? " nav-item-dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== i) setOverIndex(i);
              }}
              onDragLeave={() => {
                if (overIndex === i) setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom ?? Number(e.dataTransfer.getData("text/plain"));
                if (Number.isFinite(from)) move(from, i);
                setDragFrom(null);
                setOverIndex(null);
              }}
            >
              <button
                type="button"
                className="nav-drag"
                draggable
                title="Перетащить вверх или вниз"
                aria-label={`Переместить «${item.name}»`}
                onClick={(e) => e.preventDefault()}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                  setDragFrom(i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setOverIndex(null);
                }}
              >
                <GripVertical size={14} />
              </button>
              <button
                type="button"
                className="nav-item"
                data-active={active ? "true" : "false"}
                onClick={() => onNavigate(item.name)}
              >
                <Icon />
                <span className="nav-label">{item.name}</span>
                {count > 0 && (
                  <span className="nav-count">{count > 99 ? "99+" : count}</span>
                )}
              </button>
            </div>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
