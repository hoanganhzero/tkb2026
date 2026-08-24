import { Outlet, useLocation } from 'react-router-dom';

/** Khung /app/:truong — sidebar thu gọn 56px trên màn hình xếp (design spec §5). */
export default function App() {
  const { pathname } = useLocation();
  const onGrid = /xep-tkb\//.test(pathname);
  const items: Array<[string, string]> = [
    ['nam-hoc', 'Năm học'],
    ['danh-muc', 'Danh mục'],
    ['nhap-lieu', 'Nhập Excel'],
    ['phan-cong', 'Phân công'],
    ['xep-tkb/demo', 'Xếp TKB'],
    ['rang-buoc/lich-ban', 'Lịch bận'],
    ['chuyen-tiep', 'Chuyển tiếp'],
    ['kiem-tra', 'Kiểm tra']
  ];
  return (
    <div className="flex h-screen flex-col bg-app text-ink">
      <header className="flex h-[50px] flex-none items-center gap-4 bg-brand-900 px-4 text-white">
        <span className="text-[15px] font-extrabold tracking-wider">TKB</span>
        <span className="text-[13px] text-white/80">
          <b className="font-semibold text-white">THPT Nguyễn Đình Chiểu</b> · 2026–2027 · HK I
        </span>
        <span className="ml-auto text-xs text-white/60">khung phát triển</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className={`flex-none border-r border-solid bg-surface transition-all ${onGrid ? 'w-14' : 'w-52'}`}>
          {items.map(([href, label]) => (
            <a key={href} href={href.replace(/^/, '')}
               className={`block px-3 py-2.5 text-[13px] font-medium hover:bg-hover ${
                 pathname.endsWith(href.split('/').pop()!) ? 'bg-brand-100 text-brand-700' : 'text-ink-2'
               } ${onGrid ? 'text-center' : ''}`}>
              {onGrid ? label.charAt(0) : label}
            </a>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  );
}
