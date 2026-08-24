# TKB SaaS — Đặc tả thiết kế giao diện

> Tài liệu này mô tả đầy đủ để một designer dựng Figma hoặc một dev dựng thẳng React.
> Kèm theo: `tkb_schema.sql` (cơ sở dữ liệu).

---

## 1. Bối cảnh sử dụng — những ràng buộc có thật

Thiết kế này bị chi phối bởi bốn sự thật về người dùng, không phải bởi xu hướng:

| Sự thật | Hệ quả thiết kế |
|---|---|
| Người xếp TKB thường là hiệu phó / tổ trưởng, 40–55 tuổi, thành thạo Excel | Giao diện phải giống bảng tính, không giống app di động. Nút bấm có nhãn chữ, không dùng icon trần. |
| Máy tính trường phổ thông phần lớn là màn 1366×768 | Toàn bộ màn hình xếp lịch phải vừa chiều cao 768px, trừ chrome trình duyệt còn ~620px cho lưới. |
| Một phiên xếp TKB kéo dài 2–4 giờ liên tục | Nền sáng vừa phải, không trắng chói. Không animation lặp. Không màu bão hoà trên diện rộng. |
| Sai một ô = 40 học sinh ngồi nhầm phòng | Mọi thao tác phá vỡ ràng buộc phải bị chặn **trước khi** xảy ra, không phải báo lỗi sau. |

**Nhiệm vụ duy nhất của màn hình chính:** cho phép nhìn thấy toàn bộ lưới TKB một lớp/một GV và di chuyển tiết học sang ô khác một cách nhanh, chính xác, không nhầm.

---

## 2. Năm nguyên tắc

1. **Màu là dữ liệu.** Khung giao diện dùng thang xám trung tính. Toàn bộ ngân sách màu dành cho mã màu môn học. Màu thương hiệu chỉ xuất hiện ở nút hành động chính và trạng thái focus.
2. **Không có ô trống vô nghĩa.** Ô chưa xếp không để trắng — nó hiển thị dấu hiệu "còn N tiết cần đặt" khi lọc theo môn.
3. **Phản hồi trước hành động.** Kéo-thả cho biết kết quả *trong lúc* kéo, không phải sau khi thả.
4. **Mật độ trước khoảng thở.** Ô lưới cao 44px, không phải 64px. Đây là công cụ làm việc, không phải trang trưng bày.
5. **Mọi thứ đều hoàn tác được.** Không có hộp thoại "Bạn có chắc không?" cho thao tác lưới — thay bằng Ctrl+Z và snapshot.

---

## 3. Design tokens

### 3.1 Màu — khung giao diện

```css
:root {
  /* Nền: xám ngả xanh rất nhạt, gợi giấy in TKB, đỡ chói hơn #FFF */
  --bg-app:        #F2F4F7;   /* nền toàn trang */
  --bg-surface:    #FFFFFF;   /* thẻ, bảng, lưới */
  --bg-sunken:     #E7EAF0;   /* ô trống trong lưới, vùng thả */
  --bg-hover:      #EDF0F5;

  /* Đường kẻ — mảnh, đây là công cụ dạng bảng */
  --line-hair:     #E3E7EE;   /* kẻ ô lưới */
  --line-solid:    #C9D0DB;   /* viền thẻ, chia vùng */
  --line-strong:   #8A93A3;   /* ranh giới buổi sáng/chiều */

  /* Chữ */
  --text-primary:  #131A24;
  --text-secondary:#5B6472;
  --text-muted:    #8A93A3;
  --text-inverse:  #FFFFFF;

  /* Thương hiệu: xanh mực — cố ý chọn tông KHÔNG có trong bảng màu môn học */
  --brand-900:     #0F2A5C;
  --brand-700:     #1B4A9C;
  --brand-600:     #2563C7;   /* nút chính, link */
  --brand-100:     #DCE8FB;   /* nền badge, vùng chọn */

  /* Trạng thái ràng buộc — "đèn giao thông" */
  --ok-bg:         #D8F3E3;   --ok-line:   #2F9E68;
  --warn-bg:       #FDF0CE;   --warn-line: #C08A12;
  --block-bg:      #FBDDDD;   --block-line:#C43D3D;
  --pin-line:      #6B47C9;   /* tiết bị ghim */
}
```

**Nền tối:** không làm ở phiên bản đầu. Người dùng in ra giấy nhiều, và mã màu môn học được tinh chỉnh cho nền sáng — đảo màu sẽ phá hệ thống. Thay bằng nút "Giảm sáng" hạ độ bão hoà toàn bộ ô môn xuống 70%.

### 3.2 Bảng màu môn học

12 màu, tất cả đạt tương phản ≥ 4.5:1 với chữ `#131A24` đặt trên chúng. Gán tự động theo thứ tự khi tạo môn, cho phép đổi thủ công.

