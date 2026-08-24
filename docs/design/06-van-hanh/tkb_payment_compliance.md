# TKB SaaS — Thanh toán, Zalo OA và tuân thủ pháp lý Việt Nam

> Đi kèm: `tkb_infrastructure.md`, `tkb_schema.sql`, `tkb_permissions.md`.
>
> **Lưu ý:** tài liệu này mô tả thiết kế kỹ thuật, không phải tư vấn pháp lý.
> Phần tuân thủ Nghị định 13/2023/NĐ-CP cần được luật sư rà soát trước khi
> phát hành, đặc biệt là hồ sơ đánh giá tác động và các mẫu văn bản đồng ý.

---

# PHẦN A — THANH TOÁN

## A1. Vì sao không thể sao chép mô hình Stripe

Mô hình SaaS phương Tây: người dùng nhập thẻ, tự động trừ tiền hằng tháng, huỷ lúc nào cũng được. Mô hình này **không hoạt động** với khách hàng chính của sản phẩm này.

| | Trường công lập | Trường tư thục |
|---|---|---|
| Tỉ lệ khách hàng | ~85% | ~15% |
| Người quyết định | Hiệu trưởng | Chủ trường / giám đốc |
| Người thanh toán | Kế toán trường | Kế toán |
| Nguồn tiền | Ngân sách được duyệt theo năm | Tự chủ |
| Phương thức | **Chuyển khoản kho bạc / ngân hàng** | Chuyển khoản hoặc thẻ |
| Cần hoá đơn VAT | **Bắt buộc, trước khi chi** | Bắt buộc |
| Chu kỳ | **Năm học, không phải năm dương lịch** | Năm |
| Thời gian từ quyết định đến nhận tiền | **2–6 tuần** | 2–5 ngày |
| Tự động gia hạn | **Không được phép** | Có thể |

Ba hệ quả bắt buộc phải thiết kế theo:

1. **Chu kỳ tính theo năm học (tháng 8 → tháng 7)**, không phải theo ngày đăng ký.
2. **Phải có luồng "đặt hàng trước, trả tiền sau"** với hoá đơn xuất trước khi nhận tiền.
3. **Không bao giờ tự động gia hạn và trừ tiền.** Trường công không có cơ chế uỷ quyền trừ tiền định kỳ, và làm vậy sẽ tạo rắc rối kế toán cho họ.

---

## A2. Ba luồng thanh toán

### Luồng 1 — Chuyển khoản có hoá đơn (mặc định cho trường công)

```
Trường bấm "Đăng ký gói Pro"
   ↓
Nhập thông tin xuất hoá đơn
   • Tên đơn vị, mã số thuế, địa chỉ
   • Email nhận hoá đơn điện tử
   ↓
Hệ thống sinh Đơn đặt hàng + Báo giá (PDF, có chữ ký số)
   ↓  Trường in ra, trình hiệu trưởng duyệt          [1–3 tuần]
   ↓
Kế toán chuyển khoản, ghi nội dung: "TKB DH2026081234"
   ↓  Đối soát tự động qua API ngân hàng             [1–2 ngày]
   ↓
Hệ thống ghi nhận, phát hành hoá đơn điện tử (Nghị định 123/2020)
   ↓
Kích hoạt gói + gửi email/Zalo xác nhận
```

**Trong lúc chờ (2–6 tuần), tài khoản vẫn dùng đầy đủ tính năng.** Đây là quyết định quan trọng: chặn họ trong lúc chờ thủ tục hành chính là cách chắc chắn nhất khiến trường bỏ cuộc. Hiển thị thanh nhắc nhẹ:

```
┌────────────────────────────────────────────────────────┐
│ 📄 Đơn hàng DH2026081234 đang chờ thanh toán           │
│    Bạn vẫn dùng đầy đủ tính năng đến 30/09/2026.       │
│    [Xem hướng dẫn chuyển khoản]  [Tải lại báo giá]     │
└────────────────────────────────────────────────────────┘
```

Hạn ân hạn 60 ngày. Sau đó chuyển sang chế độ chỉ đọc — **không xoá dữ liệu**, giữ tối thiểu 12 tháng.

### Luồng 2 — VNPay / MoMo (trường tư, cá nhân, gia hạn nhanh)

Thanh toán tức thì, kích hoạt trong vài giây. Dùng khi số tiền nhỏ hoặc người trả là cá nhân.

### Luồng 3 — Mã QR VietQR

