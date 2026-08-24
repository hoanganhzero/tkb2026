# TKB SaaS — Kiến trúc triển khai, giám sát và sao lưu

> Đi kèm: `tkb_api_spec.md`, `tkb_solver_design.md`, `tkb_schema.sql`.

---

## 1. Đặc thù tải của sản phẩm này

Trước khi chọn hạ tầng, cần hiểu hình dạng tải — nó rất khác một SaaS thông thường:

```
Lưu lượng theo tháng (ước tính, 200 trường)

Tháng   8    9   10   11   12    1    2    3    4    5    6    7
      ████ ███  ▓    ▓    ██   ███   ▓    ▓    ▓    ▓    █    █
      đỉnh      thấp      HK2  đỉnh       thấp           chuyển tiếp
```

**Ba đặc điểm quyết định:**

1. **Cực kỳ theo mùa.** Tháng 8 và tháng 12–1 gánh 70% tải cả năm. Tháng 3–5 gần như không ai dùng ngoài việc tra cứu.
2. **Tải tính toán tập trung, không dàn đều.** Một job solver chiếm trọn một lõi CPU trong 60 giây. 20 trường cùng bấm "Xếp tự động" lúc 9h sáng ngày 20/8 là kịch bản phải chịu được.
3. **Đọc nhiều hơn ghi rất nhiều.** Sau khi công bố, mỗi trường có 1.500 học sinh và 90 giáo viên tra cứu — nhưng chỉ 2–3 người từng ghi dữ liệu.

Hệ quả: cần **co giãn được theo mùa** và **tách tải tính toán khỏi tải phục vụ web**. Đừng thiết kế cho tải trung bình.

---

## 2. Sơ đồ hệ thống

```
                         Cloudflare
                    (DNS · CDN · WAF · DDoS)
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        [Static/CDN]     [API Gateway]   [WebSocket]
         Web app           Nginx           Gateway
         (React SPA)         │                │
                             │                │
                    ┌────────┴────────┐       │
                    │                 │       │
              [API-1]  [API-2]  [API-3]       │
              NestJS   NestJS   NestJS        │
                    │                 │       │
                    └────────┬────────┘       │
                             │                │
         ┌───────────────────┼────────────────┴─────────┐
         │                   │                          │
   [PostgreSQL 16]      [Redis 7]              [Object Storage]
   Primary + Replica    cache · queue          S3-compatible
   PgBouncer            pub/sub · lock         file xuất · Excel gốc
         │                   │
         │            ┌──────┴──────┐
         │            │             │
    [Solver Worker] [Solver Worker] [Export Worker]
     Node + 1 lõi     Node + 1 lõi   Puppeteer
         │
    [CP-SAT Service]  ← chỉ khởi động khi cần
     Python/FastAPI
```

### 2.1 Vì sao tách từng thành phần

| Thành phần | Lý do tách |
|---|---|
| **Solver worker** | Vòng lặp CPU 60 giây sẽ chặn event loop của Node. Chạy chung với API là làm chết mọi request khác. Đây là bắt buộc, không phải tối ưu hoá. |
| **Export worker** | Puppeteer ngốn 200–400 MB RAM mỗi phiên bản trình duyệt. Để chung sẽ đẩy API vào vùng nguy hiểm về bộ nhớ. |
| **WebSocket gateway** | Kết nối dài hạn có mô hình co giãn khác hẳn request ngắn. Tách ra để triển khai lại API mà không ngắt kết nối của người đang xếp lịch. |
| **CP-SAT service** | Chỉ chạy khi heuristic thất bại — khoảng 5% số job. Giữ nó tắt và bật theo yêu cầu tiết kiệm đáng kể. |

### 2.2 Nơi đặt máy chủ

**Chọn: VPS tại Việt Nam** (Viettel IDC, VNG Cloud, hoặc Bizfly), không phải AWS Singapore.