| # | Tên | Nền ô | Viền trái 3px | Môn gợi ý |
|---|---|---|---|---|
| 1 | Xanh biển | `#DCEAFB` | `#2F6FBF` | Toán |
| 2 | Hồng đất | `#FBE0E0` | `#C25454` | Văn |
| 3 | Xanh lá | `#DDF2DF` | `#4A9455` | Sinh |
| 4 | Cam | `#FCE8D5` | `#C97B2E` | Lý |
| 5 | Tím | `#E8E0F7` | `#7A5BC2` | Hoá |
| 6 | Xanh ngọc | `#D6F0EF` | `#2E8E8A` | Tiếng Anh |
| 7 | Vàng | `#F8F0CE` | `#B39415` | Sử |
| 8 | Xanh xám | `#DFE6EC` | `#5C7488` | Địa |
| 9 | Đỏ gạch | `#F7DCD2` | `#BC5B38` | GDCD |
| 10 | Chàm | `#DDE1F5` | `#5461B8` | Tin học |
| 11 | Ô liu | `#E6EED7` | `#78913F` | Công nghệ |
| 12 | Nâu | `#EDE3D8` | `#8A6A4A` | Thể dục |

Ô lưới dùng **nền nhạt + thanh viền trái đậm 3px**. Cách này giữ chữ luôn đọc được, đồng thời khi in đen trắng thanh viền vẫn phân biệt được bằng độ đậm.

### 3.3 Typography

```css
--font-ui:   'Be Vietnam Pro', system-ui, sans-serif;
--font-data: 'IBM Plex Mono', ui-monospace, monospace;
```

Chọn **Be Vietnam Pro** vì bộ dấu tiếng Việt được thiết kế gốc (dấu ngã, dấu hỏi trên nguyên âm có mũ không bị chồng) — đa số font sans phổ biến xử lý phần này kém, và giao diện này chi chít chữ có dấu ở cỡ nhỏ.

**IBM Plex Mono** dùng cho mọi con số và mã: mã lớp `10A1`, số tiết `4/5`, mã GV, thời gian `07:00`. Chữ số đều chiều rộng giúp cột số căn thẳng — thứ mà người dùng Excel mong đợi.

| Vai trò | Font | Cỡ / Dòng | Weight | Ghi chú |
|---|---|---|---|---|
| Tiêu đề trang | UI | 20/28 | 700 | |
| Tiêu đề mục | UI | 15/22 | 600 | |
| Nội dung | UI | 14/20 | 400 | |
| Nhãn form, header bảng | UI | 12/16 | 600 | `letter-spacing: .02em`, KHÔNG viết hoa toàn bộ (tiếng Việt viết hoa mất dấu khó đọc) |
| **Ô lưới — tên môn** | UI | 12/14 | 600 | |
| **Ô lưới — tên GV** | UI | 11/13 | 400 | màu `--text-secondary` |
| **Ô lưới — phòng** | data | 10/12 | 500 | |
| Số liệu, mã | data | 13/18 | 500 | `font-variant-numeric: tabular-nums` |

### 3.4 Kích thước & không gian

```css
--space: 4px;                    /* thang 4-8-12-16-24-32-48 */
--radius-sm: 3px;   --radius-md: 6px;   --radius-lg: 10px;
--shadow-pop:   0 4px 14px rgba(19,26,36,.10);   /* dropdown, popover */
--shadow-drag:  0 8px 20px rgba(19,26,36,.22);   /* thẻ đang kéo */

/* Kích thước cố định của lưới — tính để vừa 1366×768 */
--cell-w:        104px;   /* rộng một ô tiết */
--cell-h:         46px;   /* cao một ô tiết */
--row-head-w:    112px;   /* cột tên lớp bên trái */
--col-head-h:     52px;   /* hàng tiêu đề Thứ/Tiết */
--sidebar-w:     216px;   /* thu gọn còn 56px */
--panel-w:       288px;   /* panel phải */
--topbar-h:       52px;
--toolbar-h:      44px;
```

Bo góc nhỏ (3–6px) xuyên suốt. Bo tròn lớn làm ô lưới trông rời rạc và ăn mất diện tích chữ.

---

## 4. Kiến trúc thông tin

```
/                          Trang giới thiệu (công khai)
/gia                       Bảng giá
/huong-dan                 Hướng dẫn + video
/dang-nhap  /dang-ky       Xác thực

/app
├── /chon-truong           Chọn trường (khi user thuộc nhiều trường)
└── /:truong
    ├── /tong-quan         Bảng điều khiển
    ├── /nam-hoc           Năm học, học kỳ, khung tiết, ngày học trong tuần
    ├── /danh-muc
    │   ├── /khoi-lop      Khối & lớp (+ nhóm tách lớp)
    │   ├── /mon-hoc       Môn + số tiết chuẩn theo khối
    │   ├── /giao-vien     GV + môn dạy được + định mức
    │   ├── /phong-hoc     Phòng thường & phòng bộ môn
    │   └── /to-bo-mon
    ├── /phan-cong         ★ Bảng phân công giảng dạy
    ├── /rang-buoc
    │   ├── /lich-ban      Lưới bận/rảnh GV, lớp, phòng
    │   └── /luat          Luật xếp có tham số
    ├── /xep-tkb/:id       ★★ Màn hình xếp — trái tim sản phẩm
    ├── /kiem-tra/:id      Danh sách xung đột & cảnh báo
    ├── /bao-cao           Thống kê tải giảng dạy, tiết trống
    ├── /in-an/:id         Xem trước bản in & xuất Excel/PDF
    ├── /day-thay          Điều chỉnh theo ngày (dạy thay, nghỉ)
    ├── /nguoi-dung        Thành viên & phân quyền
    └── /cai-dat           Thông tin trường, gói dịch vụ

/tkb/:slug                 Trang xem công khai (không cần đăng nhập)
/toi/thoi-khoa-bieu        TKB cá nhân của giáo viên
```