Hiển thị mã QR ngay trên màn hình. Người dùng quét bằng app ngân hàng, nội dung chuyển khoản điền sẵn. Đối soát tự động khi tiền về.

Đây là phương thức **phổ biến nhất ở Việt Nam hiện nay** và có chi phí thấp nhất — không mất phí cổng thanh toán. Nên đặt làm lựa chọn đầu tiên hiển thị.

---

## A3. Cơ sở dữ liệu bổ sung

```sql
CREATE TYPE order_status  AS ENUM ('draft','pending','paid','cancelled','expired','refunded');
CREATE TYPE pay_method    AS ENUM ('bank_transfer','vietqr','vnpay','momo','zalopay','manual');
CREATE TYPE invoice_state AS ENUM ('pending','issued','replaced','cancelled');

-- Thông tin xuất hoá đơn của trường
CREATE TABLE billing_profiles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
    legal_name    text NOT NULL,              -- 'Trường THPT Nguyễn Đình Chiểu'
    tax_code      text,                       -- MST, trường công thường có
    address       text NOT NULL,
    contact_name  text,
    contact_phone text,
    invoice_email citext NOT NULL,
    budget_code   text,                       -- mã dự toán, một số trường cần
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Đơn đặt hàng
CREATE TABLE orders (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    code          text UNIQUE NOT NULL,        -- 'DH2026081234' — nội dung chuyển khoản
    plan_id       uuid NOT NULL REFERENCES plans(id),
    period_start  date NOT NULL,               -- 2026-08-01
    period_end    date NOT NULL,               -- 2027-07-31
    subtotal      numeric(12,0) NOT NULL,
    vat_rate      numeric(4,2)  NOT NULL DEFAULT 0.10,
    vat_amount    numeric(12,0) NOT NULL,
    total         numeric(12,0) NOT NULL,
    status        order_status  NOT NULL DEFAULT 'draft',
    method        pay_method,
    quote_url     text,                        -- PDF báo giá
    expires_at    timestamptz,
    paid_at       timestamptz,
    created_by    uuid REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (school_id, status);
CREATE INDEX ON orders (code);

-- Giao dịch nhận được — có thể nhiều giao dịch cho một đơn
CREATE TABLE payments (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,
    school_id      uuid REFERENCES schools(id) ON DELETE SET NULL,
    method         pay_method NOT NULL,
    amount         numeric(12,0) NOT NULL,
    gateway_txn_id text,
    bank_ref       text,                       -- mã giao dịch ngân hàng
    raw_payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
    matched_by     text,                       -- 'auto_code' | 'auto_amount' | 'manual'
    matched_by_user uuid REFERENCES users(id),
    received_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (method, gateway_txn_id)
);

-- Hoá đơn điện tử theo Nghị định 123/2020/NĐ-CP
CREATE TABLE einvoices (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    provider       text NOT NULL,              -- viettel_sinvoice | misa_meinvoice | vnpt
    invoice_series text,                       -- ký hiệu, VD 'C26TAA'
    invoice_no     text,                       -- số hoá đơn
    tax_auth_code  text,                       -- mã CQT cấp
    state          invoice_state NOT NULL DEFAULT 'pending',
    pdf_url        text,
    xml_url        text,
    issued_at      timestamptz,
    raw_response   jsonb,
    UNIQUE (provider, invoice_series, invoice_no)
);
```

---

## A4. Đối soát chuyển khoản tự động

Đây là phần tạo khác biệt lớn nhất về vận hành. Đối soát tay 300 giao dịch trong tháng 8 là công việc toàn thời gian.

### A4.1 Nguyên tắc

Mỗi đơn hàng có mã duy nhất `DH2026081234`, người chuyển khoản ghi vào nội dung. Hệ thống lấy sao kê định kỳ và khớp tự động.

### A4.2 Nguồn dữ liệu sao kê

| Cách | Ưu | Nhược |
|---|---|---|
| **API ngân hàng doanh nghiệp** (VietinBank, MB, ACB, Techcombank) | Chính thức, đáng tin | Cần hợp đồng, thủ tục 2–4 tuần |
| **Dịch vụ trung gian** (Casso, SePay) | Tích hợp trong một ngày, webhook sẵn | Phí hằng tháng, phụ thuộc bên thứ ba |
| **Đọc email biến động số dư** | Miễn phí | Không đáng tin, ngân hàng đổi mẫu email là hỏng |

