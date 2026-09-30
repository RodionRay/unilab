import { database } from "@/lib/server-store";
import {
  STAFF_ROLES,
  accessForRole,
  parseAccess,
  type CrmAccess,
  type StaffRole,
  type WorkspaceContext,
  type WorkspaceInvite,
  type WorkspaceMember,
  ALL_CRM_ACCESS,
} from "@/lib/staff-types";

export * from "@/lib/staff-types";

let ensured = false;

export async function ensureStaffTables() {
  if (ensured) return;
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS workspace_members (
        id text PRIMARY KEY NOT NULL,
        workspace_owner_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL,
        access text NOT NULL,
        created text NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_members_owner_user
       ON workspace_members (workspace_owner_id, user_id)`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ws_members_user
       ON workspace_members (user_id)`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS workspace_invites (
        id text PRIMARY KEY NOT NULL,
        token text NOT NULL,
        workspace_owner_id text NOT NULL,
        role text NOT NULL,
        access text NOT NULL,
        expires_at text NOT NULL,
        created text NOT NULL,
        accepted_by text,
        accepted_at text
      )`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_invites_token
       ON workspace_invites (token)`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ws_invites_owner
       ON workspace_invites (workspace_owner_id)`,
    )
    .bind()
    .run();
  ensured = true;
}

function rowMember(row: Record<string, unknown> | null): WorkspaceMember | null {
  if (!row) return null;
  const role = (STAFF_ROLES.includes(row.role as StaffRole)
    ? row.role
    : "viewer") as StaffRole;
  let access: CrmAccess;
  try {
    access = parseAccess(JSON.parse(String(row.access || "{}")), role);
  } catch {
    access = accessForRole(role);
  }
  return {
    id: String(row.id),
    workspaceOwnerId: String(row.workspace_owner_id),
    userId: String(row.user_id),
    role,
    access,
    created: String(row.created || ""),
    name: row.name ? String(row.name) : undefined,
    email: row.email != null ? String(row.email) : null,
  };
}

function rowInvite(row: Record<string, unknown> | null): WorkspaceInvite | null {
  if (!row) return null;
  const role = (STAFF_ROLES.includes(row.role as StaffRole)
    ? row.role
    : "viewer") as StaffRole;
  let access: CrmAccess;
  try {
    access = parseAccess(JSON.parse(String(row.access || "{}")), role);
  } catch {
    access = accessForRole(role);
  }
  return {
    id: String(row.id),
    token: String(row.token),
    workspaceOwnerId: String(row.workspace_owner_id),
    role,
    access,
    expiresAt: String(row.expires_at || ""),
    created: String(row.created || ""),
    acceptedBy: row.accepted_by ? String(row.accepted_by) : null,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
  };
}

export async function resolveWorkspaceContext(
  userId: string,
): Promise<WorkspaceContext> {
  await ensureStaffTables();
  const row = await database()
    .prepare(
      "SELECT * FROM workspace_members WHERE user_id=? ORDER BY created ASC LIMIT 1",
    )
    .bind(userId)
    .first();
  const member = rowMember(row);
  if (member) {
    return {
      userId,
      ownerId: member.workspaceOwnerId,
      isOwner: false,
      role: member.role,
      access: member.access,
      memberId: member.id,
    };
  }
  return {
    userId,
    ownerId: userId,
    isOwner: true,
    role: "owner",
    access: ALL_CRM_ACCESS,
  };
}

export async function listMembers(
  workspaceOwnerId: string,
): Promise<WorkspaceMember[]> {
  await ensureStaffTables();
  const result = await database()
    .prepare(
      `SELECT m.*, u.name as name, u.email as email
       FROM workspace_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.workspace_owner_id=?
       ORDER BY m.created ASC`,
    )
    .bind(workspaceOwnerId)
    .all();
  return (result.results || [])
    .map((r: any) => rowMember(r))
    .filter(Boolean) as WorkspaceMember[];
}

export async function listPendingInvites(
  workspaceOwnerId: string,
): Promise<WorkspaceInvite[]> {
  await ensureStaffTables();
  const result = await database()
    .prepare(
      `SELECT * FROM workspace_invites
       WHERE workspace_owner_id=? AND accepted_by IS NULL
       ORDER BY created DESC`,
    )
    .bind(workspaceOwnerId)
    .all();
  const now = Date.now();
  return (result.results || [])
    .map((r: any) => rowInvite(r))
    .filter((inv): inv is WorkspaceInvite => {
      if (!inv) return false;
      const exp = Date.parse(inv.expiresAt);
      return Number.isFinite(exp) && exp > now;
    });
}

export async function findInviteByToken(
  token: string,
): Promise<WorkspaceInvite | null> {
  await ensureStaffTables();
  const row = await database()
    .prepare("SELECT * FROM workspace_invites WHERE token=?")
    .bind(token)
    .first();
  return rowInvite(row);
}

export async function createInvite(input: {
  workspaceOwnerId: string;
  role: StaffRole;
  access?: Partial<CrmAccess>;
  days?: number;
}): Promise<WorkspaceInvite> {
  await ensureStaffTables();
  const role = input.role;
  const access = accessForRole(role, input.access);
  const days = Math.min(30, Math.max(1, input.days ?? 7));
  const now = new Date();
  const invite: WorkspaceInvite = {
    id: crypto.randomUUID(),
    token:
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    workspaceOwnerId: input.workspaceOwnerId,
    role,
    access,
    expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
    created: now.toISOString(),
    acceptedBy: null,
    acceptedAt: null,
  };
  await database()
    .prepare(
      `INSERT INTO workspace_invites
       (id,token,workspace_owner_id,role,access,expires_at,created,accepted_by,accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      invite.id,
      invite.token,
      invite.workspaceOwnerId,
      invite.role,
      JSON.stringify(invite.access),
      invite.expiresAt,
      invite.created,
      null,
      null,
    )
    .run();
  return invite;
}

export async function revokeInvite(
  workspaceOwnerId: string,
  inviteId: string,
): Promise<boolean> {
  await ensureStaffTables();
  const r = await database()
    .prepare(
      "DELETE FROM workspace_invites WHERE id=? AND workspace_owner_id=? AND accepted_by IS NULL",
    )
    .bind(inviteId, workspaceOwnerId)
    .run();
  return (r.meta?.changes || 0) > 0;
}

export async function updateMember(input: {
  workspaceOwnerId: string;
  memberId: string;
  role?: StaffRole;
  access?: Partial<CrmAccess>;
}): Promise<WorkspaceMember | null> {
  await ensureStaffTables();
  const row = await database()
    .prepare(
      "SELECT * FROM workspace_members WHERE id=? AND workspace_owner_id=?",
    )
    .bind(input.memberId, input.workspaceOwnerId)
    .first();
  const current = rowMember(row);
  if (!current) return null;
  const role = input.role || current.role;
  const access = accessForRole(role, input.access ?? current.access);
  await database()
    .prepare(
      "UPDATE workspace_members SET role=?, access=? WHERE id=? AND workspace_owner_id=?",
    )
    .bind(role, JSON.stringify(access), input.memberId, input.workspaceOwnerId)
    .run();
  return { ...current, role, access };
}

export async function removeMember(
  workspaceOwnerId: string,
  memberId: string,
): Promise<boolean> {
  await ensureStaffTables();
  const r = await database()
    .prepare(
      "DELETE FROM workspace_members WHERE id=? AND workspace_owner_id=?",
    )
    .bind(memberId, workspaceOwnerId)
    .run();
  return (r.meta?.changes || 0) > 0;
}

export async function removeMembers(
  workspaceOwnerId: string,
  memberIds: string[],
): Promise<number> {
  await ensureStaffTables();
  if (!memberIds.length) return 0;
  let removed = 0;
  for (const id of memberIds) {
    const ok = await removeMember(workspaceOwnerId, id);
    if (ok) removed++;
  }
  return removed;
}

export async function revokeInvites(
  workspaceOwnerId: string,
  inviteIds: string[],
): Promise<number> {
  await ensureStaffTables();
  if (!inviteIds.length) return 0;
  let removed = 0;
  for (const id of inviteIds) {
    const ok = await revokeInvite(workspaceOwnerId, id);
    if (ok) removed++;
  }
  return removed;
}

export async function clearAllStaff(workspaceOwnerId: string): Promise<{
  members: number;
  invites: number;
}> {
  await ensureStaffTables();
  const m = await database()
    .prepare("DELETE FROM workspace_members WHERE workspace_owner_id=?")
    .bind(workspaceOwnerId)
    .run();
  const i = await database()
    .prepare(
      "DELETE FROM workspace_invites WHERE workspace_owner_id=? AND accepted_by IS NULL",
    )
    .bind(workspaceOwnerId)
    .run();
  return {
    members: m.meta?.changes || 0,
    invites: i.meta?.changes || 0,
  };
}

const ALREADY_IN_OTHER_WORKSPACE =
  "Вы уже состоите в другом кабинете. Сначала выйдите из него.";

export async function acceptInvite(input: {
  token: string;
  userId: string;
}): Promise<{ ok: true; ownerId: string } | { ok: false; error: string }> {
  await ensureStaffTables();
  const invite = await findInviteByToken(input.token);
  if (!invite) return { ok: false, error: "Приглашение не найдено" };
  if (invite.acceptedBy)
    return { ok: false, error: "Приглашение уже использовано" };
  const exp = Date.parse(invite.expiresAt);
  if (!Number.isFinite(exp) || exp <= Date.now())
    return { ok: false, error: "Срок приглашения истёк" };
  if (invite.workspaceOwnerId === input.userId)
    return { ok: false, error: "Нельзя принять приглашение в свой кабинет" };

  const existing = await database()
    .prepare(
      "SELECT id FROM workspace_members WHERE workspace_owner_id=? AND user_id=?",
    )
    .bind(invite.workspaceOwnerId, input.userId)
    .first();
  if (!existing) {
    const other = await database()
      .prepare("SELECT id FROM workspace_members WHERE user_id=? LIMIT 1")
      .bind(input.userId)
      .first();
    if (other) return { ok: false, error: ALREADY_IN_OTHER_WORKSPACE };
  }

  // Claim the invite atomically before creating the membership: of two concurrent
  // accepts only one UPDATE can see accepted_by IS NULL.
  const now = new Date().toISOString();
  if (!(await claimInvite(invite.id, input.userId, now)))
    return { ok: false, error: "Приглашение уже использовано" };
  if (existing) return { ok: true, ownerId: invite.workspaceOwnerId };

  // The pre-check above is advisory: two accepts into different workspaces can both
  // pass it. The guarded INSERT is one statement, so only one membership can land.
  let inserted: boolean;
  try {
    const r = await database()
      .prepare(
        `INSERT INTO workspace_members
         (id,workspace_owner_id,user_id,role,access,created)
         SELECT ?,?,?,?,?,?
         WHERE NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id=?)`,
      )
      .bind(
        crypto.randomUUID(),
        invite.workspaceOwnerId,
        input.userId,
        invite.role,
        JSON.stringify(invite.access),
        now,
        input.userId,
      )
      .run();
    inserted = (r.meta?.changes || 0) > 0;
  } catch (error) {
    await releaseInvite(invite.id, input.userId);
    throw error;
  }
  if (!inserted) {
    await releaseInvite(invite.id, input.userId);
    return { ok: false, error: ALREADY_IN_OTHER_WORKSPACE };
  }
  return { ok: true, ownerId: invite.workspaceOwnerId };
}

async function claimInvite(
  inviteId: string,
  userId: string,
  acceptedAt: string,
): Promise<boolean> {
  const r = await database()
    .prepare(
      "UPDATE workspace_invites SET accepted_by=?, accepted_at=? WHERE id=? AND accepted_by IS NULL",
    )
    .bind(userId, acceptedAt, inviteId)
    .run();
  return (r.meta?.changes || 0) > 0;
}

async function releaseInvite(inviteId: string, userId: string): Promise<void> {
  await database()
    .prepare(
      "UPDATE workspace_invites SET accepted_by=NULL, accepted_at=NULL WHERE id=? AND accepted_by=?",
    )
    .bind(inviteId, userId)
    .run();
}