| Tiêu chí | VN | Singapore |
|---|---|---|
| Độ trễ tới trường vùng sâu | 8–25 ms | 45–90 ms |
| Đường truyền khi đứt cáp quang biển | Không ảnh hưởng | Chập chờn nhiều tuần |
| Chi phí | Rẻ hơn 40–60% | |
| Xuất hoá đơn VAT cho trường công | Có | Phức tạp |
| Nghị định 13/2023 về dữ liệu cá nhân | Đơn giản | Cần thủ tục chuyển dữ liệu ra nước ngoài |

Yếu tố **đứt cáp quang biển** là quyết định. Việt Nam mất kết nối quốc tế ổn định vài lần mỗi năm, mỗi lần kéo dài 2–6 tuần. Một hệ thống đặt ở Singapore sẽ chậm và chập chờn đúng vào lúc trường học cần nó nhất — nếu trùng tháng 8.

Đối tượng lưu trữ (`Object Storage`) đặt cùng nhà cung cấp, có CDN Cloudflare phía trước.

---

## 3. Cấu hình theo giai đoạn

### 3.1 Giai đoạn thử nghiệm — 5 đến 20 trường

```
1 × VPS   8 vCPU / 16 GB / 200 GB SSD      ~2,5 triệu đ/tháng
  ├── Docker Compose: nginx, api, ws, 2 solver worker, export worker
  ├── PostgreSQL 16 (cùng máy)
  └── Redis 7 (cùng máy)

Sao lưu: S3-compatible, 100 GB          ~200 nghìn đ/tháng
Cloudflare Free
```

Một máy, Docker Compose, không Kubernetes. Ở quy mô này, độ phức tạp của điều phối container tốn nhiều thời gian hơn nó tiết kiệm.

### 3.2 Giai đoạn tăng trưởng — 50 đến 300 trường

```
2 × VPS ứng dụng    4 vCPU / 8 GB       ~1,8 triệu đ/tháng ×2
  └── api + ws (sau load balancer)

1 × VPS solver      8 vCPU / 16 GB      ~2,5 triệu đ/tháng
  └── 6 solver worker + 2 export worker

1 × PostgreSQL      4 vCPU / 16 GB / 500 GB   ~3 triệu đ/tháng
  └── + 1 replica đọc (bật theo mùa)

1 × Redis           2 vCPU / 4 GB       ~900 nghìn đ/tháng

Tổng thường xuyên: ~10 triệu đ/tháng
```

### 3.3 Co giãn theo mùa

Đây là điểm tiết kiệm lớn nhất. Máy solver và replica đọc **chỉ bật tháng 7–9 và 12–1**:

```yaml
# Kịch bản chạy theo lịch
mua_cao_diem:     # 01/07 → 30/09, 01/12 → 31/01
  solver_vps: 16 vCPU
  workers: 14
  read_replica: bật

mua_thap_diem:    # còn lại
  solver_vps: 4 vCPU
  workers: 3
  read_replica: tắt
```

Tiết kiệm khoảng **35% chi phí hạ tầng cả năm** mà không ảnh hưởng trải nghiệm — vì tháng 4 thực sự không ai xếp thời khoá biểu.

### 3.4 Bao nhiêu solver worker là đủ

Mỗi job chiếm trọn một lõi trong 30–90 giây. Với 200 trường:

- Mỗi trường chạy trung bình 8 job/mùa (thử nhiều lần rồi tinh chỉnh)
- Mùa cao điểm 60 ngày → 1.600 job
- Tập trung vào 15 ngày làm việc thực sự → ~110 job/ngày
- Giờ cao điểm 9h–11h chiếm 40% → ~44 job trong 2 giờ
- Mỗi job 60 giây → cần **~0,4 lõi trung bình**

Nhưng trung bình không phải điều đáng lo. Kịch bản xấu nhất: 20 trường bấm cùng lúc. Với 14 worker, 6 job phải chờ tối đa 60 giây — chấp nhận được nếu hàng đợi **hiển thị vị trí**:

> *Đang chờ — bạn ở vị trí thứ 3 trong hàng đợi. Ước tính bắt đầu sau khoảng 40 giây.*

Thông báo này quan trọng hơn việc mua thêm máy. Người dùng chịu được chờ nếu biết mình đang chờ gì.

---

## 4. Cơ sở dữ liệu

### 4.1 Gộp kết nối

PgBouncer ở chế độ `transaction`, đặt trước PostgreSQL:

```ini
[databases]
tkb = host=127.0.0.1 port=5432 dbname=tkb

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
server_reset_query = DISCARD ALL
```

**Cảnh báo quan trọng:** chế độ `transaction` khiến `SET LOCAL app.current_school_id` chỉ sống trong transaction — đúng như thiết kế RLS đang dùng. Nhưng nó **phá vỡ** prepared statement ở phía client. Với Prisma cần `?pgbouncer=true`; với Drizzle cần `prepare: false` trên driver `postgres.js`.

Đây là loại lỗi chỉ xuất hiện khi có tải, không xuất hiện lúc phát triển. Ghi rõ trong README.

### 4.2 Tách đọc/ghi

Các truy vấn chuyển sang replica:

- `GET /public/:slug/timetable` — trang công khai, lưu lượng lớn nhất
- `GET /me/timetable.ics`
- Mọi báo cáo và thống kê
- Solver worker nạp dữ liệu đầu vào

**Không** chuyển: `GET /grid` khi đang xếp (cần dữ liệu tức thời), mọi thao tác ghi.

Độ trễ sao chép thường dưới 100 ms nhưng có thể vọt lên vài giây khi ghi hàng loạt. Với trang công khai thì không sao; với lưới đang chỉnh sửa thì sẽ gây hiện tượng "tiết vừa kéo lại nhảy về chỗ cũ".

### 4.3 Bảo trì định kỳ

```sql
-- Bảng ghi nhiều, cần autovacuum quyết liệt hơn mặc định
ALTER TABLE lessons          SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE lesson_classes   SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE lesson_teachers  SET (autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE audit_logs       SET (autovacuum_vacuum_scale_factor = 0.05);
```

Bảng `lessons` bị `DELETE` + `INSERT` toàn bộ mỗi lần solver chạy — 1.300 dòng chết mỗi lần, 8 lần mỗi trường mỗi mùa. Với autovacuum mặc định (20%), bảng sẽ phình rất nhanh trong tháng 8.

**Phân vùng `audit_logs`** theo tháng ngay từ đầu:

```sql
CREATE TABLE audit_logs (...) PARTITION BY RANGE (created_at);
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
```

Xoá dữ liệu cũ bằng `DROP TABLE` phân vùng thay vì `DELETE` — tức thì thay vì hàng giờ.

---

## 5. Sao lưu và khôi phục

### 5.1 Vì sao đây là rủi ro tồn vong

Mất dữ liệu của một trường trong tháng 8 nghĩa là họ mất 8 giờ công nhập liệu vào đúng lúc bận nhất năm. Trường đó sẽ rời đi và kể lại chuyện này với mọi trường khác trong tỉnh. Ở thị trường mà quyết định mua hàng lan truyền qua các cuộc họp chuyên môn cấp sở, một sự cố như vậy đủ để chấm dứt sản phẩm.

### 5.2 Ba tầng

| Tầng | Công cụ | Tần suất | Giữ | Khôi phục |
|---|---|---|---|---|
| **Ghi log liên tục** | pgBackRest WAL archiving | Liên tục | 14 ngày | Về bất kỳ thời điểm nào (PITR) |
| **Ảnh chụp toàn bộ** | pgBackRest full backup | Hằng ngày 02:00 | 30 ngày | Toàn hệ thống |
| **Xuất theo trường** | Job riêng → S3 | Hằng tuần | 12 tháng | Từng trường độc lập |

