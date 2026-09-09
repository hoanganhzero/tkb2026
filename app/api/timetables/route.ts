import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { timetables } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const rows = await getDb().select().from(timetables)
    .where(eq(timetables.ownerEmail, user.email))
    .orderBy(desc(timetables.updatedAt)).limit(50);
  return Response.json({ data: rows.map((row) => ({
    ...row,
    assignments: JSON.parse(row.assignmentsJson),
    schedule: JSON.parse(row.scheduleJson),
    unresolved: JSON.parse(row.unresolvedJson),
  })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  const unresolved = Array.isArray(body.unresolved) ? body.unresolved : [];
  if (!name || !assignments.length) {
    return Response.json({ error: "Thiếu tên hoặc dữ liệu phân công." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await getDb().insert(timetables).values({
    id, ownerEmail: user.email, name,
    assignmentsJson: JSON.stringify(assignments),
    scheduleJson: JSON.stringify(schedule),
    unresolvedJson: JSON.stringify(unresolved),
    lessonCount: schedule.length, createdAt: now, updatedAt: now,
  });
  return Response.json({ id, name, lessonCount: schedule.length, updatedAt: now }, { status: 201 });
}