Thứ tự menu chính là **thứ tự quy trình**: khai báo → phân công → xếp → kiểm tra → in. Menu đánh số 1–5 ở đây là hợp lý, vì đây thực sự là chuỗi tuần tự bắt buộc — không làm bước trước thì bước sau vô nghĩa.

---

## 5. Khung layout chung của khu vực /app

```
┌──────────────────────────────────────────────────────────────────────┐
│ TKB │ THPT Lê Quý Đôn ▾ │ 2025–2026 ▾ │ HK I ▾      🔍  ?  Ng.V.An ▾ │ 52px
├────────────┬─────────────────────────────────────────────────────────┤
│            │  Thanh công cụ ngữ cảnh (đổi theo trang)          44px  │
│  Sidebar   ├─────────────────────────────────────────────────────────┤
│  216px     │                                                         │
│            │                                                         │
│  1 Năm học │              Vùng nội dung                              │
│  2 Danh mục│              (cuộn độc lập)                             │
│  3 Phân... │                                                         │
│  4 Xếp TKB │                                                         │
│  5 Kiểm tra│                                                         │
│  ────────  │                                                         │
│  Báo cáo   │                                                         │
│  In ấn     │                                                         │
│  Dạy thay  │                                                         │
│  ────────  │                                                         │
│  Người dùng│                                                         │
│  Cài đặt   │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```

**Bộ chọn ngữ cảnh trên topbar** (trường / năm học / học kỳ) là thành phần quan trọng nhất của thanh trên. Nó luôn hiển thị vì mọi dữ liệu bên dưới đều phụ thuộc ba giá trị này — giấu nó đi là nguồn gốc của lỗi "tôi nhập nhầm vào năm ngoái".

Ở trang `/xep-tkb`, sidebar **tự động thu về 56px** (chỉ còn icon) để nhường chỗ cho lưới. Người dùng có thể ghim mở lại.

---

## 6. Màn hình xếp TKB — đặc tả chi tiết

Đây là màn hình chiếm 80% thời gian sử dụng. Mô tả kỹ nhất.

### 6.1 Bố cục

```
┌──┬──────────────────────────────────────────────────┬─────────────────┐
│  │ TOOLBAR                                          │                 │
│  │ ┌──────────────────┐ ┌────────────────────────┐  │  KHO TIẾT       │
│S │ │Xem: [Lớp▾][GV][Phòng] │ Lọc: [Khối 10▾][Môn▾]│  │  CHƯA XẾP       │
│I │ └──────────────────┘ └────────────────────────┘  │                 │
│D │ [↶ Hoàn tác][↷][🔒 Ghim][⚡ Xếp tự động][💾][🖨]  │  ┌─────────────┐│
│E ├──────────────────────────────────────────────────┤  │ Tìm môn/GV..││
│B │       ┌── SÁNG ────────────┐┌── CHIỀU ──┐       │  └─────────────┘│
│A │  Lớp  │T2 T3 T4 T5 T6 T7   ││T2 T3 T4 T5│       │                 │
│R │ ──────┼────────────────────┼┼───────────┤       │  Khối 10  32 ▾  │
│  │  10A1 │▓▓ ▓▓ ▒▒ ▓▓ ▓▓ ▓▓   ││▓▓ ▒▒ ░░ ░░│       │  ┌─────────────┐│
│56│  10A2 │▓▓ ▒▒ ▓▓ ▓▓ ░░ ▓▓   ││░░ ▓▓ ▓▓ ▒▒│       │  │▌Toán   10A1 ││
│px│  10A3 │▒▒ ▓▓ ▓▓ ▒▒ ▓▓ ▓▓   ││▓▓ ░░ ▓▓ ▓▓│       │  │ T.Hùng  ×2  ││
│  │  ...  │                    ││           │       │  ├─────────────┤│
│  │       │  (cuộn dọc + ngang, header dính)        │  │▌Lý     10A1 ││
│  ├──────────────────────────────────────────────────┤  │ C.Lan   ×1  ││
│  │ Đã xếp 428/450 · 3 lỗi · 12 cảnh báo · Điểm 214 │  └─────────────┘│
└──┴──────────────────────────────────────────────────┴─────────────────┘
```

### 6.2 Ba chế độ xem

Cùng một dữ liệu, ba trục nhìn — chuyển bằng phím `1` `2` `3`:

| Chế độ | Hàng | Dùng để |
|---|---|---|
| **Theo lớp** (mặc định) | Mỗi lớp một hàng | Xếp chính, kiểm tra lớp có tiết trống không |
| **Theo giáo viên** | Mỗi GV một hàng | Kiểm tra GV có bị dồn tiết, tiết trống giữa buổi |
| **Theo phòng** | Mỗi phòng một hàng | Kiểm tra phòng bộ môn trống hay kín |

