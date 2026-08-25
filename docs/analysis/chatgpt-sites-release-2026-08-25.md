# Đợt hoàn thiện TKB 2026 trên ChatGPT Sites

Ngày cập nhật: 25/08/2026

Website sử dụng ngay: https://tkb-2026.tranquochoanganh1986.chatgpt.site

## Phạm vi đã hoàn thiện

- Dữ liệu nhà trường được lưu riêng theo tài khoản ChatGPT: điểm trường, giáo viên, lớp, môn và phòng.
- Nhập/xuất Excel `.xlsx` gồm 6 sheet: giáo viên, lớp, môn, phòng, phân công và lịch bận.
- Xếp TKB cho buổi sáng, chiều và tối; tránh trùng lớp, giáo viên, phòng và ô giáo viên bận.
- Xem TKB theo lớp, giáo viên hoặc phòng; chỉnh tiết thủ công và ghim tiết cần giữ nguyên.
- Đèn giao thông đánh giá ô xếp; kho tiết chưa xếp có thao tác tìm ô trống.
- Lưu, mở, xóa phương án; xuất Excel nhiều sheet và lịch `.ics`.
- Báo cáo tải giảng dạy và thống kê theo lớp; giao diện đáp ứng trên máy tính và điện thoại.

## Đối chiếu gói thiết kế

Gói `TKB-SaaS-thiet-ke (1).zip` là bộ đặc tả, không phải mã nguồn chạy độc lập. Repo hiện tại đã chứa bản tài liệu thiết kế mới hơn tại `docs/design/` và phần triển khai đầy đủ hơn ở `apps/` cùng `packages/`. Vì vậy không ghi đè tài liệu mới bằng bản cũ trong ZIP.

Bản ChatGPT Sites là biến thể chạy trực tiếp, dùng đăng nhập ChatGPT và lưu trữ D1. Bản SaaS đầy đủ trong repo tiếp tục dùng NestJS, React, PostgreSQL, Redis và solver riêng; muốn vận hành công khai cần máy chủ hỗ trợ các dịch vụ đó.