Khuyến nghị: **bắt đầu bằng dịch vụ trung gian**, chuyển sang API trực tiếp khi doanh thu đủ lớn. Cách thứ ba chỉ dùng làm lưới an toàn dự phòng.

### A4.3 Thuật toán khớp

```ts
async function reconcile(txn: BankTransaction) {
  const normalized = txn.description
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');       // bỏ dấu cách, gạch — người dùng gõ đủ kiểu

  // 1. Khớp chính xác mã đơn hàng
  const code = normalized.match(/DH\d{10}/)?.[0];
  if (code) {
    const order = await findOrderByCode(code);
    if (order && order.status === 'pending') {
      if (Math.abs(txn.amount - order.total) < 1000) {
        return settle(order, txn, 'auto_code');
      }
      // Đúng mã, sai tiền → cần người xem
      return flagForReview(order, txn, 'AMOUNT_MISMATCH');
    }
  }

  // 2. Không có mã: khớp theo số tiền + tên đơn vị chuyển
  const candidates = await findPendingOrdersByAmount(txn.amount, 1000);
  if (candidates.length === 1 && nameSimilar(txn.senderName, candidates[0].legalName)) {
    return settle(candidates[0], txn, 'auto_amount');
  }

  // 3. Đưa vào hàng chờ xử lý tay
  return queueForManualMatch(txn);
}
```

**Bước 2 quan trọng hơn ta tưởng.** Kế toán trường thường ghi nội dung kiểu *"THANH TOAN PHAN MEM THOI KHOA BIEU"* mà quên mã đơn. Khớp theo số tiền cộng tên đơn vị bắt được phần lớn trường hợp này.

Kinh nghiệm thực tế: khoảng **70% khớp tự động bằng mã**, **20% bằng số tiền + tên**, **10% cần xử lý tay**.

### A4.4 Màn hình đối soát tay

```
┌─ Giao dịch chưa khớp (7) ────────────────────────────────────────┐
│ 22/08 09:14 · +2.200.000đ · TRUONG THPT LE QUY DON              │
│ Nội dung: "TT PHAN MEM XEP TKB NAM HOC 2026 2027"               │
│                                                                  │
│ Gợi ý:  ● DH2026081234 · THPT Lê Quý Đôn · 2.200.000đ  ★ 94%    │
│         ○ DH2026081198 · THPT Lê Hồng Phong · 2.200.000đ   61%   │
│         ○ Không khớp đơn nào — ghi nhận thu khác                │
│                                    [Xác nhận khớp]  [Bỏ qua]    │
└──────────────────────────────────────────────────────────────────┘
```

Điểm số dựa trên: khoảng cách chuỗi giữa tên người chuyển và tên đơn vị, chênh lệch số tiền, khoảng cách thời gian so với lúc tạo đơn.

### A4.5 Chống trùng

`UNIQUE (method, gateway_txn_id)` chặn ghi nhận hai lần cùng một giao dịch. Webhook từ cổng thanh toán hay gửi lặp — đây là lưới an toàn ở tầng cơ sở dữ liệu, không dựa vào logic ứng dụng.

---

## A5. Tích hợp VNPay và MoMo

### A5.1 Điểm chung

Cả hai theo mô hình chuyển hướng + webhook:

```
POST /billing/orders/:id/pay { method: 'vnpay' }
  → { payUrl: 'https://sandbox.vnpayment.vn/...' }
Trình duyệt chuyển hướng
  → Người dùng thanh toán
  → Chuyển về /billing/return?...  (chỉ để hiển thị, KHÔNG tin)
  → Webhook về /webhooks/vnpay      (nguồn sự thật duy nhất)
```

**Nguyên tắc tuyệt đối: chỉ tin webhook.** Đường dẫn quay về (`return_url`) do trình duyệt gọi, người dùng sửa được. Đã có không ít hệ thống ở Việt Nam bị khai thác vì kích hoạt gói dựa trên tham số trên URL quay về.

### A5.2 Xác thực chữ ký

VNPay dùng HMAC-SHA512 trên các tham số đã sắp xếp:

```ts
function verifyVnpay(params: Record<string,string>, secret: string): boolean {
  const received = params.vnp_SecureHash;
  const { vnp_SecureHash, vnp_SecureHashType, ...rest } = params;
  const raw = Object.keys(rest).sort()
    .map(k => `${k}=${encodeURIComponent(rest[k]).replace(/%20/g, '+')}`)
    .join('&');
  const expected = crypto.createHmac('sha512', secret).update(raw, 'utf-8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received.toLowerCase()));
}
```