Chuyển chế độ **giữ nguyên vị trí cuộn tương đối và ô đang chọn** — nếu đang chọn tiết Toán của 10A1 rồi bấm sang chế độ GV, lưới tự cuộn tới hàng của thầy Hùng và giữ ô đó được chọn. Đây là chi tiết nhỏ nhưng tiết kiệm rất nhiều thao tác.

### 6.3 Cấu tạo ô lưới

Ô 104×46px, chứa ba tầng thông tin:

```
┌────────────────────────┐
│▌ Toán            🔒    │  ← 12px/600 + icon ghim nếu có
│▌ T.Hùng                │  ← 11px/400, xám
│▌ P.A201                │  ← 10px mono, chỉ hiện khi khác phòng cố định
└────────────────────────┘
   ↑ viền trái 3px màu môn
```

**Quy tắc ẩn thông tin theo mật độ** — khi cửa sổ hẹp và ô co dưới 90px:
- Bỏ dòng phòng học trước
- Rồi rút tên GV còn mã (`Hùng` → `HG`)
- Tên môn không bao giờ bị ẩn, chỉ rút ngắn theo `short_name`

**Trạng thái ô:**

| Trạng thái | Biểu hiện |
|---|---|
| Bình thường | Nền màu môn, viền trái đậm |
| Hover | Sáng thêm 4%, hiện nút `⋮` góc phải |
| Đang chọn | Viền ngoài 2px `--brand-600` + offset 1px |
| Ghim | Icon khoá nhỏ góc trên phải, viền trái đổi sang `--pin-line` nét đứt |
| Có xung đột | Gạch chân sóng đỏ dưới tên môn + chấm đỏ góc trên trái |
| Vi phạm mềm | Chấm vàng góc trên trái |
| Ô trống | Nền `--bg-sunken`, không viền |
| Ô bị khoá (GV bận) | Nền `--bg-sunken` + hoa văn gạch chéo 45° mảnh, tooltip lý do |

### 6.4 ★ Signature: Đèn giao thông khi kéo-thả

Đây là thứ phân biệt sản phẩm này với việc xếp bằng Excel.

**Ngay khi người dùng nhấn giữ chuột trên một tiết** (ngưỡng 4px di chuyển), trong vòng **120ms** toàn bộ lưới được tô lại thành ba nhóm:

```
Đang kéo: [Toán · 10A1 · T.Hùng]

┌──────┬──────┬──────┬──────┬──────┬──────┐
│ Xanh │ Xanh │ Vàng │ Đỏ   │ Xanh │ Đỏ   │
│ nhạt │ nhạt │ nhạt │ nhạt │ nhạt │ nhạt │
└──────┴──────┴──────┴──────┴──────┴──────┘
   ↑             ↑        ↑
 đặt được   đặt được   KHÔNG
            nhưng      đặt được
            không tốt
```

| Màu | Ý nghĩa | Nền | Khi thả |
|---|---|---|---|
| **Xanh** | Hợp lệ, không vi phạm gì | `--ok-bg` | Đặt luôn |
| **Vàng** | Hợp lệ nhưng vi phạm ràng buộc mềm | `--warn-bg` | Đặt, hiện toast nêu vi phạm + nút Hoàn tác |
| **Đỏ** | Vi phạm ràng buộc cứng | `--block-bg`, con trỏ `not-allowed` | Từ chối, rung ô 2 lần biên độ 3px |

Khi con trỏ dừng trên một ô **đỏ hoặc vàng** quá 400ms, hiện tooltip nêu **lý do cụ thể**, không phải thông báo chung chung:

> **Không đặt được ở đây**
> Thầy Hùng đang dạy 11B2 tiết này.
> *Nhấn Alt để xem tiết đó.*

> **Đặt được, nhưng:**
> • 10A1 sẽ có 3 tiết Toán trong Thứ Ba (−15 điểm)
> • Tiết 5 là tiết cuối buổi, Toán được đánh dấu ưu tiên tiết đầu (−8 điểm)

**Tính toán ở đâu:** toàn bộ ma trận khả dụng được tính **ở client**, đồng bộ, ngay tại thời điểm `dragstart` — không gọi API. Với 45 lớp × 6 ngày × 10 tiết = 2.700 ô, một vòng kiểm tra chỉ mất vài mili giây nếu giữ sẵn các index trong bộ nhớ (`Map` tra cứu theo `teacherId:day:period`). Gọi server ở đây sẽ phá hỏng trải nghiệm.

**Thao tác hoán đổi:** thả một tiết lên ô đã có tiết khác → hai tiết đổi chỗ cho nhau, nếu cả hai chiều đều hợp lệ. Ô đích hiện viền đôi và icon `⇄` trong lúc hover.

### 6.5 Kho tiết chưa xếp (panel phải)

Nguồn của mọi thao tác kéo. Nhóm theo khối → lớp, mỗi thẻ ghi số tiết còn lại:

```
┌────────────────────────┐
│ 🔍 Tìm môn hoặc GV...  │
├────────────────────────┤
│ ▾ Khối 10        còn 32│
│   ┌──────────────────┐ │
│   │▌Toán      10A1   │ │
│   │ T.Hùng      ×2   │ │  ← còn 2 tiết chưa xếp
│   ├──────────────────┤ │
│   │▌Vật lí    10A1   │ │
│   │ C.Lan   ⚠  ×1    │ │  ← ⚠ = khó xếp, ít ô trống hợp lệ
│   └──────────────────┘ │
│ ▸ Khối 11        còn 18│
│ ▸ Khối 12        đã đủ │
└────────────────────────┘
```

Thẻ có huy hiệu `⚠` khi số ô hợp lệ còn lại nhỏ hơn số tiết cần xếp × 3 — báo trước rằng nếu không xếp nó sớm sẽ bị kẹt. Panel tự sắp thẻ khó lên trên.

Kéo một thẻ có `×2` chỉ đặt **một** tiết, số đếm giảm còn `×1`. Giữ `Shift` khi thả để đặt tiết đôi (2 tiết liên tiếp) nếu ô kế bên cũng hợp lệ.

### 6.6 Bàn phím

Người dùng thành thạo sẽ không dùng chuột. Toàn bộ lưới điều khiển được bằng phím:

| Phím | Hành động |
|---|---|
| `←↑↓→` | Di chuyển ô đang chọn |
| `Enter` | Mở kho tiết lọc sẵn cho ô này |
| `Space` | Nhấc / đặt tiết (chế độ "cầm") |
| `X` `V` | Cắt / dán tiết |
| `Delete` | Gỡ tiết về kho |
| `P` | Ghim / bỏ ghim |
| `Ctrl+Z` `Ctrl+Shift+Z` | Hoàn tác / làm lại |
| `1` `2` `3` | Đổi chế độ xem lớp / GV / phòng |
| `F` | Ô đầu tiên chưa xếp |
| `Ctrl+K` | Bảng lệnh nhanh |

Trong chế độ "cầm" (sau `Space`), đèn giao thông vẫn hoạt động: ô đang chọn hiển thị viền màu tương ứng khi di chuyển bằng phím mũi tên.

### 6.7 Xếp tự động

Nút `⚡ Xếp tự động` mở hộp thoại:

```
┌─ Xếp tự động ─────────────────────────────┐
│                                            │
│ Phạm vi                                    │
│  ○ Toàn bộ TKB (xoá phần chưa ghim)       │
│  ● Chỉ các tiết chưa xếp        ← mặc định│
│  ○ Chỉ khối/lớp đã chọn: [Khối 10 ▾]      │
│                                            │
│ ☑ Giữ nguyên 24 tiết đã ghim               │
│                                            │
│ Ưu tiên                                    │
│  Dồn tiết cho giáo viên   ▁▂▃▅▇  cao       │
│  Rải đều môn trong tuần   ▁▂▃▅▇  trung bình│
│  Môn khó xếp tiết đầu     ▁▂▃▅▇  thấp      │
│  Hạn chế tiết trống lớp   ▁▂▃▅▇  cao       │
│                                            │
│ Thời gian tối đa  [ 60 ] giây              │
│                                            │
│              [Huỷ]  [Bắt đầu xếp]          │
└────────────────────────────────────────────┘
```

Bốn thanh trượt ưu tiên ánh xạ thẳng sang `constraints.weight` trong CSDL. Không hiển thị con số điểm phạt cho người dùng ở đây — họ nghĩ bằng ngôn ngữ "ưu tiên", không bằng ngôn ngữ hàm mục tiêu.

**Trong lúc chạy** (chạy nền, không chặn giao diện):

```
┌────────────────────────────────────────────┐
│ Đang xếp…                            72%   │
│ ████████████████████░░░░░░░                │
│                                            │
│ Đã xếp 402/450 tiết                        │
│ Còn 0 lỗi · 34 cảnh báo                    │
│ Điểm tối ưu: 512 → 214  ↓                  │
│                                            │
│ Lưới đang cập nhật trực tiếp bên dưới.     │
│                    [Dừng và giữ kết quả]   │
└────────────────────────────────────────────┘
```

Lưới phía sau **cập nhật thật** qua WebSocket mỗi khi solver tìm được lời giải tốt hơn. Người dùng nhìn thấy các ô lấp dần — đây là điều làm họ tin phần mềm đang làm việc thật. Nút "Dừng và giữ kết quả" luôn khả dụng.

**Khi xong:** thanh thông báo trên lưới, không phải modal:
> Đã xếp xong 450/450 tiết trong 41 giây. Còn 34 cảnh báo.
> [Xem cảnh báo] [Hoàn tác toàn bộ] [Giữ kết quả này]

---

## 7. Màn hình phân công giảng dạy

Màn hình nhập liệu nặng nhất — quyết định người dùng có bỏ cuộc trong 30 phút đầu hay không.

Dùng **bảng ma trận Lớp × Môn**, ô chứa GV và số tiết. Đây là hình dạng người dùng đã quen từ bản Excel của họ.