Tầng thứ ba đặc thù cho SaaS đa khách hàng và thường bị bỏ quên. Kịch bản thực tế: **một trường tự xoá nhầm dữ liệu của mình**. Khôi phục toàn bộ cơ sở dữ liệu về hôm qua sẽ làm mất công việc của 199 trường còn lại.

```bash
# Xuất dữ liệu một trường, chạy hằng tuần
pg_dump --data-only \
  --table=schools --table=school_years --table=teachers ... \
  --where="school_id = '$SCHOOL_ID'" \
  | zstd -9 > s3://tkb-backup/schools/$SCHOOL_ID/$(date +%F).sql.zst
```

Cho phép `owner` tự tải bản sao lưu của trường mình từ trang Cài đặt. Vừa là tính năng an tâm, vừa là yêu cầu về quyền truy cập dữ liệu theo Nghị định 13/2023.

### 5.3 Mục tiêu khôi phục

| Chỉ số | Mục tiêu | Ý nghĩa |
|---|---|---|
| **RPO** (mất dữ liệu tối đa) | 5 phút | WAL archive mỗi 5 phút |
| **RTO** (thời gian phục hồi) | 2 giờ trong mùa cao điểm | Đã diễn tập, có kịch bản viết sẵn |

### 5.4 Diễn tập khôi phục

**Sao lưu chưa từng khôi phục thử không phải là sao lưu.** Đặt lịch tự động:

```
Mỗi tháng, 03:00 ngày 15:
  1. Dựng máy chủ tạm
  2. Khôi phục bản sao lưu mới nhất
  3. Chạy bộ kiểm tra tính toàn vẹn:
     - Đếm số trường, số tiết, số phân công
     - Đối chiếu với số liệu thực tế
     - Kiểm tra unique index còn hiệu lực
  4. Ghi lại thời gian khôi phục
  5. Huỷ máy chủ tạm
  6. Báo cáo qua Slack — thất bại thì báo động
```

Chi phí khoảng 30 nghìn đồng mỗi lần chạy. So với rủi ro thì không đáng kể.

---

## 6. Giám sát

### 6.1 Bộ công cụ

```
Ứng dụng  → OpenTelemetry SDK
             ├── số đo  → Prometheus → Grafana
             ├── vết    → Tempo (lấy mẫu 5%, 100% khi lỗi)
             └── nhật ký→ Loki

Cảnh báo  → Alertmanager → Zalo OA (khẩn) + Email (thường)
Lỗi       → Sentry (tự lưu trữ)
Ngoài hệ  → UptimeRobot, kiểm 60 giây một lần từ 3 điểm
```

**Cảnh báo khẩn gửi qua Zalo**, không phải email. Đội vận hành ở Việt Nam kiểm Zalo trong vòng vài phút, còn email thì có thể sáng hôm sau mới đọc.

### 6.2 Số đo riêng của lĩnh vực này

Số đo hạ tầng chung (CPU, RAM, tỉ lệ lỗi) là mặc định. Những số đo dưới đây mới cho biết sản phẩm có đang phục vụ tốt hay không:

```ts
// Solver
solver_job_duration_seconds{algorithm, school_size}   // histogram
solver_job_outcome_total{outcome}                     // succeeded|failed|cancelled|infeasible
solver_queue_depth
solver_queue_wait_seconds
solver_soft_score_per_100_lessons                     // chất lượng kết quả

// Lưới
grid_payload_bytes
grid_response_ms
lesson_move_total{result}                             // ok|soft_violation|blocked
lesson_move_blocked_total{reason}                     // teacher_overlap|class_overlap|...

// Onboarding — quan trọng nhất về mặt kinh doanh
import_rows_total{sheet, outcome}
import_error_rate{rule}                               // luật nào hay bị vi phạm nhất
onboarding_funnel{step}                               // đăng ký→nhập→phân công→xếp→công bố

// Vận hành
timetable_published_total
export_job_duration_seconds{kind, format}
websocket_connections
```

