import { pingDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await pingDatabase();
  return Response.json(
    {
      ok: db,
      db: db ? "up" : "down",
    },
    {
      status: db ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