Ba chi tiết dễ sai: **sắp xếp khoá theo bảng chữ cái**, **mã hoá URL với dấu cách thành `+`**, và **so sánh bằng `timingSafeEqual`** chứ không phải `===`.

MoMo dùng HMAC-SHA256 với thứ tự trường cố định do tài liệu quy định — không sắp xếp.

### A5.3 Xử lý webhook

```ts
@Post('webhooks/vnpay')
async handle(@Body() body, @Req() req) {
  await logRawWebhook('vnpay', body, req.ip);          // luôn ghi trước

  if (!verifyVnpay(body, config.vnpaySecret))
    return { RspCode: '97', Message: 'Invalid signature' };

  const order = await findOrderByCode(body.vnp_TxnRef);
  if (!order)          return { RspCode: '01', Message: 'Order not found' };
  if (order.total !== Number(body.vnp_Amount) / 100)
    return { RspCode: '04', Message: 'Invalid amount' };
  if (order.status === 'paid')
    return { RspCode: '02', Message: 'Order already confirmed' };   // idempotent

  if (body.vnp_ResponseCode === '00') await settle(order, body, 'vnpay');
  return { RspCode: '00', Message: 'Confirm Success' };
}
```

Ghi log thô **trước** khi xác thực. Khi có tranh chấp với cổng thanh toán, bản ghi này là bằng chứng duy nhất.

Cổng thanh toán gửi lại webhook nhiều lần nếu không nhận được `RspCode: '00'`. Xử lý phải **idempotent** — gọi 5 lần chỉ kích hoạt gói một lần.

---

## A6. Hoá đơn điện tử

Bắt buộc theo **Nghị định 123/2020/NĐ-CP** và **Thông tư 78/2021/TT-BTC**. Không tự phát hành được — phải qua nhà cung cấp được Tổng cục Thuế chấp thuận.

| Nhà cung cấp | Ghi chú |
|---|---|
| Viettel S-Invoice | API tốt, tài liệu đầy đủ |
| MISA meInvoice | Phổ biến với kế toán trường học |
| VNPT Invoice | Phủ rộng ở tỉnh |

Thiết kế tầng trừu tượng để đổi nhà cung cấp mà không sửa nghiệp vụ:

```ts
interface EInvoiceProvider {
  issue(order: Order, profile: BillingProfile): Promise<IssuedInvoice>;
  cancel(invoiceId: string, reason: string): Promise<void>;
  replace(invoiceId: string, newData: InvoiceData): Promise<IssuedInvoice>;
  download(invoiceId: string, format: 'pdf' | 'xml'): Promise<Buffer>;
}
```

**Thứ tự bắt buộc:** nhận tiền → phát hành hoá đơn → gửi email. Không phát hành trước khi có tiền, vì huỷ hoá đơn đã phát hành cần thủ tục và biên bản với bên mua.

Cả PDF lẫn XML đều phải lưu và cho tải về — kế toán trường cần file XML để nạp vào phần mềm kế toán.

---

## A7. Định giá

Đề xuất theo số lớp, vì đó là thước đo quy mô mà trường tự nhận biết:

| Gói | Giới hạn | Giá/năm học | Đối tượng |
|---|---|---|---|
| Miễn phí | 10 lớp, 1 năm học | 0 | Trường nhỏ, dùng thử |
| Cơ bản | 30 lớp | 1.500.000 đ | THCS vừa |
| Chuyên nghiệp | Không giới hạn | 2.500.000 đ | THPT, trường lớn |
| Cụm trường | Nhiều trường | Thoả thuận | Phòng/Sở GD&ĐT |

Giá đã gồm VAT — kế toán trường học quen nghĩ bằng số tiền cuối cùng phải chi.

**Chu kỳ theo năm học**, hiển thị rõ *"Sử dụng từ 01/08/2026 đến 31/07/2027"*. Đăng ký giữa năm tính theo tỉ lệ tháng còn lại, làm tròn lên.

---

# PHẦN B — THÔNG BÁO QUA ZALO OA

## B1. Vì sao Zalo, không phải email

Ở trường phổ thông Việt Nam, giáo viên kiểm tra Zalo hàng chục lần mỗi ngày và email vài lần mỗi tuần — nhiều người dùng email do trường cấp mà không bao giờ mở. Mọi tổ bộ môn đều có nhóm Zalo.