Số đo **`import_error_rate{rule}`** đáng chú ý đặc biệt. Nếu một luật kiểm tra bị vi phạm ở 60% số lần nhập, đó không phải người dùng sai — đó là luật của ta quá chặt hoặc thông báo lỗi không rõ. Số đo này chỉ thẳng vào chỗ cần sửa để giảm ma sát onboarding.

**`solver_soft_score_per_100_lessons`** theo dõi theo thời gian phát hiện được hồi quy chất lượng: nếu một lần triển khai làm điểm trung bình tăng từ 55 lên 78, có ai đó đã làm hỏng hàm chi phí mà không ai nhận ra vì phần mềm vẫn chạy bình thường.

### 6.3 Bảng điều khiển

**Bảng "Sức khoẻ mùa vụ"** — chỉ dùng tháng 7–9 và 12–1:

```
┌──────────────────────────────────────────────────────────┐
│  Trường đăng ký hôm nay        12    ▲ 3 so với hôm qua  │
│  Trường hoàn tất nhập liệu      8    (67% số đăng ký)    │
│  Trường đã công bố TKB          5                        │
│  ─────────────────────────────────────────────────────── │
│  Job solver đang chờ            3    Thời gian chờ TB 22s│
│  Worker đang bận             11/14                       │
│  Điểm mềm TB / 100 tiết         54   ✓ trong ngưỡng     │
│  ─────────────────────────────────────────────────────── │
│  Trường mắc kẹt ở bước nhập liệu > 48 giờ:   4  ← gọi họ│
└──────────────────────────────────────────────────────────┘
```

Dòng cuối là dòng có giá trị kinh doanh cao nhất: danh sách trường đã đăng ký nhưng đứng yên. Gọi điện cho họ trong tháng 8 là hành động giữ chân hiệu quả nhất mà không code dòng nào.

### 6.4 Ngưỡng cảnh báo

| Cảnh báo | Điều kiện | Mức |
|---|---|---|
| API 5xx | > 1% trong 5 phút | Khẩn |
| Độ trễ P95 `/grid` | > 800 ms trong 10 phút | Cảnh báo |
| Hàng đợi solver | > 25 job hoặc chờ > 5 phút | Cảnh báo |
| Solver thất bại | > 15% trong 1 giờ | Khẩn |
| Kết nối CSDL | > 80% pool | Cảnh báo |
| Độ trễ replica | > 30 giây | Cảnh báo |
| Đĩa | > 80% | Cảnh báo |
| Sao lưu | Không thành công trong 26 giờ | **Khẩn** |
| Diễn tập khôi phục | Thất bại | **Khẩn** |
| Chứng chỉ TLS | Còn < 14 ngày | Cảnh báo |

---

## 7. Triển khai

### 7.1 Quy trình

```
git push → GitHub Actions
  ├── lint · kiểm tra kiểu · unit test
  ├── integration test (Postgres + Redis trong container)
  ├── kiểm thử solver trên 4 bộ dữ liệu chuẩn      ← chặn nếu điểm xấu đi >10%
  ├── build image → registry
  └── deploy staging → smoke test → chờ duyệt tay → production
```

Bước kiểm thử solver là cổng chất lượng bắt buộc. Không có nó, một thay đổi nhỏ trong hàm chi phí có thể làm kết quả tệ đi 30% mà mọi bài kiểm thử khác vẫn xanh.

### 7.2 Triển khai luân phiên, không gián đoạn

```
API:     rolling update, health check /healthz, drain 30 giây
WS:      triển khai trước, client tự kết nối lại và resume bằng seq
Solver:  chờ job hiện tại xong (tối đa 120 giây) rồi mới thay
CSDL:    migration chỉ được cộng thêm — xem 7.3
```

### 7.3 Quy tắc migration

**Không bao giờ triển khai migration phá vỡ tương thích cùng lúc với code.** Chia hai lần phát hành:

```
Lần 1: thêm cột mới (nullable) · code ghi cả cột cũ lẫn mới
Lần 2: backfill dữ liệu
Lần 3: code chỉ đọc cột mới
Lần 4: xoá cột cũ
```

