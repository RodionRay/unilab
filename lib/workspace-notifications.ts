import { toast as sonnerToast } from "sonner";
import type { NavName } from "@/components/product/workspace-nav";

export type NoticeLevel = "success" | "error" | "info";

export type WorkspaceNotice = {
  id: string;
  at: string;
  level: NoticeLevel;
  text: string;
  view?: NavName;
  read: boolean;
};

const STORAGE_KEY = "unilab-notices";
const MAX_NOTICES = 150;
const listeners = new Set<() => void>();
let cache: WorkspaceNotice[] | null = null;

function emit() {
  for (const fn of listeners) fn();
}

function readStorage(): WorkspaceNotice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WorkspaceNotice => {
        return (
          !!item &&
          typeof item === "object" &&
          typeof (item as WorkspaceNotice).id === "string" &&
          typeof (item as WorkspaceNotice).text === "string" &&
          typeof (item as WorkspaceNotice).at === "string"
        );
      })
      .slice(0, MAX_NOTICES);
  } catch {
    return [];
  }
}

export function loadNotices(): WorkspaceNotice[] {
  if (!cache) cache = readStorage();
  return cache;
}

function persist(next: WorkspaceNotice[]) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  emit();
}

export function subscribeNotices(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function inferNoticeView(text: string): NavName | undefined {
  const t = text.toLowerCase();
  if (/рассылк/.test(t)) return "Рассылка";
  if (/инвайт/.test(t)) return "Инвайтинг";
  if (/сбор заверш|сбор аудитори|сбор запущен|задача сбора/.test(t)) return "Сбор аудитории";
  if (/клиент ответил|переписк|черновик/.test(t)) return "Переписки";
  if (/лид/.test(t)) return "Лиды";
  if (/прокси/.test(t)) return "Прокси";
  if (/аккаунт/.test(t)) return "Аккаунты";
  if (/групп|вступ|скан|обход|каталог|очеред/.test(t)) return "Группы и каналы";
  if (/настройк|тестовое уведомлен|бот подключ/.test(t)) return "Настройки";
  if (/ai|продукт|ядро/.test(t)) return "AI-ассистент";
  return undefined;
}

export function pushNotice(level: NoticeLevel, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const prev = loadNotices();
  const last = prev[0];
  if (last && last.text === trimmed && last.level === level && Date.now() - Date.parse(last.at) < 2500) {
    persist([{ ...last, at: new Date().toISOString(), read: false }, ...prev.slice(1)]);
    return;
  }
  const item: WorkspaceNotice = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    level,
    text: trimmed,
    view: inferNoticeView(trimmed),
    read: false,
  };
  persist([item, ...prev].slice(0, MAX_NOTICES));
}

export function markNoticesRead(ids?: string[]) {
  const prev = loadNotices();
  const set = ids ? new Set(ids) : null;
  persist(prev.map((item) => (!item.read && (!set || set.has(item.id)) ? { ...item, read: true } : item)));
}

export function clearNotices() {
  persist([]);
}

function capture(level: NoticeLevel, args: unknown[]) {
  const first = args[0];
  if (typeof first === "string") pushNotice(level, first);
}

export const toast = {
  success: (...args: Parameters<typeof sonnerToast.success>) => {
    capture("success", args);
    return sonnerToast.success(...args);
  },
  error: (...args: Parameters<typeof sonnerToast.error>) => {
    capture("error", args);
    return sonnerToast.error(...args);
  },
  message: (...args: Parameters<typeof sonnerToast.message>) => {
    capture("info", args);
    return sonnerToast.message(...args);
  },
};
