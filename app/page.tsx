import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { userAccounts } from "../db/schema";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import TkbConsole from "./tkb-console";
import { isAdminRole } from "../lib/roles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) {
    return <main className="login-page">
      <div className="login-preview" aria-hidden="true">
        <header><strong>EduTKB</strong><span>Quản lý thời khóa biểu thông minh</span></header>
        <div className="login-preview-line" />
        <section>
          <p>VẬN HÀNH LỊCH HỌC LIỀN MẠCH</p>
          <div className="login-module-row">
            <article><b>01</b><span>Dữ liệu trường</span></article>
            <article><b>02</b><span>Phân công</span></article>
            <article><b>03</b><span>Xếp lịch</span></article>
            <article><b>04</b><span>Kiểm tra</span></article>
            <article><b>05</b><span>Công bố</span></article>
            <article><b>06</b><span>Báo cáo</span></article>
          </div>
          <div className="login-preview-cards"><article /><article /><article /></div>
        </section>
      </div>
      <div className="login-dimmer" />
      <section className="login-modal" aria-labelledby="login-title">
        <div className="login-product"><img className="login-brand-image" src="/edutkb-mark.svg" alt="" /><div><b>EduTKB</b><small>Thời khóa biểu thông minh</small></div></div>
        <h1 id="login-title">Chào thầy cô trở lại</h1>
        <p>Quản lý toàn bộ quy trình xếp lịch của nhà trường trong một không gian rõ ràng và an toàn.</p>
        <div className="login-account-card"><span>✓</span><div><strong>Tài khoản bảo mật</strong><small>Dữ liệu được lưu riêng theo tài khoản ChatGPT</small></div></div>
        <div className="login-actions">
          <a className="login-button" href={chatGPTSignInPath("/")}><span>Đăng nhập</span><small>Dành cho tài khoản đã có</small></a>
          <a className="register-button" href="/register"><span>Đăng ký tài khoản</span><small>Dùng thử đầy đủ 30 ngày</small></a>
        </div>
        <div className="login-links"><a href="/activate">Đã có mã? Kích hoạt bản quyền</a></div>
        <small className="login-note">Không cần tạo thêm mật khẩu cho EduTKB</small>
      </section>
    </main>;
  }
  const [account] = await getDb().select().from(userAccounts).where(eq(userAccounts.email, user.email)).limit(1);
  if (!account) redirect("/register");
  if (account.role === "admin") {
    account.role = "super_admin";
    await getDb().update(userAccounts).set({ role: "super_admin", updatedAt: new Date().toISOString() }).where(eq(userAccounts.email, user.email));
  }
  if (!isAdminRole(account.role) && new Date(account.expiresAt) <= new Date()) redirect("/activate");
  return <TkbConsole user={{ name: user.displayName, email: user.email }} account={{ role: account.role, licenseStatus: account.licenseStatus, expiresAt: account.expiresAt }} />;
}
