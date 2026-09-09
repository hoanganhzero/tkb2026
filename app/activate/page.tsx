import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { userAccounts } from "../../db/schema";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import ActivationClient from "./activation-client";

export const dynamic = "force-dynamic";
export default async function ActivatePage(){const user=await getChatGPTUser();if(!user)return <main className="auth-page"><section className="auth-card"><img className="auth-brand-image" src="/edutkb-mark.svg" alt="EduTKB"/><h1>Kích hoạt EduTKB</h1><p>Đăng nhập để kích hoạt bản quyền cho đúng tài khoản.</p><a className="login-button" href={chatGPTSignInPath("/activate")}>Đăng nhập bằng ChatGPT</a><a className="auth-back" href="/">Quay lại</a></section></main>;const [account]=await getDb().select().from(userAccounts).where(eq(userAccounts.email,user.email)).limit(1);if(!account)return <main className="auth-page"><section className="auth-card"><h1>Chưa có hồ sơ</h1><p>Hãy đăng ký tài khoản trước khi kích hoạt.</p><a className="login-button" href="/register">Đăng ký tài khoản</a></section></main>;return <main className="auth-page"><ActivationClient account={account}/></main>}