```
        │ Toán  │ Văn   │ Anh   │ Lý    │ Hoá   │ ... │ Tổng
────────┼───────┼───────┼───────┼───────┼───────┼─────┼──────
  10A1  │T.Hùng │C.Mai  │C.Lan  │  ＋   │T.Nam  │     │ 24/29
        │  4    │  4    │  3    │       │  2    │     │
────────┼───────┼───────┼───────┼───────┼───────┼─────┼──────
  10A2  │T.Hùng │C.Mai  │  ＋   │T.Sơn  │T.Nam  │     │ 22/29
        │  4    │  4    │       │  2    │  2    │     │
────────┼───────┼───────┼───────┼───────┼───────┼─────┼──────
  Tổng  │ 44 t  │ 44 t  │ 33 t  │ 22 t  │ 22 t  │     │
```

**Thao tác cốt lõi:**
- Click ô trống `＋` → dropdown chỉ liệt kê GV **dạy được môn đó** (lọc theo `teacher_subjects`), sắp theo tải hiện tại tăng dần, GV đã quá định mức hiển thị mờ + số tiết vượt.
- Số tiết tự điền từ `subject_grade_configs`, sửa được tại chỗ.
- **Kéo dọc để sao chép**: chọn ô, kéo góc dưới phải xuống — gán cùng GV cho các lớp bên dưới. Đúng thao tác Excel, tiết kiệm hàng trăm click.
- Cột `Tổng` bên phải: số tiết đã phân / số tiết chuẩn của khối. Đỏ nếu thiếu, cam nếu thừa.
- Hàng `Tổng` dưới cùng: tổng tiết mỗi môn toàn trường.

**Panel phải:** danh sách GV kèm thanh tải giảng dạy.

```
T. Nguyễn Văn Hùng   ████████░░  16/19 tiết
C. Trần Thị Mai      ██████████  19/19 tiết  ✓ đủ
T. Lê Sơn            ████████████ 22/19 ⚠ vượt 3
```

Click tên GV → tô sáng mọi ô của GV đó trong ma trận.

**Ghép lớp / tách lớp:** nút `⋮` trên ô mở menu:
- *Ghép với lớp khác…* → chọn 10A2, 10A3 → tạo một `assignment` có nhiều `assignment_classes`. Ô hiển thị badge `⛓ 3 lớp`.
- *Tách lớp thành nhóm…* → tạo `class_sections`, ô tách đôi theo chiều dọc.
- *Thêm giáo viên cùng dạy…* → ô hiển thị hai tên chồng nhau.

---

## 8. Màn hình lịch bận (ràng buộc)

Lưới đơn giản, click hoặc quét chuột để bật/tắt:

```
Giáo viên: [T. Nguyễn Văn Hùng ▾]        Áp dụng nhanh: [Nghỉ T7 ▾]

        T2   T3   T4   T5   T6   T7
Sáng 1  ○    ○    ●    ○    ○    ●     ○ rảnh
Sáng 2  ○    ○    ●    ○    ○    ●     ● bận
Sáng 3  ○    ○    ●    ○    ○    ●     ◐ ưu tiên xếp
Sáng 4  ○    ◐    ●    ○    ◐    ●     ◑ hạn chế xếp
Sáng 5  ○    ◐    ●    ○    ◐    ●
────────────────────────────────────
Chiều 1 ●    ●    ●    ●    ●    ●
Chiều 2 ●    ●    ●    ●    ●    ●

Đang bận 22/60 ô · còn 38 ô cho 16 tiết
```

Quét chuột kéo qua nhiều ô để đặt hàng loạt. Giữ `Alt` khi quét để xoá. Nút "Áp dụng nhanh" có mẫu sẵn: *Nghỉ Thứ Bảy*, *Chỉ dạy buổi sáng*, *Nghỉ tiết 5*, *Sao chép từ GV khác*.

Dòng cuối là cảnh báo phòng ngừa quan trọng: nếu số ô rảnh còn lại **ít hơn 2 lần** số tiết cần xếp, hiện cảnh báo cam ngay lúc đó — thay vì để thuật toán chạy 60 giây rồi báo thất bại.

---

## 9. Thư viện thành phần

| Thành phần | Ghi chú thiết kế |
|---|---|
| `Button` | 4 biến thể: primary (nền brand-600), secondary (viền), ghost, danger. 3 cỡ: 28 / 32 / 38px. Luôn có nhãn chữ. |
| `Select` / `Combobox` | Tìm kiếm nội dòng khi > 8 lựa chọn. Bỏ dấu khi so khớp (`hung` khớp `Hùng`). |
| `DataTable` | Header dính, cột đóng băng, sửa tại chỗ, chọn nhiều dòng, phân trang phía server. |
| `TimetableGrid` | Ảo hoá hàng (`@tanstack/react-virtual`), header dính hai chiều, kéo-thả. Thành phần phức tạp nhất. |
| `LessonCell` | Ghi nhớ bằng `React.memo`, so sánh nông theo `lessonId + version`. |
| `AvailabilityGrid` | Lưới quét chuột 3 trạng thái. |
| `WorkloadBar` | Thanh tải, đổi màu theo ngưỡng 90% / 100%. |
| `ConflictList` | Nhóm theo loại, click để nhảy tới ô tương ứng trong lưới. |
| `Toast` | Góc dưới phải, tự tắt 5 giây, luôn kèm nút Hoàn tác cho thao tác lưới. |
| `Drawer` | Trượt phải, dùng cho sửa chi tiết mà không rời lưới. |
| `EmptyState` | Icon nét mảnh + một câu + một nút hành động. |

