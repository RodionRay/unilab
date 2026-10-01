/**
 * Project / funnel / feedback actions of /api/workspace (lead core v2 REQ-1..4, 12, 21, 24).
 * Every project id from the request is checked against `owner` before anything is read or written.
 * Zod errors propagate to the route, which answers 400.
 */

import { z } from "zod";
import { aiChatJson } from "@/lib/ai-client";
import type { D1LikeDatabase } from "@/lib/db";
import {
  addFeedbackExample,
  applyProjectPatch,
  defaultProjectId,
  MAX_PROJECTS_PER_OWNER,
  projectIdOf,
  projectPatchSchema,
  projectSchema,
  readFunnel,
  type ProjectData,
  type ProjectPatch,
  type ProjectRow,
} from "@/lib/leads";
import { projectCard } from "@/lib/leads/prompt";
import {
  dmFunnelId,
  findOwnedProject,
  listProjects,
  loadSettingsRow,
  mutateLead,
  mutateProject,
} from "@/lib/processes/lead-store";

export type ActionResult = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): ActionResult => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ActionResult => ({
  status,
  body: { error, ...extra },
});

const PROJECT_NOT_FOUND = "Проект не найден";
const idSchema = z.string().uuid();
const MAX_GROUPS_PER_MOVE = 500;

type Ctx = { db: D1LikeDatabase; owner: string; nowMs: number };

async function ownedProject(ctx: Ctx, id: string): Promise<ProjectRow | null> {
  const settings = await loadSettingsRow(ctx.db, ctx.owner);
  return findOwnedProject(ctx.db, ctx.owner, id, settings.data, ctx.nowMs);
}

/** `body.projectId` when present (must be the owner's), else the default project. */
export async function requestedProject(ctx: Ctx, raw: unknown): Promise<ProjectRow | null> {
  const id = raw === undefined || raw === null || raw === "" ? defaultProjectId(ctx.owner) : idSchema.parse(raw);
  return ownedProject(ctx, id);
}

export async function createProject(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const fields = projectPatchSchema.parse(body.data ?? {});
  const project = projectSchema.parse({ ...fields, updatedAt: new Date(ctx.nowMs).toISOString() });
  const settings = await loadSettingsRow(ctx.db, ctx.owner);
  await listProjects(ctx.db, ctx.owner, settings.data, ctx.nowMs);
  const id = crypto.randomUUID();
  // One statement: two parallel creates cannot both pass the per-owner limit.
  const res = await ctx.db
    .prepare(
      "INSERT INTO records(id,owner,kind,data,secret,created) SELECT ?,?,'project',?,NULL,? " +
        "WHERE (SELECT COUNT(*) FROM records WHERE owner=? AND kind='project')<?",
    )
    .bind(id, ctx.owner, JSON.stringify(project), new Date(ctx.nowMs).toISOString(), ctx.owner, MAX_PROJECTS_PER_OWNER)
    .run();
  if (!res.meta.changes) return fail(409, `Не больше ${MAX_PROJECTS_PER_OWNER} проектов`, { limitReached: true });
  return ok({ id, project });
}

export async function updateProject(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const id = idSchema.parse(body.id);
  const patch: ProjectPatch = projectPatchSchema.parse(body.patch ?? {});
  if (!(await ownedProject(ctx, id))) return fail(404, PROJECT_NOT_FOUND);
  const project = await mutateProject(ctx.db, ctx.owner, id, (p) => applyProjectPatch(p, patch, ctx.nowMs));
  return project ? ok({ id, project }) : fail(404, PROJECT_NOT_FOUND);
}

async function countGroupsOf(ctx: Ctx, projectId: string): Promise<number> {
  const row = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='group' AND json_extract(data,'$.projectId')=?")
    .bind(ctx.owner, projectId)
    .first<{ n: number }>();
  return Number(row?.n) || 0;
}

