export const STAFF_ROLES = ["admin", "manager", "operator", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  operator: "Оператор",
  viewer: "Наблюдатель",
};

export const CRM_ACCESS_KEYS = [
  "overview",
  "notifications",
  "leads",
  "chats",
  "groups",
  "audience",
  "invite",
  "mailing",
  "accounts",
  "proxies",
  "ai",
  "settings",
  "staff",
] as const;

export type CrmAccessKey = (typeof CRM_ACCESS_KEYS)[number];

export const CRM_ACCESS_LABELS: Record<CrmAccessKey, string> = {
  overview: "Обзор",
  notifications: "Уведомления",
  leads: "Лиды",
  chats: "Переписки",
  groups: "Группы и каналы",
  audience: "Сбор аудитории",
  invite: "Инвайтинг",
  mailing: "Рассылка",
  accounts: "Аккаунты",
  proxies: "Прокси",
  ai: "AI-ассистент",
  settings: "Настройки",
  staff: "Сотрудники",
};

export const NAV_TO_ACCESS: Record<string, CrmAccessKey> = {
  Обзор: "overview",
  Уведомления: "notifications",
  Лиды: "leads",
  Переписки: "chats",
  "Группы и каналы": "groups",
  "Сбор аудитории": "audience",
  Инвайтинг: "invite",
  Рассылка: "mailing",
  Аккаунты: "accounts",
  Прокси: "proxies",
  "AI-ассистент": "ai",
  Настройки: "settings",
  Сотрудники: "staff",
};

export type CrmAccess = Record<CrmAccessKey, boolean>;

export type WorkspaceMember = {
  id: string;
  workspaceOwnerId: string;
  userId: string;
  role: StaffRole;
  access: CrmAccess;
  created: string;
  name?: string;
  email?: string | null;
};

export type WorkspaceInvite = {
  id: string;
  token: string;
  workspaceOwnerId: string;
  role: StaffRole;
  access: CrmAccess;
  expiresAt: string;
  created: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
};

export type WorkspaceContext = {
  userId: string;
  ownerId: string;
  isOwner: boolean;
  role: StaffRole | "owner";
  access: CrmAccess;
  memberId?: string;
};

export const ALL_CRM_ACCESS = Object.fromEntries(
  CRM_ACCESS_KEYS.map((k) => [k, true]),
) as CrmAccess;

export const ROLE_PRESETS: Record<StaffRole, CrmAccess> = {
  admin: { ...ALL_CRM_ACCESS, staff: false },
  manager: {
    overview: true,
    notifications: true,
    leads: true,
    chats: true,
    groups: true,
    audience: true,
    invite: true,
    mailing: true,
    accounts: false,
    proxies: false,
    ai: true,
    settings: false,
    staff: false,
  },
  operator: {
    overview: true,
    notifications: true,
    leads: true,
    chats: true,
    groups: true,
    audience: false,
    invite: false,
    mailing: false,
    accounts: false,
    proxies: false,
    ai: false,
    settings: false,
    staff: false,
  },
  viewer: {
    overview: true,
    notifications: true,
    leads: true,
    chats: true,
    groups: false,
    audience: false,
    invite: false,
    mailing: false,
    accounts: false,
    proxies: false,
    ai: false,
    settings: false,
    staff: false,
  },
};

export function accessForRole(role: StaffRole, override?: Partial<CrmAccess>): CrmAccess {
  return { ...ROLE_PRESETS[role], ...(override || {}), staff: false };
}

export function parseAccess(raw: unknown, role: StaffRole = "viewer"): CrmAccess {
  const base = accessForRole(role);
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const next = { ...base };
  for (const key of CRM_ACCESS_KEYS) {
    if (typeof obj[key] === "boolean") next[key] = obj[key] as boolean;
  }
  next.staff = false;
  return next;
}

export function canAccessNav(ctx: WorkspaceContext, name: string): boolean {
  if (ctx.isOwner) return true;
  const key = NAV_TO_ACCESS[name];
  if (!key) return true;
  return !!ctx.access[key];
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/invite/${token}`;
}
