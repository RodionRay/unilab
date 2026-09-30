import { z } from "zod";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import {
  STAFF_ROLES,
  CRM_ACCESS_KEYS,
  acceptInvite,
  accessForRole,
  createInvite,
  findInviteByToken,
  inviteUrl,
  listMembers,
  listPendingInvites,
  removeMember,
  removeMembers,
  resolveWorkspaceContext,
  revokeInvite,
  revokeInvites,
  clearAllStaff,
  updateMember,
  type StaffRole,
} from "@/lib/staff";

export const runtime = "nodejs";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const accessSchema = z
  .object(
    Object.fromEntries(CRM_ACCESS_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof CRM_ACCESS_KEYS)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .partial()
  .optional();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (token) {
    const invite = await findInviteByToken(token);
    if (!invite) return reply({ error: "Приглашение не найдено" }, 404);
    if (invite.acceptedBy)
      return reply({ error: "Приглашение уже использовано" }, 410);
    if (Date.parse(invite.expiresAt) <= Date.now())
      return reply({ error: "Срок приглашения истёк" }, 410);
    let ownerName = "Владелец кабинета";
    try {
      const owner = await findUserById(invite.workspaceOwnerId);
      if (owner?.name) ownerName = owner.name;
      else if (owner?.email) ownerName = owner.email;
    } catch {
      /* */
    }
    const user = await getSessionUser();
    return reply({
      invite: {
        role: invite.role,
        access: invite.access,
        expiresAt: invite.expiresAt,
        ownerName,
      },
      me: user
        ? { userId: user.userId, email: user.email, name: user.displayName }
        : null,
    });
  }

  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите в кабинет" }, 401);
  const ctx = await resolveWorkspaceContext(user.userId);

  if (!ctx.isOwner) {
    return reply(
      {
        workspace: ctx,
        members: [],
        invites: [],
        error: "Управлять сотрудниками может только владелец кабинета",
      },
      403,
    );
  }

  const [members, invites] = await Promise.all([
    listMembers(ctx.ownerId),
    listPendingInvites(ctx.ownerId),
  ]);
  return reply({ workspace: ctx, members, invites });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return reply({ error: "Войдите в кабинет" }, 401);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return reply({ error: "Недопустимый источник запроса" }, 403);

  let body: any;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return reply({ error: "Некорректный JSON" }, 400);
  }

  const action = String(body.action || "");

  if (action === "accept_invite") {
    const token = z.string().min(16).max(80).parse(body.token);
    const result = await acceptInvite({ token, userId: user.userId });
    if (!result.ok) return reply({ error: result.error }, 400);
    return reply({ ok: true, ownerId: result.ownerId });
  }

  const ctx = await resolveWorkspaceContext(user.userId);
  if (!ctx.isOwner)
    return reply({ error: "Только владелец может управлять сотрудниками" }, 403);

  if (action === "create_invite") {
    const role = z.enum(STAFF_ROLES).parse(body.role ?? "manager") as StaffRole;
    const access = accessSchema.parse(body.access);
    const days = z.coerce.number().int().min(1).max(30).default(7).parse(body.days ?? 7);
    const invite = await createInvite({
      workspaceOwnerId: ctx.ownerId,
      role,
      access: access || accessForRole(role),
      days,
    });
    const base =
      origin ||
      `${new URL(req.url).protocol}//${req.headers.get("host") || "localhost:5173"}`;
    return reply({
      ok: true,
      invite,
      url: inviteUrl(base, invite.token),
    });
  }

  if (action === "revoke_invite") {
    const id = z.string().uuid().parse(body.id);
    const ok = await revokeInvite(ctx.ownerId, id);
    if (!ok) return reply({ error: "Приглашение не найдено" }, 404);
    return reply({ ok: true });
  }

  if (action === "update_member") {
    const memberId = z.string().uuid().parse(body.id);
    const role = body.role
      ? (z.enum(STAFF_ROLES).parse(body.role) as StaffRole)
      : undefined;
    const access = accessSchema.parse(body.access);
    const member = await updateMember({
      workspaceOwnerId: ctx.ownerId,
      memberId,
      role,
      access,
    });
    if (!member) return reply({ error: "Сотрудник не найден" }, 404);
    return reply({ ok: true, member });
  }

  if (action === "remove_member") {
    const memberId = z.string().uuid().parse(body.id);
    const ok = await removeMember(ctx.ownerId, memberId);
    if (!ok) return reply({ error: "Сотрудник не найден" }, 404);
    return reply({ ok: true });
  }

  if (action === "remove_members") {
    const ids = z.array(z.string().uuid()).min(1).max(200).parse(body.ids);
    const removed = await removeMembers(ctx.ownerId, ids);
    return reply({ ok: true, removed });
  }

  if (action === "revoke_invites") {
    const ids = z.array(z.string().uuid()).min(1).max(200).parse(body.ids);
    const removed = await revokeInvites(ctx.ownerId, ids);
    return reply({ ok: true, removed });
  }

  if (action === "clear_all") {
    const result = await clearAllStaff(ctx.ownerId);
    return reply({ ok: true, ...result });
  }

  return reply({ error: "Неизвестное действие" }, 400);
}
