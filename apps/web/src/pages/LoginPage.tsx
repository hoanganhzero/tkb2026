import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/** Trang đăng nhập — gọi POST /v1/auth/login, lưu token vào localStorage. */
export default function LoginPage() {
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Đăng nhập thất bại.');
      localStorage.setItem('tkb.access', body.accessToken);
      localStorage.setItem('tkb.refresh', body.refreshToken);
      const school = body.memberships?.[0]?.school_id;
      nav(school ? `/app/${school}/xep-tkb/demo` : '/app/demo/xep-tkb/demo');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Lỗi mạng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-solid bg-surface p-7 shadow-sm">
        <h1 className="mb-1 text-xl font-extrabold">Đăng nhập</h1>
        <p className="mb-5 text-[13px] text-ink-2">TKB — xếp thời khoá biểu cho trường phổ thông.</p>
        <label className="mb-1 block text-xs font-semibold" htmlFor="id">Email hoặc số điện thoại</label>
        <input id="id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required
               className="mb-3 w-full rounded-md border border-solid px-3 py-2 text-sm outline-none focus:border-brand-600"
               placeholder="ban-giam-hieu@truong.edu.vn" />
        <label className="mb-1 block text-xs font-semibold" htmlFor="pw">Mật khẩu</label>
        <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
               className="mb-4 w-full rounded-md border border-solid px-3 py-2 text-sm outline-none focus:border-brand-600" />
        {err && <p className="mb-3 rounded-md bg-block-bg px-3 py-2 text-[13px] text-block-line">{err}</p>}
        <button disabled={busy}
                className="w-full rounded-md bg-brand-600 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
