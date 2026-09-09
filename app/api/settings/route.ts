import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { schoolProfiles } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

const EMPTY = {
  schoolName: "Trường của tôi",
  schoolYear: "2026-2027",
  campuses: [], teachers: [], classes: [], subjects: [], rooms: [], grades: [], periods: [], assignments: [], homerooms: [], config: {},
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const [row] = await getDb().select().from(schoolProfiles)
    .where(eq(schoolProfiles.ownerEmail, user.email)).limit(1);
  if (!row) return Response.json({ data: EMPTY });
  return Response.json({ data: {
    schoolName: row.schoolName,
    schoolYear: row.schoolYear,
    campuses: JSON.parse(row.campusesJson),
    teachers: JSON.parse(row.teachersJson),
    classes: JSON.parse(row.classesJson),
    subjects: JSON.parse(row.subjectsJson),
    rooms: JSON.parse(row.roomsJson),
    grades: JSON.parse(row.gradesJson),
    periods: JSON.parse(row.periodsJson),
    assignments: JSON.parse(row.assignmentsJson),
    homerooms: JSON.parse(row.homeroomsJson),
    config: JSON.parse(row.configJson),
  } });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const schoolName = String(body.schoolName ?? "").trim();
  const schoolYear = String(body.schoolYear ?? "").trim();
  if (!schoolName || !/^\d{4}-\d{4}$/.test(schoolYear)) {
    return Response.json({ error: "Tên trường hoặc năm học chưa hợp lệ." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const values = {
    ownerEmail: user.email, schoolName, schoolYear,
    campusesJson: JSON.stringify(Array.isArray(body.campuses) ? body.campuses : []),
    teachersJson: JSON.stringify(Array.isArray(body.teachers) ? body.teachers : []),
    classesJson: JSON.stringify(Array.isArray(body.classes) ? body.classes : []),
    subjectsJson: JSON.stringify(Array.isArray(body.subjects) ? body.subjects : []),
    roomsJson: JSON.stringify(Array.isArray(body.rooms) ? body.rooms : []),
    gradesJson: JSON.stringify(Array.isArray(body.grades) ? body.grades : []),
    periodsJson: JSON.stringify(Array.isArray(body.periods) ? body.periods : []),
    assignmentsJson: JSON.stringify(Array.isArray(body.assignments) ? body.assignments : []),
    homeroomsJson: JSON.stringify(Array.isArray(body.homerooms) ? body.homerooms : []),
    configJson: JSON.stringify(body.config && typeof body.config === "object" ? body.config : {}),
    updatedAt: now,
  };
  await getDb().insert(schoolProfiles).values(values).onConflictDoUpdate({
    target: schoolProfiles.ownerEmail,
    set: {
      schoolName: values.schoolName,
      schoolYear: values.schoolYear,
      campusesJson: values.campusesJson,
      teachersJson: values.teachersJson,
      classesJson: values.classesJson,
      subjectsJson: values.subjectsJson,
      roomsJson: values.roomsJson,
      gradesJson: values.gradesJson,
      periodsJson: values.periodsJson,
      assignmentsJson: values.assignmentsJson,
      homeroomsJson: values.homeroomsJson,
      configJson: values.configJson,
      updatedAt: values.updatedAt,
    },
  });
  return Response.json({ ok: true, updatedAt: now });
}