Số liệu thực tế của các sản phẩm cùng phân khúc: tỉ lệ mở tin nhắn Zalo OA khoảng **80–90%**, email khoảng **15–25%**.

## B2. Loại tài khoản và giới hạn

Cần **Zalo Official Account đã xác thực** (có dấu tích xanh). Điều kiện: giấy phép kinh doanh, chi phí xác thực hằng năm.

Hai loại tin nhắn, khác nhau hoàn toàn về quy tắc:

| Loại | Điều kiện | Chi phí | Dùng cho |
|---|---|---|---|
| **Tin tư vấn** | Trong 48 giờ kể từ khi người dùng nhắn tới OA | Miễn phí, có hạn mức | Trả lời hỗ trợ |
| **ZNS** (Zalo Notification Service) | Bất kỳ lúc nào, dùng mẫu đã được duyệt | Tính phí mỗi tin | Thông báo hệ thống |

Toàn bộ thông báo chủ động phải qua **ZNS**. Mẫu tin phải gửi Zalo duyệt trước, mất 1–3 ngày làm việc mỗi mẫu. Lên kế hoạch sớm.

## B3. Danh mục mẫu tin

| Mã mẫu | Sự kiện | Người nhận | Ưu tiên |
|---|---|---|---|
| `TKB_PUBLISHED` | Công bố thời khoá biểu mới | Toàn bộ GV | Cao |
| `TKB_CHANGED` | Thời khoá biểu của cá nhân thay đổi | GV liên quan | Cao |
| `SUBSTITUTE_ASSIGNED` | Được phân công dạy thay | GV dạy thay | **Rất cao** |
| `LESSON_CANCELLED` | Tiết bị huỷ | GV + GVCN | Cao |
| `ROLLOVER_REMINDER` | Nhắc chuẩn bị năm học mới | Owner, admin | Trung bình |
| `ORDER_CREATED` | Đơn hàng đã tạo, hướng dẫn chuyển khoản | Owner | Cao |
| `PAYMENT_RECEIVED` | Đã nhận thanh toán, hoá đơn đính kèm | Owner | Cao |
| `SUBSCRIPTION_EXPIRING` | Gói sắp hết hạn (trước 30, 14, 7 ngày) | Owner | Trung bình |
| `SOLVER_FINISHED` | Xếp tự động xong (job chạy lâu) | Người khởi tạo | Thấp |
| `SYSTEM_ALERT` | Cảnh báo hạ tầng | Đội vận hành | Rất cao |

### Ví dụ nội dung mẫu `SUBSTITUTE_ASSIGNED`

```
Phân công dạy thay

Kính gửi <customer_name>,
Bạn được phân công dạy thay tiết học sau:

Ngày:      <date>
Tiết:      <period>
Lớp:       <class_name>
Môn:       <subject>
Phòng:     <room>
Thay cho:  <original_teacher>

Xem chi tiết: <url>
```

Zalo có giới hạn ký tự và số tham số cho mỗi mẫu. Giữ ngắn gọn, đưa chi tiết vào liên kết.

## B4. Liên kết tài khoản

```
Giáo viên đăng nhập → trang Cá nhân → "Nhận thông báo qua Zalo"
   ↓
Hiện mã QR chứa: https://zalo.me/<oa_id>?state=<signed_token>
   ↓
Quét, quan tâm OA
   ↓
Webhook follow → giải mã state → lưu zalo_user_id vào users
   ↓
Gửi tin xác nhận đầu tiên
```

```sql
ALTER TABLE users ADD COLUMN zalo_user_id text UNIQUE;
ALTER TABLE users ADD COLUMN zalo_linked_at timestamptz;
ALTER TABLE users ADD COLUMN notify_channels jsonb
  NOT NULL DEFAULT '{"zalo":true,"email":true,"push":false}'::jsonb;
```

`state` là token ký, sống 10 phút — chống việc người khác quét mã của mình rồi chiếm liên kết.

## B5. Nguyên tắc gửi

**Gộp tin, không gửi rời rạc.** Khi solver chạy xong và 60 giáo viên có lịch thay đổi, đừng gửi 60 tin trong một giây. Gom theo cửa sổ 15 phút và gửi mỗi người **một tin duy nhất**: *"Thời khoá biểu của bạn có 4 thay đổi."*

**Tôn trọng giờ nghỉ.** Không gửi ZNS trong khoảng 21:00–06:00. Hàng đợi giữ lại tới 6h sáng, trừ mã `SYSTEM_ALERT` gửi cho đội vận hành.

