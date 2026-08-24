# TKB SaaS — Tổng quan dự án

---

## 1. Sản phẩm là gì

Nền tảng web xếp thời khoá biểu cho trường phổ thông Việt Nam, mô hình SaaS đa trường.
Tham chiếu thị trường: tkb.com.vn.

**Người dùng chính:** hiệu phó chuyên môn hoặc tổ trưởng, 40–55 tuổi, thành thạo Excel, dùng máy tính bàn màn 1366×768.

**Công việc cốt lõi:** biến ~500 dòng phân công giảng dạy thành một lưới 45 lớp × 30 ô không có xung đột nào, trong vòng vài giờ thay vì vài ngày.

---

## 2. Kiến trúc tổng thể

```
                    Cloudflare
                         │
        ┌────────────────┼────────────────┐
   [React SPA]      [API NestJS]    [WS Gateway]
                         │                │
              ┌──────────┼────────────────┘
              │          │
     [PostgreSQL 16]  [Redis 7 · BullMQ]
      RLS đa tenant       │
              │      ┌────┴─────┐
              │  [Solver]  [Export]
              │   worker    worker
              │      │
              │  [CP-SAT service]  (dự phòng, Python)
```

Chi tiết: `06-van-hanh/tkb_infrastructure.md`.

---

## 3. Bảy khối chức năng

| Khối | Mô tả | Tài liệu | Ước lượng |
|---|---|---|---|
| **Nền tảng** | Auth, đa tenant, RLS, phân quyền | 01, 06 | 3 tuần |
| **Danh mục** | Khối, lớp, môn, GV, phòng, khung tiết | 01, 02 | 3 tuần |
| **Nhập liệu** | Excel, dán trực tiếp, xem trước lỗi | 07 | 3,5 tuần |
| **Phân công** | Ma trận lớp × môn, ghép/tách lớp | 02, 05 | 2,5 tuần |
| **Xếp lịch** | Lưới kéo-thả, đèn giao thông, solver | 02, 04 | 8 tuần |
| **Xuất bản** | Excel, PDF, ICS, trang công khai | 08 | 3,5 tuần |
| **Vận hành** | Chuyển tiếp năm học, dạy thay, báo cáo | 09 | 3 tuần |
| **Kinh doanh** | Thanh toán, Zalo, tuân thủ | 11 | 7 tuần |

Tổng chuỗi công việc: khoảng **33 tuần-người**. Với nhóm 3–4 người làm song song: **5–6 tháng** tới bản phát hành đầu tiên.

---

## 4. Thứ tự triển khai đề xuất

```
Tháng 1   Schema · Auth · Phân quyền · CRUD danh mục
Tháng 2   Nhập Excel  ← ưu tiên cao, tạo dữ liệu thật để test mọi thứ sau
          Màn hình phân công giảng dạy
Tháng 3   Lưới kéo-thả + đèn giao thông (client-side)
          API grid + move + WebSocket
Tháng 4   Solver: Pha A → Pha B → Kempe chain
          Worker, hàng đợi, tiến độ thời gian thực
Tháng 5   Xuất Excel/PDF · Trang công khai · TKB giáo viên
          Hạ tầng, giám sát, sao lưu
Tháng 6   Thanh toán · Zalo OA · Thử nghiệm với 5 trường thật
Tháng 7   Sửa lỗi từ thử nghiệm · Chuyển tiếp năm học
Tháng 8   PHÁT HÀNH — đúng mùa xếp TKB
```

**Vì sao nhập Excel đứng thứ hai:** nó là cửa ngõ onboarding, đồng thời là cách nhanh nhất để có dữ liệu thật quy mô lớn mà kiểm thử lưới và solver. Tự gõ tay 500 dòng phân công để test là lãng phí.

**Vì sao phát hành tháng 8:** đây là mùa duy nhất trường học quan tâm tới phần mềm xếp thời khoá biểu. Trễ một tháng nghĩa là mất trọn một năm.

---

## 5. Thủ tục hành chính cần khởi động ngay

