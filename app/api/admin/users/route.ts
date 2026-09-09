import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { userAccounts } from "../../../../db/schema";
import { isAdminRole } from "../../../../lib/roles";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const [account] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  return isAdminRole(account?.role) ? user : null;
}

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) return Response.json({ error: "Không có quyền quản trị." }, { status: 403 });
  const rows = await getDb().select().from(userAccounts).orderBy(desc(userAccounts.createdAt));
  return Response.json({ data: rows.map(({ licenseKey: _licenseKey, ...row }) => row) });
}

export async function PUT(request: Request) {
  const admin = await requireSuperAdmin();
  if (!admin) return Response.json({ error: "Không có quyền quản trị." }, { status: 403 });
  const body = await request.json() as { email?: string; action?: "activate" | "deactivate" };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email === admin.email) return Response.json({ error: "Không thể thay đổi tài khoản quản trị tối cao." }, { status: 400 });
  const [target] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, email)).limit(1);
  if (!target || isAdminRole(target.role)) return Response.json({ error: "Tài khoản không hợp lệ." }, { status: 400 });

  const now = new Date();
  if (body.action === "activate") {
    const expires = new Date(now); expires.setDate(expires.getDate() + 365);
    await getDb().update(userAccounts).set({ licenseStatus: "active", expiresAt: expires.toISOString(), updatedAt: now.toISOString() }).where(eq(userAccounts.email, email));
    return Response.json({ data: { email, licenseStatus: "active", expiresAt: expires.toISOString() } });
  }
  if (body.action === "deactivate") {
    await getDb().update(userAccounts).set({ licenseStatus: "expired", expiresAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(userAccounts.email, email));
    return Response.json({ data: { email, licenseStatus: "expired", expiresAt: now.toISOString() } });
  }
  return Response.json({ error: "Thao tác không hợp lệ." }, { status: 400 });
}
