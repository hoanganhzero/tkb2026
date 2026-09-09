import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import RegistrationForm from "./registration-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getChatGPTUser();
  if (!user) return <main className="auth-page"><section className="auth-card"><img className="auth-brand-image" src="/edutkb-mark.svg" alt="EduTKB"/><h1>Đăng ký EduTKB</h1><p>EduTKB dùng tài khoản ChatGPT để xác minh email an toàn. Sau đó thầy cô chỉ cần điền hồ sơ trường.</p><a className="login-button" href={chatGPTSignInPath("/register")}>Đăng ký bằng ChatGPT</a><a className="register-button auth-login-button" href={chatGPTSignInPath("/")}>Đã có tài khoản? Đăng nhập</a><a className="auth-back" href="/">Quay lại trang chính</a></section></main>;
  return <main className="auth-page"><RegistrationForm defaultName={user.displayName} email={user.email} /></main>;
}