**Luôn có đường lui.** Nếu ZNS thất bại (chưa liên kết, hết hạn mức, mẫu bị từ chối) thì tự động chuyển sang email. Ghi lại kênh đã dùng vào `notification_logs`.

**Tính chi phí trước khi gửi.** ZNS tính phí mỗi tin. Với 200 trường × 90 giáo viên × 4 lần công bố mỗi năm = 72.000 tin. Đặt hạn mức theo trường và cảnh báo khi vượt.

---

# PHẦN C — TUÂN THỦ NGHỊ ĐỊNH 13/2023/NĐ-CP

> **Đây là phần cần luật sư rà soát.** Nội dung dưới đây mô tả cách tổ chức
> hệ thống kỹ thuật để đáp ứng nghĩa vụ, không thay thế tư vấn pháp lý.

## C1. Vì sao sản phẩm này thuộc phạm vi điều chỉnh

Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân, có hiệu lực từ 01/7/2023, áp dụng cho mọi tổ chức xử lý dữ liệu cá nhân của công dân Việt Nam.

Hệ thống này lưu:

| Dữ liệu | Chủ thể | Phân loại |
|---|---|---|
| Họ tên, số điện thoại, email | Giáo viên | Dữ liệu cá nhân **cơ bản** |
| Giới tính, nơi công tác | Giáo viên | Cơ bản |
| Lịch dạy, lịch bận cá nhân | Giáo viên | Cơ bản |
| Họ tên, lớp | Học sinh (nếu có tính năng danh sách HS) | Cơ bản, **của trẻ em** |

Không lưu dữ liệu nhạy cảm theo định nghĩa của Nghị định (sức khoẻ, tôn giáo, dữ liệu sinh trắc học...) — điều này giúp giảm đáng kể nghĩa vụ.

**Nếu sản phẩm mở rộng sang quản lý danh sách học sinh, nghĩa vụ tăng mạnh** vì dữ liệu trẻ em dưới 16 tuổi cần sự đồng ý của cha mẹ hoặc người giám hộ. Cân nhắc kỹ trước khi thêm tính năng đó.

## C2. Vai trò của các bên

Phân định vai trò quyết định ai chịu trách nhiệm gì:

| Bên | Vai trò | Nghĩa vụ chính |
|---|---|---|
| **Trường học** | Bên Kiểm soát dữ liệu | Thu thập sự đồng ý của giáo viên, xác định mục đích xử lý |
| **Công ty (bạn)** | Bên Xử lý dữ liệu | Xử lý theo chỉ dẫn của trường, bảo mật, hỗ trợ trường thực hiện quyền của chủ thể |

Vai trò này phải ghi rõ trong **Hợp đồng dịch vụ / Điều khoản sử dụng**, kèm phụ lục Thoả thuận xử lý dữ liệu (DPA). Không có văn bản này, trách nhiệm sẽ mơ hồ khi có sự cố.

## C3. Nghĩa vụ và cách đáp ứng bằng kỹ thuật

### C3.1 Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân

Nghị định yêu cầu lập hồ sơ và gửi Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05, Bộ Công an) trong 60 ngày kể từ khi bắt đầu xử lý.

Cần chuẩn bị: mục đích xử lý, loại dữ liệu, thời gian lưu, biện pháp bảo vệ, đánh giá rủi ro. **Việc luật sư cần làm, không phải kỹ sư** — nhưng kỹ sư phải cung cấp sơ đồ luồng dữ liệu chính xác.

### C3.2 Cơ sở pháp lý cho việc xử lý

Với giáo viên, cơ sở hợp lý nhất là **thực hiện nhiệm vụ theo hợp đồng lao động và quy chế nhà trường**, không phải "sự đồng ý". Lý do: xin đồng ý từ nhân viên trong quan hệ lao động là cơ sở yếu, vì họ khó từ chối một cách tự do.

Hệ quả kỹ thuật: **không cần cửa sổ xin đồng ý cho từng giáo viên** khi đăng nhập. Nhưng cần **thông báo minh bạch** — trang "Dữ liệu của bạn" luôn truy cập được từ trang cá nhân.

### C3.3 Quyền của chủ thể dữ liệu và endpoint tương ứng

