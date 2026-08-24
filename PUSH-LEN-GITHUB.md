# Hướng dẫn đưa lên GitHub

Máy này chưa cài Git. Hai lựa chọn:

## Cách A — cài Git rồi push từ máy này

1. Tải Git for Windows: https://git-scm.com/download/win (Next hết, mặc định ổn)
2. Mở terminal MỚI tại thư mục này (`app/`) rồi chạy:

```powershell
git init -b main
git add .
git commit -m "feat: khung monorepo TKB SaaS — cost-core + solver-core + import-core (26 golden tests), API auth/grid/move/swap, web grid den giao thong, worker BullMQ, seed script; docs design day du + phan tich review/gaps/session-log"

# Tạo repo trên GitHub (một trong hai):
#   a) qua web: github.com/new -> tạo repo RỖNG (không README/.gitignore) -> copy URL
#   b) qua GitHub CLI nếu đã `gh auth login`:
#      gh repo create tkb-saas --private --source=. --remote=origin --push
git remote add origin https://github.com/<tai-khoan>/tkb-saas.git
git push -u origin main
```

3. Sau push: bật branch protection cho `main`, kiểm tra tab Actions chạy CI.

## Cách B — nén mang đi

```
Compress-Archive -Path * -DestinationPath ..\tkb-saas.zip -Force
```
(node_modules/dist đã bị .gitignore loại — zip dùng để lưu trữ, không phải clone)

## Lưu ý trước khi public

- [ ] Đổi `JWT_SECRET` trong mọi môi trường thật; `.env` KHÔNG được commit (đã ignore)
- [ ] Chọn LICENSE và thêm file LICENSE.md (hiện chưa có)
- [ ] Quyết định public/private — docs thiết kế chi tiết sản phẩm thương mại
      nên cân nhắc **private** hoặc tách docs sang repo riêng
