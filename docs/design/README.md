# TKB SaaS — Bộ tài liệu thiết kế

Hệ thống web xếp thời khoá biểu đa trường (SaaS) cho trường phổ thông Việt Nam.
Stack: Node.js + React + PostgreSQL.

---

## Cách dùng bộ tài liệu

Đọc theo thứ tự dưới đây nếu bạn mới bắt đầu. Mỗi tài liệu độc lập nhưng có tham chiếu chéo.

| # | File | Nội dung | Đọc khi |
|---|---|---|---|
| 00 | `00-tong-quan.md` | Bản đồ toàn bộ + lộ trình + rủi ro | Đầu tiên |
| 01 | `01-schema/tkb_schema.sql` | 30 bảng PostgreSQL + RLS + trigger | Trước khi viết dòng code đầu tiên |
| 02 | `02-giao-dien/tkb_design_spec.md` | Design tokens, layout, wireframe 12 màn hình | Khi dựng Figma hoặc code UI |
| 03 | `02-giao-dien/tkb_prototype.html` | **Prototype chạy được** — mở bằng trình duyệt | Ngay bây giờ, để cảm nhận sản phẩm |
| 03b | `02-giao-dien/tkb_landing.html` | **Trang giới thiệu công khai** — hero tự xếp bằng thuật toán thật (thu nhỏ) | Khi cần gửi cho thầy hiệu trưởng / người quyết định |
| 03c | `02-giao-dien/tkb_cong_khai.html` | **Trang xem TKB công khai** (demo `/tkb/:slug`) — lưới + danh sách ngày trên điện thoại, in PDF, tải `.ics` thật | Sau landing |
| 03d | `02-giao-dien/tkb_auth.html` | Đăng nhập / Đăng ký trường mới — bản trình diễn, nối với CTA của landing | Hoàn thiện bộ web tĩnh |
| 04 | `03-solver/tkb_solver_design.md` | Thuật toán xếp lịch, bitmask, SA, Kempe chain | Trước khi code solver |
| 05 | `04-api/tkb_api_spec.md` | REST + WebSocket + khoá mềm đồng thời | Trước khi FE/BE chạy song song |
| 06 | `04-api/tkb_permissions.md` | 5 vai trò × 68 hành động + phạm vi theo dòng | Cùng lúc với API |
| 07 | `05-du-lieu/tkb_excel_import.md` | Nhập Excel — cửa ngõ onboarding | Ưu tiên cao, làm sớm |
| 08 | `05-du-lieu/tkb_export_design.md` | Xuất Excel/PDF/ICS + thể thức văn bản | Sau khi lưới chạy được |
| 09 | `05-du-lieu/tkb_year_rollover_design.md` | Chuyển tiếp năm học — giữ chân khách hàng | Trước mùa hè năm thứ hai |
| 10 | `06-van-hanh/tkb_infrastructure.md` | Triển khai, giám sát, sao lưu | Trước khách hàng thật đầu tiên |
| 11 | `06-van-hanh/tkb_payment_compliance.md` | VNPay/MoMo, Zalo OA, Nghị định 13/2023 | Khởi động thủ tục ngay hôm nay |

---

## Bắt đầu nhanh

1. Mở `02-giao-dien/tkb_prototype.html` bằng Chrome hoặc Firefox
2. Kéo một thẻ từ kho bên phải vào lưới — xem "đèn giao thông" hoạt động
3. Bấm "⚡ Xếp tự động" — xem solver chạy thời gian thực
4. Đọc `00-tong-quan.md`

---

## Năm quyết định kiến trúc nền tảng

Những quyết định này chi phối mọi thứ khác. Nếu đổi, phải đọc lại toàn bộ.

**1. Ràng buộc cứng được bảo vệ ở tầng cơ sở dữ liệu, không phải trong hàm chi phí.**
Ba bảng `lessons` / `lesson_classes` / `lesson_teachers` với unique index khiến PostgreSQL tự chặn trùng giáo viên, trùng lớp, trùng phòng. Solver không thể sinh ra lịch sai kể cả khi có lỗi lập trình.

**2. Không gian tìm kiếm của solver chỉ chứa lời giải hợp lệ.**
Người dùng bấm Dừng bất cứ lúc nào và kết quả phải dùng được ngay. Cái giá phải trả là bắt buộc có Kempe chain để thoát vùng chặt.

**3. Màu là dữ liệu.**
Toàn bộ ngân sách màu dành cho mã màu môn học. Khung giao diện trung tính tuyệt đối.

**4. Khoá mềm cấp lớp, không phải CRDT.**
Hợp nhất lạc quan sai về nghiệp vụ ở đây — hai người cùng đặt tiết vào một ô của cùng giáo viên thì hợp nhất kiểu gì cũng ra lịch sai.

**5. Máy chủ đặt tại Việt Nam.**
Lý do quyết định là đứt cáp quang biển, không phải độ trễ hay chi phí.

---

## Rủi ro lớn nhất

Không nằm trong bất kỳ tài liệu nào: **bộ trọng số của hàm chi phí**.

Các giá trị trong `03-solver` mục 6.1 là ước lượng dựa trên thực tế trường phổ thông Việt Nam, nhưng chưa được kiểm chứng bằng dữ liệu thật.

Kế hoạch giảm thiểu: xin thời khoá biểu mà 3–5 trường đã xếp tay và hài lòng, chạy hàm chi phí lên đó, rồi điều chỉnh trọng số sao cho bản xếp tay đạt điểm thấp. Tức là dạy hàm chi phí biết "đẹp" theo định nghĩa của chính người dùng. **Làm việc này càng sớm càng tốt.**

---

## Ghi chú pháp lý

Phần tuân thủ Nghị định 13/2023/NĐ-CP trong tài liệu 11 mô tả cách tổ chức hệ thống kỹ thuật, **không phải tư vấn pháp lý**. Hồ sơ đánh giá tác động và các mẫu văn bản cần luật sư rà soát trước khi phát hành.