Chậm hơn nhưng cho phép quay lui bất kỳ lúc nào. Với sản phẩm mà dữ liệu là tài sản không thể tái tạo, khả năng quay lui đáng giá hơn tốc độ.

**Tuyệt đối không triển khai migration trong tháng 8.** Đóng băng thay đổi lược đồ từ 25/7 đến 30/9. Sửa lỗi vẫn triển khai bình thường; chỉ đóng băng phần cơ sở dữ liệu.

### 7.4 Cờ tính năng

```ts
if (await flags.enabled('solver.kempe_chain', schoolId)) { ... }
```

Bật dần theo trường, bắt đầu từ nhóm thử nghiệm. Cần thiết cho các thay đổi ở solver — nơi mà "hoạt động đúng" khó xác định bằng kiểm thử tự động và cần quan sát trên dữ liệu thật.

---

## 8. Bảo mật vận hành

| Hạng mục | Cách làm |
|---|---|
| Bí mật | Doppler hoặc HashiCorp Vault. Không bao giờ đưa vào biến môi trường trong repo. |
| TLS | Cloudflare đầu vào, chứng chỉ nội bộ giữa các dịch vụ |
| Mã hoá khi lưu | Toàn bộ ổ đĩa + `pgcrypto` cho cột nhạy cảm |
| Truy cập máy chủ | Chỉ SSH bằng khoá, qua bastion, xác thực hai yếu tố. Không mở port 5432 ra Internet. |
| Ghi nhận truy cập | Mọi truy vấn trực tiếp vào CSDL sản xuất đều ghi log và cảnh báo |
| Phụ thuộc | Dependabot + `npm audit` trong CI |
| Sao lưu | Mã hoá phía client trước khi tải lên, khoá lưu riêng khỏi hạ tầng |

---

## 9. Chi phí ước tính

| Quy mô | Hạ tầng/tháng | Doanh thu ước tính | Biên hạ tầng |
|---|---|---|---|
| 20 trường | 2,7 triệu đ | 20 × 200k = 4 triệu đ | 32% |
| 100 trường | 7 triệu đ | 100 × 200k = 20 triệu đ | 65% |
| 300 trường | 12 triệu đ | 300 × 200k = 60 triệu đ | 80% |

Chi phí hạ tầng không phải mối lo chính ở mô hình này — chi phí hỗ trợ khách hàng trong tháng 8 mới là gánh nặng thật. Mỗi cuộc gọi hỗ trợ 20 phút, 100 trường mới sẽ tạo ra vài trăm cuộc trong sáu tuần. Đây là lý do khoản đầu tư vào **nhập Excel tốt** và **thông báo lỗi rõ ràng** có tỉ suất hoàn vốn cao hơn bất kỳ tối ưu hạ tầng nào.

---

## 10. Lộ trình

| Giai đoạn | Nội dung | Thời gian |
|---|---|---|
| 1 | Docker Compose, một máy, sao lưu tự động | 3 ngày |
| 2 | CI/CD, staging, smoke test | 3 ngày |
| 3 | OpenTelemetry + Prometheus + Grafana + Sentry | 4 ngày |
| 4 | pgBackRest + PITR + kịch bản khôi phục | 2 ngày |
| 5 | Diễn tập khôi phục tự động | 2 ngày |
| 6 | Tách solver/export worker + BullMQ | 3 ngày |
| 7 | PgBouncer + replica đọc | 2 ngày |
| 8 | Cờ tính năng | 2 ngày |
| 9 | Bảng điều khiển mùa vụ + cảnh báo Zalo | 3 ngày |
| 10 | Kịch bản co giãn theo mùa | 2 ngày |

Tổng: khoảng **5 tuần**, nhưng chia làm hai đợt. Giai đoạn 1–5 phải xong **trước khi có khách hàng thật đầu tiên**. Giai đoạn 6–10 làm khi vượt 30 trường.