| Quyền | Endpoint | Thời hạn đáp ứng |
|---|---|---|
| Được biết | `GET /me/privacy` — trang tĩnh mô tả dữ liệu nào được lưu, dùng làm gì | Luôn có |
| Truy cập | `GET /me/data` — xem toàn bộ dữ liệu về mình | Tức thì |
| Sao chép dữ liệu | `POST /me/data-export` — sinh file JSON + PDF | 72 giờ |
| Chỉnh sửa | `PATCH /me/profile` | Tức thì |
| Xoá | `POST /me/deletion-request` | 72 giờ, xem C3.4 |
| Hạn chế xử lý | `PATCH /me/notify-channels` — tắt kênh thông báo | Tức thì |
| Phản đối | `POST /me/objection` — gửi tới trường và công ty | Ghi nhận |
| Khiếu nại | Thông tin liên hệ DPO trên trang riêng tư | Luôn có |

### C3.4 Xoá dữ liệu — điểm phức tạp nhất

Giáo viên yêu cầu xoá dữ liệu, nhưng thời khoá biểu là tài liệu của trường và có giá trị lưu trữ hành chính. Không thể xoá vô điều kiện.

Cách xử lý — **ẩn danh hoá thay vì xoá**:

```sql
-- Khi yêu cầu xoá được duyệt
UPDATE teachers SET
    full_name  = 'Giáo viên đã ẩn danh #' || substr(id::text, 1, 6),
    short_name = 'GV#' || substr(id::text, 1, 6),
    email = NULL, phone = NULL, user_id = NULL,
    anonymized_at = now()
WHERE id = :teacher_id;

UPDATE users SET
    email = 'deleted-' || id || '@invalid',
    phone = NULL, full_name = 'Tài khoản đã xoá',
    password_hash = NULL, zalo_user_id = NULL,
    status = 'disabled', deleted_at = now()
WHERE id = :user_id;
```

Cấu trúc thời khoá biểu được giữ (trường vẫn cần hồ sơ), nhưng mọi dữ liệu định danh cá nhân bị loại bỏ không hồi phục được.

**Quy trình:** yêu cầu xoá gửi tới cả công ty và `owner` của trường. Trường có 7 ngày để phản đối nếu có nghĩa vụ lưu trữ theo quy định ngành. Không phản đối thì tự động thực hiện.

### C3.5 Thời gian lưu trữ

| Dữ liệu | Thời gian | Căn cứ |
|---|---|---|
| Tài khoản đang hoạt động | Suốt thời gian sử dụng dịch vụ | |
| Sau khi trường ngừng dịch vụ | 12 tháng, rồi ẩn danh hoá | Cho phép quay lại |
| Nhật ký truy cập (`audit_logs`) | 24 tháng | Điều tra sự cố |
| Hoá đơn, chứng từ kế toán | **10 năm** | Luật Kế toán 2015 |
| Bản sao lưu | 30 ngày (ảnh chụp), 12 tháng (theo trường) | |
| File Excel người dùng tải lên | 90 ngày | Chỉ để hỗ trợ |

Chạy công việc dọn dẹp hằng đêm, ghi log kết quả.

### C3.6 Biện pháp kỹ thuật bắt buộc

| Nghĩa vụ | Đã có trong thiết kế |
|---|---|
| Kiểm soát truy cập theo vai trò | `tkb_permissions.md` — 5 vai trò, 68 hành động |
| Cách ly dữ liệu giữa các trường | RLS với `current_school_id()` |
| Che dữ liệu cá nhân khi không cần | `v_teachers_public` — GV không thấy SĐT đồng nghiệp |
| Mã hoá khi truyền | TLS 1.3 bắt buộc |
| Mã hoá khi lưu | Mã hoá toàn ổ đĩa + sao lưu mã hoá |
| Ghi nhật ký truy cập | `audit_logs` phân vùng theo tháng |
| Sao lưu và khôi phục | `tkb_infrastructure.md` mục 5 |
| Thông báo vi phạm | Quy trình C4 |

### C3.7 Chuyển dữ liệu ra nước ngoài

Nghị định yêu cầu lập hồ sơ khi chuyển dữ liệu cá nhân của công dân Việt Nam ra nước ngoài.

**Cách tránh: không chuyển.** Đây là lý do bổ sung cho quyết định đặt máy chủ tại Việt Nam ở `tkb_infrastructure.md` mục 2.2.

Các dịch vụ bên thứ ba cần rà soát:

| Dịch vụ | Có gửi dữ liệu cá nhân ra ngoài? | Xử lý |
|---|---|---|
| Cloudflare | Chỉ metadata mạng, không có nội dung | Chấp nhận được |
| Sentry | **Có** — stack trace chứa email, tên | Tự lưu trữ trong nước |
| Google Analytics | **Có** | Thay bằng Plausible/Umami tự lưu trữ |
| Email (SendGrid, Mailgun) | **Có** — địa chỉ email | Dùng nhà cung cấp trong nước, hoặc lập hồ sơ |
| Zalo OA | Trong nước | Không vấn đề |
| Object storage | Chọn nhà cung cấp VN | Không vấn đề |

Riêng Sentry, nếu tự lưu trữ thì phải cấu hình `beforeSend` để loại bỏ dữ liệu cá nhân khỏi báo cáo lỗi bất kể đặt ở đâu.

## C4. Quy trình xử lý vi phạm dữ liệu

Nghị định yêu cầu thông báo cho cơ quan chức năng trong **72 giờ** kể từ khi phát hiện.

```
Phát hiện (giám sát, báo cáo, kiểm toán)
  ↓  giờ 0
Cô lập: thu hồi token, khoá tài khoản nghi vấn, chặn IP
  ↓  trong 2 giờ
Đánh giá: dữ liệu nào, bao nhiêu người, đã bị lấy hay chỉ bị truy cập
  ↓  trong 24 giờ
Thông báo Bộ Công an (A05) theo mẫu quy định
  ↓  trong 72 giờ
Thông báo các trường bị ảnh hưởng
  ↓
Thông báo chủ thể dữ liệu (qua trường)
  ↓
Báo cáo sau sự cố, biện pháp khắc phục
```

Chuẩn bị **trước khi cần**: mẫu thông báo viết sẵn, danh sách liên hệ, kịch bản kỹ thuật thu hồi toàn bộ phiên đăng nhập. Viết trong lúc khủng hoảng là quá muộn.

```sql
-- Thu hồi toàn bộ phiên
UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
-- Buộc đổi mật khẩu
UPDATE users SET must_change_password = true WHERE status = 'active';
```

## C5. Người phụ trách bảo vệ dữ liệu

Chỉ định một người chịu trách nhiệm (DPO), công bố thông tin liên hệ trên trang riêng tư:

```
Người phụ trách bảo vệ dữ liệu cá nhân
Email: privacy@tkb.vn
Điện thoại: ...
Địa chỉ: ...
Thời gian phản hồi: trong 72 giờ làm việc
```

Với công ty nhỏ, đây thường là người đồng sáng lập kỹ thuật. Không cần chuyên trách nhưng cần có tên và có người thực sự đọc hộp thư đó.

---

## D. Ước lượng công sức

| Hạng mục | Thời gian |
|---|---|
| **Thanh toán** | |
| Lược đồ CSDL + luồng đơn hàng | 3 ngày |
| Sinh báo giá PDF + đơn đặt hàng | 2 ngày |
| VietQR + trang hướng dẫn chuyển khoản | 1,5 ngày |
| Tích hợp VNPay | 2 ngày |
| Tích hợp MoMo | 1,5 ngày |
| Đối soát tự động + màn hình khớp tay | 3 ngày |
| Hoá đơn điện tử (một nhà cung cấp) | 3 ngày |
| **Zalo OA** | |
| Liên kết tài khoản + webhook | 2 ngày |
| Hệ thống mẫu tin + gộp tin + hàng đợi | 3 ngày |
| Soạn và gửi duyệt 10 mẫu | 2 ngày + 1–3 tuần chờ |
| Đường lui email | 1 ngày |
| **Tuân thủ** | |
| Trang riêng tư + `GET /me/data` | 2 ngày |
| Xuất dữ liệu cá nhân | 1,5 ngày |
| Luồng yêu cầu xoá + ẩn danh hoá | 2,5 ngày |
| Công việc dọn dẹp theo thời hạn lưu trữ | 1 ngày |
| Kịch bản ứng phó sự cố + diễn tập | 2 ngày |
| Rà soát bên thứ ba, thay thế công cụ | 2 ngày |

Tổng kỹ thuật: khoảng **7 tuần**. Cộng thêm thời gian chờ không phụ thuộc vào mình: xác thực Zalo OA (2–3 tuần), duyệt mẫu ZNS (1–3 tuần), ký hợp đồng cổng thanh toán (2–4 tuần), luật sư soạn hồ sơ (2–4 tuần).

**Bắt đầu các thủ tục hành chính ngay từ đầu dự án**, song song với việc code. Chúng không rút ngắn được và sẽ trở thành đường găng nếu để đến cuối.
