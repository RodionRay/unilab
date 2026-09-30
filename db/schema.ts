import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    secret: text("secret"),
    created: text("created").notNull(),
  },
  (t) => [index("idx_records_owner_kind").on(t.owner, t.kind)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("idx_users_email").on(t.email)],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("idx_oauth_provider_uid").on(t.provider, t.providerUserId)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceOwnerId: text("workspace_owner_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    access: text("access").notNull(),
    created: text("created").notNull(),
  },
  (t) => [
    uniqueIndex("idx_ws_members_owner_user").on(t.workspaceOwnerId, t.userId),
    index("idx_ws_members_user").on(t.userId),
  ],
);

export const workspaceInvites = sqliteTable(
  "workspace_invites",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    workspaceOwnerId: text("workspace_owner_id").notNull(),
    role: text("role").notNull(),
    access: text("access").notNull(),
    expiresAt: text("expires_at").notNull(),
    created: text("created").notNull(),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
  },
  (t) => [
    uniqueIndex("idx_ws_invites_token").on(t.token),
    index("idx_ws_invites_owner").on(t.workspaceOwnerId),
  ],
);
