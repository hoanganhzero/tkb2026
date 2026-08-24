import { Link } from 'react-router-dom';

export default function PlaceholderPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h2 className="mb-2 text-lg font-bold">Màn hình này chưa dựng</h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          Khung hiện tại chỉ gồm: xác thực và màn hình xếp TKB (đèn giao thông + hoàn tác).
          Các màn hình còn lại dựng theo thứ tự lộ trình trong <code className="font-data">00-tong-quan.md</code>.
        </p>
        <Link to="/app/demo/xep-tkb/demo" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Mở màn hình xếp TKB
        </Link>
      </div>
    </div>
  );
}
