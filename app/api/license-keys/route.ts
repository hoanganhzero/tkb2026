import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { licenseKeys, userAccounts } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { isAdminRole } from "../../../lib/roles";

export const dynamic = "force-dynamic";

async function adminEmail() {
  const user = await getChatGPTUser(); if (!user) return null;
  const [account] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  return isAdminRole(account?.role) ? user.email : null;
}
export async function GET() {
  const email = await adminEmail(); if (!email) return Response.json({ error: "Không có quyền quản trị." }, { status: 403 });
  const rows = await getDb().select().from(licenseKeys).orderBy(desc(licenseKeys.createdAt));
  return Response.json({ data: rows });
}
export async function POST(request: Request) {
  const email = await adminEmail(); if (!email) return Response.json({ error: "Không có quyền quản trị." }, { status: 403 });
  const body = await request.json() as { durationDays?: number; maxActivations?: number };
  const durationDays = Math.max(30, Math.min(3650, Number(body.durationDays) || 365));
  const maxActivations = Math.max(1, Math.min(1000, Number(body.maxActivations) || 1));
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const key = `EDUTKB-${random.slice(0,4)}-${random.slice(4,8)}-${random.slice(8,12)}`;
  const row = { key, durationDays, maxActivations, usedCount: 0, status: "active", createdBy: email, createdAt: new Date().toISOString() };
  await getDb().insert(licenseKeys).values(row); return Response.json({ data: row });
}
