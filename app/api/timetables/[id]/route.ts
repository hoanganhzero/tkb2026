import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { timetables } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const { id } = await context.params;
  await getDb().delete(timetables).where(and(
    eq(timetables.id, id), eq(timetables.ownerEmail, user.email),
  ));
  return Response.json({ ok: true });
}
