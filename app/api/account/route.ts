import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { licenseKeys, schoolProfiles, userAccounts } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const [account] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  return Response.json({ data: account ?? null });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const body = await request.json() as { fullName?: string; phone?: string; school?: string; province?: string };
  const fullName = String(body.fullName ?? user.displayName).trim();
  const school = String(body.school ?? "").trim();
  if (!fullName || !school) return Response.json({ error: "Họ tên và đơn vị trường học là bắt buộc." }, { status: 400 });
  const [existing] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  if (existing) return Response.json({ data: existing });
  const [firstAccount] = await getDb().select({ email: userAccounts.email }).from(userAccounts).limit(1);
  const now = new Date(); const expires = new Date(now); expires.setDate(expires.getDate() + 30);
  const values = { email: user.email, fullName, phone: String(body.phone ?? "").trim(), school, province: String(body.province ?? "").trim(), role: firstAccount ? "user" : "super_admin", licenseStatus: "trial", licenseKey: null, expiresAt: expires.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await getDb().insert(userAccounts).values(values);
  await getDb().insert(schoolProfiles).values({ ownerEmail: user.email, schoolName: school, schoolYear: "2026-2027", updatedAt: now.toISOString() }).onConflictDoUpdate({ target: schoolProfiles.ownerEmail, set: { schoolName: school, updatedAt: now.toISOString() } });
  return Response.json({ data: values });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const body = await request.json() as { licenseKey?: string };
  const key = String(body.licenseKey ?? "").trim().toUpperCase();
  const [license] = await getDb().select().from(licenseKeys).where(eq(licenseKeys.key, key)).limit(1);
  if (!license || license.status !== "active" || license.usedCount >= license.maxActivations) return Response.json({ error: "Mã bản quyền không hợp lệ hoặc đã hết lượt kích hoạt." }, { status: 400 });
  const [account] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  if (!account) return Response.json({ error: "Hãy đăng ký tài khoản trước." }, { status: 400 });
  const base = new Date(account.expiresAt) > new Date() ? new Date(account.expiresAt) : new Date(); base.setDate(base.getDate() + license.durationDays);
  await getDb().update(userAccounts).set({ licenseStatus: "active", licenseKey: key, expiresAt: base.toISOString(), updatedAt: new Date().toISOString() }).where(eq(userAccounts.email, user.email));
  const usedCount = license.usedCount + 1;
  await getDb().update(licenseKeys).set({ usedCount, status: usedCount >= license.maxActivations ? "used" : "active" }).where(eq(licenseKeys.key, key));
  return Response.json({ data: { licenseStatus: "active", expiresAt: base.toISOString() } });
}