/** REQ-1: groups (and leads) of a deleted project move to `moveToProjectId` (required when it has groups). */
export async function deleteProject(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const id = idSchema.parse(body.id);
  const moveRaw = body.moveToProjectId;
  const moveTo = moveRaw === undefined || moveRaw === null || moveRaw === "" ? "" : idSchema.parse(moveRaw);
  if (id === defaultProjectId(ctx.owner)) return fail(400, "Основной проект удалить нельзя");
  if (!(await ownedProject(ctx, id))) return fail(404, PROJECT_NOT_FOUND);
  if (moveTo && (moveTo === id || !(await ownedProject(ctx, moveTo)))) return fail(404, "Проект для переноса не найден");
  const groups = await countGroupsOf(ctx, id);
  if (groups && !moveTo) return fail(409, "У проекта есть группы — выберите проект, куда их перенести", { groups });
  const target = moveTo || defaultProjectId(ctx.owner);
  const moved = await ctx.db
    .prepare(
      "UPDATE records SET data=json_set(data,'$.projectId',?) WHERE owner=? AND kind IN ('group','lead') AND json_extract(data,'$.projectId')=?",
    )
    .bind(target, ctx.owner, id)
    .run();
  await ctx.db.prepare("DELETE FROM records WHERE owner=? AND id=? AND kind='project'").bind(ctx.owner, id).run();
  return ok({ id, moved: moved.meta.changes, moveToProjectId: target });
}

export async function setGroupProject(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const groupIds = z.array(idSchema).min(1).max(MAX_GROUPS_PER_MOVE).parse(body.groupIds);
  const projectId = idSchema.parse(body.projectId);
  if (!(await ownedProject(ctx, projectId))) return fail(404, PROJECT_NOT_FOUND);
  let updated = 0;
  for (const gid of new Set(groupIds)) {
    const res = await ctx.db
      .prepare("UPDATE records SET data=json_set(data,'$.projectId',?) WHERE owner=? AND id=? AND kind='group'")
      .bind(projectId, ctx.owner, gid)
      .run();
    updated += res.meta.changes;
  }
  return ok({ projectId, updated });
}

const daysSchema = z.union([z.literal(1), z.literal(7)]);

/** REQ-12: `scan_day` aggregate of the project plus the owner-level DM row. */
export async function projectFunnel(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const projectId = idSchema.parse(body.projectId);
  const days = daysSchema.parse(body.days ?? 1);
  if (!(await ownedProject(ctx, projectId))) return fail(404, PROJECT_NOT_FOUND);
  const [funnel, dm] = await Promise.all([
    readFunnel(ctx.db, ctx.owner, projectId, days, ctx.nowMs),
    readFunnel(ctx.db, ctx.owner, dmFunnelId(ctx.owner), days, ctx.nowMs),
  ]);
  return ok({ funnel, dm: { ...dm, projectId: "dm" } });
}

/** REQ-21: the lead text becomes a good/bad example of its project; stop words never change. */
export async function leadFeedback(ctx: Ctx, body: Record<string, unknown>): Promise<ActionResult> {
  const id = idSchema.parse(body.id);
  const verdict = z.enum(["good", "bad"]).parse(body.verdict);
  const row = await ctx.db
    .prepare("SELECT data FROM records WHERE owner=? AND id=? AND kind='lead'")
    .bind(ctx.owner, id)
    .first<{ data: string }>();
  if (!row) return fail(404, "Лид не найден");
  const lead = JSON.parse(String(row.data)) as Record<string, unknown>;
  const projectId = projectIdOf(lead, ctx.owner);
  if (!(await ownedProject(ctx, projectId))) return fail(404, "Проект лида не найден");
  const project = await mutateProject(ctx.db, ctx.owner, projectId, (p) => addFeedbackExample(p, verdict, String(lead.message ?? "")));
  const marked = await mutateLead(ctx.db, ctx.owner, id, (cur) => ({
    next: { ...cur, feedback: verdict, ...(verdict === "bad" && !cur.viewed ? { viewed: true, viewedAt: new Date(ctx.nowMs).toISOString() } : {}) },
    result: null,
  }));
  return ok({ lead: marked?.lead ?? lead, projectId, project });
}

const MAX_KEYWORD_LENGTH = 100;
const MAX_KEYWORDS = 30;

const productAnswerSchema = z.object({
  product: z.string().default(""),
  audience: z.string().default(""),
  leadCriteria: z.string().default(""),
  notLead: z.string().default(""),
  valueProps: z.string().default(""),
  tone: z.string().default(""),
  cta: z.string().default(""),
  keywords: z.array(z.string()).default([]),
});

const CARD_LIMITS = {
  product: 12000,
  audience: 2000,
  leadCriteria: 4000,
  notLead: 4000,
  valueProps: 4000,
  tone: 500,
  cta: 500,
} as const;

/** Non-empty AI fields only; the stop list is never touched (no auto-minus, REQ-21/22). */
function cardPatchFrom(answer: z.infer<typeof productAnswerSchema>): ProjectPatch {
  const patch: ProjectPatch = {};
  for (const [key, max] of Object.entries(CARD_LIMITS) as [keyof typeof CARD_LIMITS, number][]) {
    const value = answer[key].trim().slice(0, max);
    if (value) patch[key] = value;
  }
  const keywords = [...new Set(answer.keywords.map((k) => k.trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH)).filter(Boolean))];
  if (keywords.length) patch.keywords = keywords.slice(0, MAX_KEYWORDS);
  return patch;
}