Không rút ngắn được, sẽ thành đường găng nếu để đến cuối:

| Việc | Thời gian chờ | Bắt đầu từ |
|---|---|---|
| Xác thực Zalo OA | 2–3 tuần | Tháng 1 |
| Duyệt 10 mẫu tin ZNS | 1–3 tuần | Tháng 4 |
| Hợp đồng cổng thanh toán VNPay/MoMo | 2–4 tuần | Tháng 3 |
| Nhà cung cấp hoá đơn điện tử | 2–3 tuần | Tháng 4 |
| Luật sư soạn hồ sơ Nghị định 13 | 2–4 tuần | Tháng 3 |
| Tài khoản ngân hàng doanh nghiệp + API sao kê | 2–4 tuần | Tháng 1 |

---

## 6. Ba con số cần theo dõi

**Thời gian onboarding.** Từ lúc đăng ký đến lúc xếp xong thời khoá biểu đầu tiên.
Mục tiêu: **dưới 90 phút**. Nếu vượt 3 giờ, phần lớn trường sẽ bỏ cuộc.

**Điểm phạt mềm trên 100 tiết.** Chất lượng kết quả solver.
Mục tiêu: **dưới 60**. Theo dõi theo thời gian để phát hiện hồi quy.

**Tỉ lệ quay lại năm thứ hai.** Có bao nhiêu trường dùng tính năng chuyển tiếp năm học vào tháng 8 năm sau.
Đây là chỉ số sống còn của mô hình SaaS — quan trọng hơn số lượng đăng ký mới.

---

## 7. Những gì chưa được thiết kế

Các mảng còn thiếu, xếp theo mức độ cần thiết:

1. **Quản lý danh sách học sinh** — cân nhắc kỹ, vì dữ liệu trẻ em dưới 16 tuổi làm nghĩa vụ pháp lý tăng mạnh
2. **Ứng dụng di động / PWA** cho giáo viên
3. **Sổ đầu bài điện tử** — mở rộng tự nhiên, nhưng là sản phẩm riêng
4. **Tính tiền dạy thừa giờ** — trường hỏi nhiều, tính từ dữ liệu đã có
5. **Cụm trường / cấp Phòng, Sở** — mô hình tenant lồng nhau
6. **Đồng bộ lịch bận giữa các trường** cho giáo viên dạy liên trường
7. **Hệ thống copy và trợ giúp trong ứng dụng**
8. **Bộ dữ liệu test và ca kiểm thử ràng buộc** đầy đủ

---

## 8. Nguyên tắc xuyên suốt

Rút ra từ toàn bộ quá trình thiết kế:

**Ràng buộc cứng phải được bảo vệ ở tầng thấp nhất có thể.** Trong CSDL bằng unique index, trong solver bằng định nghĩa phép biến đổi. Không bao giờ chỉ dựa vào kiểm tra ở tầng ứng dụng.

**Phản hồi trước hành động, không phải sau.** Đèn giao thông cho biết kết quả trong lúc kéo. Nhập Excel báo lỗi trước khi ghi. Kiểm tra khả thi trước khi chạy solver 60 giây.

**Thông báo lỗi phải nêu nguyên nhân cụ thể và đề xuất cách sửa.** *"Thầy Hùng đang dạy 11A2 tiết này"* kèm nút "Đổi chỗ", không phải *"Xung đột lịch"*.

**Người dùng đến từ Excel — đừng chống lại thói quen của họ.** Kéo góc ô để sao chép xuống. Xuất ra sửa hàng loạt rồi nhập lại. Ma trận lớp × môn.

**Đặc thù Việt Nam là yêu cầu bậc nhất, không phải bản địa hoá.** Chu kỳ năm học, chuyển khoản kho bạc, hoá đơn VAT, Zalo, thể thức văn bản hành chính, đứt cáp quang biển.

**Mọi thứ phải hoàn tác được.** Ctrl+Z cho lưới, snapshot cho solver, xoá năm học cho chuyển tiếp. Người dùng dám thử khi biết mình sửa được sai lầm.