**Nền tảng gợi ý:** Radix UI primitives + Tailwind, tự viết lớp trình bày. Không dùng nguyên MUI hay Ant Design — cả hai áp đặt mật độ và bo góc riêng, sẽ chống lại yêu cầu mật độ cao ở đây.

---

## 10. Chuyển động

Rất tiết chế. Chỉ ba nơi được phép chuyển động:

1. **Đèn giao thông bật lên** — 120ms `ease-out`, chỉ đổi `background-color`. Nhanh đến mức cảm giác tức thì.
2. **Ô vừa đặt xong** — nháy sáng 1 lần, 240ms, từ trắng về màu môn. Xác nhận thao tác thành công.
3. **Thẻ đang kéo** — nâng lên `scale(1.02)` + `--shadow-drag`, nghiêng 1° theo hướng kéo.

Ô bị từ chối: rung ngang 2 lần, biên độ 3px, tổng 180ms.

Không có: hiệu ứng vào trang, chuyển cảnh giữa route, parallax, hiệu ứng lướt qua. Trong phiên 3 giờ, mọi animation không cần thiết đều trở thành phiền nhiễu.

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```
Khi tắt chuyển động, ô bị từ chối đổi sang nháy viền đỏ 1 lần thay vì rung.

---

## 11. Responsive

Lưới TKB **không thể** nhồi vào màn hình điện thoại. Chấp nhận điều đó và chia rõ:

| Bề rộng | Xử lý |
|---|---|
| ≥ 1280px | Đầy đủ: sidebar + lưới + panel |
| 1024–1279px | Panel phải chuyển thành drawer trượt |
| 768–1023px | Sidebar thu về icon; lưới cuộn ngang |
| < 768px | **Chặn màn hình xếp**, hiện: *"Xếp thời khóa biểu cần màn hình rộng hơn. Hãy mở trên máy tính."* + nút *"Xem thời khóa biểu"* |

**Trên điện thoại chỉ hỗ trợ chế độ xem** — và làm thật tốt, vì đây mới là nơi giáo viên và phụ huynh dùng nhiều nhất:

```
┌─────────────────────┐
│ 10A1 ▾    Tuần này  │
├─────────────────────┤
│ THỨ HAI     08/09   │
│ ┌─────────────────┐ │
│ │▌1  Chào cờ      │ │
│ │ 07:00  Sân trường│ │
│ ├─────────────────┤ │
│ │▌2  Toán  T.Hùng │ │
│ │ 07:50  P.A201   │ │
│ └─────────────────┘ │
│ THỨ BA      09/09   │
│ ...                 │
└─────────────────────┘
```

Danh sách dọc theo ngày, không phải lưới. Ngày hôm nay được ghim lên đầu. Có nút "Thêm vào lịch điện thoại" (xuất `.ics`).

---

## 12. Khả năng tiếp cận

- Tương phản chữ/nền ≥ 4.5:1 ở mọi ô môn học. Đã kiểm tra cả 12 màu.
- **Không truyền thông tin chỉ bằng màu.** Ô xung đột có cả chấm đỏ *và* gạch chân sóng. Đèn giao thông có cả màu *và* biểu tượng góc ô (`✓` / `!` / `✕`) — bật được ở Cài đặt cho người mù màu.
- Vòng focus 2px `--brand-600`, offset 2px, không bao giờ bị `outline: none`.
- Lưới khai báo `role="grid"`, ô là `role="gridcell"` với `aria-label` đầy đủ: *"Thứ Hai, tiết 2, lớp 10A1, môn Toán, thầy Nguyễn Văn Hùng, phòng A201, đã ghim"*.
- Vùng `aria-live="polite"` thông báo kết quả thả: *"Đã chuyển Toán 10A1 sang Thứ Tư tiết 3"*.
- Cỡ chữ nhỏ nhất trong giao diện là 10px chỉ dùng cho mã phòng; có công tắc "Chữ lớn" nâng toàn bộ thang lên 1 bậc và tăng `--cell-h` lên 54px.

---

## 13. Trạng thái rỗng, đang tải, lỗi

Viết theo giọng hướng dẫn, không xin lỗi, không mơ hồ.

| Tình huống | Nội dung |
|---|---|
| Chưa có năm học | **Bắt đầu bằng việc tạo năm học**<br>Mọi dữ liệu lớp, môn, giáo viên đều thuộc về một năm học cụ thể.<br>`[Tạo năm học 2025–2026]` |
| Chưa có phân công | **Chưa có phân công giảng dạy**<br>Xếp thời khóa biểu cần biết ai dạy môn gì ở lớp nào.<br>`[Nhập từ Excel]` `[Tạo thủ công]` |
| Lưới trống, đã có phân công | **450 tiết đang chờ được xếp**<br>Kéo từ kho bên phải, hoặc để phần mềm xếp trước rồi bạn chỉnh lại.<br>`[Xếp tự động]` |
| Đang tải lưới | Khung xương ô lưới, không dùng vòng xoay. Giữ nguyên bố cục để tránh nhảy layout. |
| Solver thất bại | **Không xếp được 12 tiết**<br>Thường do giáo viên bị đặt bận quá nhiều ô, hoặc phòng bộ môn không đủ.<br>`[Xem 12 tiết này]` `[Nới lỏng ràng buộc]` |
| Mất kết nối | Thanh vàng dính đỉnh: *Mất kết nối. Các thay đổi được lưu tạm trên máy và sẽ đồng bộ khi có mạng lại.* |
| Xung đột nhiều người | *Cô Mai vừa đổi tiết Văn 10A2. Lưới đã cập nhật.* — kèm tô sáng ô đó 3 giây. |

---

## 14. Bản in

Người dùng in rất nhiều. Bản in là một sản phẩm riêng, không phải ảnh chụp màn hình.

```css
@media print {
  /* Ẩn toàn bộ chrome */
  .sidebar, .topbar, .toolbar, .panel, .statusbar { display: none; }

  /* Ô môn: bỏ nền màu, giữ viền trái đậm nhạt khác nhau */
  .lesson-cell { background: #fff !important; border-left-width: 4px; }

  @page { size: A4 landscape; margin: 12mm; }
}
```

Trang `/in-an` cho chọn:
- **Loại**: TKB toàn trường / theo lớp (mỗi lớp một trang) / theo GV / theo phòng
- **Khổ**: A4 ngang, A4 dọc, A3 ngang
- **Tuỳ chọn**: hiện tên GV, hiện phòng, hiện giờ vào lớp, in màu hay đen trắng
- **Đầu trang**: logo + tên trường + "Áp dụng từ ngày…" — bản in TKB là văn bản hành chính, cần dòng này.

Xuất Excel giữ đúng bố cục lưới, mỗi lớp một sheet, ô có nền màu — vì nhiều trường sẽ sửa tay tiếp trên Excel rồi mới in.

---

## 15. Trang giới thiệu (công khai)

Ngắn gọn, một nhiệm vụ: đưa người xem vào `/dang-ky`.

**Hero không dùng công thức "tiêu đề lớn + ảnh chụp màn hình mờ".** Thay vào đó: **một lưới TKB thật, thu nhỏ, đang tự xếp** ngay trên hero — các ô lấp dần trong 6 giây rồi dừng, kèm bộ đếm `0 → 450 tiết · 41 giây`. Người xem hiểu ngay sản phẩm làm gì mà không cần đọc một chữ nào. Tôn trọng `prefers-reduced-motion`: hiện luôn trạng thái hoàn thành.

Phần dưới, theo đúng thứ tự câu hỏi trong đầu người mua:
1. *Mất bao lâu?* — ba bước: Nhập danh sách → Phân công → Xếp. Kèm thời gian thực tế.
2. *Trường tôi có xếp được không?* — nêu rõ các trường hợp khó: ghép lớp, tách lớp, học 2 buổi, phòng bộ môn, GV dạy nhiều trường.
3. *Có mất dữ liệu không?* — lịch sử phiên bản, xuất Excel bất cứ lúc nào.
4. *Giá?* — bảng giá thẳng, có gói miễn phí giới hạn số lớp.
5. *Ai đang dùng?* — tên trường thật, nếu chưa có thì bỏ hẳn mục này chứ không bịa.

---

## 16. Ghi chú kỹ thuật cho frontend

```
React 18 + TypeScript + Vite
├── @tanstack/react-query      đồng bộ dữ liệu server
├── @tanstack/react-virtual    ảo hoá hàng lưới
├── @tanstack/react-table      bảng phân công, danh mục
├── @dnd-kit/core              kéo-thả (không dùng react-beautiful-dnd, đã ngừng phát triển)
├── zustand                    trạng thái lưới cục bộ + ngăn xếp hoàn tác
├── @tkb/cost-core             hàm chi phí + explainCost dùng chung với API/solver (solver §12.4)
├── radix-ui                   primitives
├── tailwindcss                trình bày
└── socket.io-client           tiến độ solver, đồng bộ nhiều người
```

**Ba điểm dễ sai về hiệu năng:**

1. **Không đưa toàn bộ lưới vào React state phẳng.** Giữ `Map<slotKey, Lesson>` trong Zustand, mỗi `LessonCell` chỉ subscribe đúng khoá của nó. Nếu không, mỗi lần kéo sẽ render lại 2.700 ô.

2. **Đèn giao thông phải tính sẵn.** Tại `dragstart`, dựng ba `Set<slotKey>` (ok / warn / block) một lần rồi tra cứu O(1) trong lúc kéo. Đừng tính lại mỗi `dragover`.

3. **Ngăn xếp hoàn tác lưu lệnh, không lưu snapshot.** Mỗi thao tác là `{type: 'move', lessonId, from, to}`. Snapshot đầy đủ chỉ tạo trước khi chạy xếp tự động.