/** REQ-4: AI rebuilds the project card from its `url` and the current card; settings are not written. */
export async function rebuildProduct(ctx: Ctx, body: Record<string, unknown>, apiKey: string): Promise<ActionResult> {
  const projectId = idSchema.parse(body.projectId);
  const notes = z.string().max(4000).optional().parse(body.notes) ?? "";
  const found = await ownedProject(ctx, projectId);
  if (!found) return fail(404, PROJECT_NOT_FOUND);
  if (!apiKey) return fail(409, "DeepSeek ключ не найден. Добавьте AI_API_KEY в .env");
  const answer = await aiChatJson(productAnswerSchema, {
    apiKey,
    maxTokens: 3500,
    temperature: 0.35,
    system:
      "Ты продуктовый аналитик. Пересобери карточку проекта для AI-судьи лидов на русском. " +
      'Верни ТОЛЬКО JSON: {"product":"...","audience":"...","leadCriteria":"...","notLead":"...","valueProps":"...","tone":"...","cta":"...","keywords":["..."]}. ' +
      "product — 6–12 предложений: что продаётся, кому, ключевые возможности. leadCriteria — кто лид, notLead — кто не лид. " +
      "keywords — до 30 коротких тем (подсказка судье, не фильтр). Не выдумывай цифры и факты, которых нет во входе.",
    user: `Сайт проекта: ${found.project.url || "не указан"}\n\nТекущая карточка:\n${projectCard(found.project)}\n\nЗаметки владельца:\n${notes || "—"}`,
  });
  const patch = cardPatchFrom(answer);
  const project = await mutateProject(ctx.db, ctx.owner, projectId, (p) => applyProjectPatch(p, patch, ctx.nowMs));
  return project ? ok({ id: projectId, project }) : fail(404, PROJECT_NOT_FOUND);
}

const aboutSchema = z.object({
  about: z.string().default(""),
  firstName: z.string().default(""),
  lastName: z.string().nullable().default(""),
});

const ABOUT_MAX = 70;
const NAME_MAX = 32;

function aboutFallback(project: ProjectData, brand: string): string {
  const pitch = String(project.valueProps || project.product || project.cta || brand).replace(/\s+/g, " ").trim();
  return (pitch ? `${brand}: ${pitch}` : `${brand} — помощь и консультации`).slice(0, ABOUT_MAX);
}

/** REQ-4: profile text for farm accounts from the requested (else default) project card. */
export async function generateAccountAbout(ctx: Ctx, body: Record<string, unknown>, apiKey: string): Promise<ActionResult> {
  const notes = z.string().max(500).optional().parse(body.notes) ?? "";
  const found = await requestedProject(ctx, body.projectId);
  if (!found) return fail(404, PROJECT_NOT_FOUND);
  const brand = found.project.name.slice(0, 40) || "сервис";
  let about = "";
  let firstName = brand.slice(0, NAME_MAX);
  let lastName = "";
  if (apiKey) {
    try {
      const answer = await aiChatJson(aboutSchema, {
        apiKey,
        maxTokens: 400,
        temperature: 0.45,
        system:
          "Ты пишешь короткие профили Telegram-аккаунтов для B2B-продаж. " +
          'Верни ТОЛЬКО JSON {"about":"...","firstName":"...","lastName":"..."}. ' +
          "about — 1 короткое предложение о сервисе/компании, макс 70 символов, на русском. " +
          "firstName — короткое имя бренда или менеджера (до 24 символов). lastName — опционально (роль/пусто).",
        user: `Карточка проекта:\n${projectCard(found.project, 1500)}\n\nЗаметки: ${notes || "Сделай узнаваемым описание сервиса для диалога с клиентом."}`,
      });
      about = answer.about.replace(/\s+/g, " ").trim().slice(0, ABOUT_MAX);
      if (answer.firstName.trim()) firstName = answer.firstName.trim().slice(0, NAME_MAX);
      lastName = String(answer.lastName ?? "").trim().slice(0, NAME_MAX);
    } catch (e) {
      console.error("[workspace] generate_account_about:", String((e as Error)?.message || e).slice(0, 300));
    }
  }
  if (!about) about = aboutFallback(found.project, brand);
  return ok({ about, firstName, lastName, fromAi: !!apiKey, projectId: found.id });
}
