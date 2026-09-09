import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { publicShares } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const rows = await getDb().select({ token: publicShares.token, scope: publicShares.scope, label: publicShares.label, updatedAt: publicShares.updatedAt }).from(publicShares).where(eq(publicShares.ownerEmail, user.email)).orderBy(desc(publicShares.updatedAt));
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const body = await request.json() as { scope?: string; label?: string; snapshot?: unknown };
  if (!body.scope || !body.label || !body.snapshot) return Response.json({ error: "Thiếu dữ liệu công khai." }, { status: 400 });
  const token = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  const now = new Date().toISOString();
  await getDb().insert(publicShares).values({ token, ownerEmail: user.email, scope: body.scope, label: body.label, snapshotJson: JSON.stringify(body.snapshot), createdAt: now, updatedAt: now });
  return Response.json({ data: { token, scope: body.scope, label: body.label, updatedAt: now } });
}
