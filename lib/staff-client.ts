import type { CrmAccess, StaffRole, WorkspaceInvite, WorkspaceMember } from "@/lib/staff-types";

/** Response shapes of app/api/staff/route.ts, as read by the browser. */
export type StaffInvitePreview = {
  role: StaffRole;
  access: CrmAccess;
  expiresAt: string;
  ownerName: string;
};
export type StaffViewer = { userId: string; email: string; name: string };
export type StaffInviteLookupResponse = { invite: StaffInvitePreview; me: StaffViewer | null };
export type StaffListResponse = { members?: WorkspaceMember[]; invites?: WorkspaceInvite[] };
export type StaffCreateInviteResponse = { ok: true; url: string };
export type StaffBulkRemoveResponse = { ok: true; removed?: number };
export type StaffClearAllResponse = { ok: true; members?: number; invites?: number };
export type StaffOkResponse = { ok: true };

function serverError(data: unknown): string {
  if (typeof data !== "object" || data === null || !("error" in data)) return "";
  return typeof data.error === "string" ? data.error : "";
}

/**
 * Reads a /api/staff JSON reply: non-2xx → Error with the server message (or `fallbackError`),
 * 2xx → the body typed as the route's documented shape `T`.
 */
export async function readStaffResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(serverError(data) || fallbackError);
  return data as T;
}
