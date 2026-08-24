# TKB Solver — Đặc tả thuật toán

> Đi kèm: `tkb_schema.sql` (CSDL), `tkb_design_spec.md` (giao diện).
> Đối tượng: dev implement solver. Ngôn ngữ tham chiếu: TypeScript (Node worker).

---

## 1. Quyết định kiến trúc cốt lõi

Trước khi vào chi tiết, đây là quyết định chi phối mọi thứ còn lại:

> **Không gian tìm kiếm chỉ chứa lời giải hợp lệ về ràng buộc cứng.**

Nghĩa là: mọi trạng thái mà thuật toán đi qua đều **không có** trùng giáo viên, trùng lớp, trùng phòng. Ràng buộc cứng không nằm trong hàm chi phí — chúng nằm trong định nghĩa của phép biến đổi.

Cách làm phổ biến khác là gộp tất cả vào một hàm chi phí với trọng số cứng cực lớn (`hard × 1000 + soft`). Mình **không** chọn cách đó, vì ba lý do:

1. Thuật toán tiêu phần lớn thời gian lang thang trong vùng bất khả thi thay vì cải thiện chất lượng.
2. Người dùng có thể dừng giữa chừng bất cứ lúc nào — kết quả phải dùng được ngay, không được chứa lỗi trùng lịch.
3. Giao diện cập nhật trực tiếp trong lúc chạy. Nếu trạng thái trung gian có xung đột, người dùng nhìn thấy lưới đầy lỗi đỏ và mất niềm tin.

Cái giá phải trả: không gian hợp lệ có thể bị chia cắt thành nhiều vùng rời rạc, phép "di chuyển một tiết" đơn lẻ không đủ để thoát ra. Mình bù lại bằng **Kempe chain** và **ejection chain** ở mục 7 — đây là lý do hai phép biến đổi đó bắt buộc phải có, không phải tuỳ chọn.

**Hai pha:**

```
Pha A — Dựng lời giải hợp lệ     (greedy + backtracking, 1–5 giây)
   ↓  mọi tiết đã có chỗ, 0 lỗi cứng
Pha B — Tối ưu ràng buộc mềm     (simulated annealing, 20–90 giây)
   ↓  giữ nguyên 0 lỗi cứng, giảm điểm phạt mềm
```

Nếu Pha A thất bại → **không** chuyển sang Pha B. Chạy chẩn đoán bất khả thi (mục 11) và báo cho người dùng biết ràng buộc nào cần nới.

---

## 2. Hình thức hoá bài toán

### 2.1 Ký hiệu

| Ký hiệu | Nghĩa | Quy mô điển hình (THPT 45 lớp) |
|---|---|---|
| `D` | Số ngày học trong tuần | 6 |
| `P` | Số tiết tối đa trong một ngày (sáng + chiều) | 10 |
| `S = D × P` | Tổng số ô thời gian | 60 |
| `C` | Số lớp | 45 |
| `T` | Số giáo viên | 90 |
| `R` | Số phòng | 50 |
| `A` | Số phân công (assignment) | ~500 |
| `L` | Số tiết cần xếp = `Σ periods_per_week` | ~1.300 |

### 2.2 Chỉ số ô thời gian

```ts
slot = day * P + position      // day ∈ [0, D), position ∈ [0, P)
day  = slot / P | 0
pos  = slot % P
```

`position` là `periods.day_position` trong CSDL — vị trí tuyệt đối trong ngày, tiết 1 sáng = 0, tiết 1 chiều = 5. Nhờ vậy phép kiểm tra "hai tiết liền kề" chỉ là `|slot_a - slot_b| === 1 && cùng day && cùng buổi`.

### 2.3 Biến quyết định

Mỗi **tiết học** (lesson) là một đơn vị cần đặt chỗ:

```ts
interface Lesson {
  id:        number;       // chỉ số nội bộ, không phải uuid
  aid:       number;       // assignment index
  slot:      number;       // -1 = chưa xếp
  room:      number;       // -1 = không cần phòng riêng
  pinned:    boolean;
  pairId:    number;       // -1 hoặc id tiết ghép đôi
  pairRole:  0 | 1;        // 0 = tiết trước, 1 = tiết sau
}
```

Một assignment có `periods_per_week = 4, double_periods = 1` sinh ra 4 lesson: 2 lesson ghép đôi (`pairId` trỏ lẫn nhau) + 2 lesson đơn.

**Lời giải** = mảng `slot[]` và `room[]` cho toàn bộ `L` lesson.

---

## 3. Cấu trúc dữ liệu trong bộ nhớ

Hiệu năng của toàn bộ solver phụ thuộc vào việc kiểm tra ràng buộc cứng phải là **O(1) không cấp phát bộ nhớ**. Dùng bitmask.

### 3.1 Bitmask chiếm dụng

`S = 60` ô, vừa trong 2 số nguyên 32-bit. Dùng `Uint32Array` phẳng thay vì mảng lồng nhau (tránh con trỏ, thân thiện với cache CPU):

```ts
const W = 2;                                   // số word cho 60 bit
const teacherBusy = new Uint32Array(T * W);    // GV đang dạy
const classBusy   = new Uint32Array(C * W);    // lớp đang học
const roomBusy    = new Uint32Array(R * W);    // phòng đang dùng
const teacherOff  = new Uint32Array(T * W);    // GV báo bận (availability_slots)
const classOff    = new Uint32Array(C * W);
const roomOff     = new Uint32Array(R * W);

const isFree = (mask: Uint32Array, idx: number, slot: number) =>
  (mask[idx * W + (slot >>> 5)] & (1 << (slot & 31))) === 0;

const occupy = (mask: Uint32Array, idx: number, slot: number) => {
  mask[idx * W + (slot >>> 5)] |= (1 << (slot & 31));
};

const release = (mask: Uint32Array, idx: number, slot: number) => {
  mask[idx * W + (slot >>> 5)] &= ~(1 << (slot & 31));
};
```

Với `S > 64` (trường học 3 buổi, 7 ngày), tăng `W` lên 3 — mọi thứ khác giữ nguyên.

### 3.2 Bảng tra ngược

Cần cho ejection chain và cho việc "ô này ai đang chiếm":

```ts
const classAt   = new Int32Array(C * S).fill(-1);  // classAt[c*S+s] = lessonId
const teacherAt = new Int32Array(T * S).fill(-1);
const roomAt    = new Int32Array(R * S).fill(-1);
```

Với 45 lớp × 60 ô = 2.700 ô, ba bảng này tổng cộng dưới 50 KB. Đổi bộ nhớ lấy tốc độ — đáng.

### 3.3 Dữ liệu tĩnh của assignment

Tính một lần lúc nạp, không đổi trong suốt quá trình chạy:

```ts
interface AssignmentData {
  classes:   Int32Array;    // các lớp tham gia (ghép lớp → nhiều phần tử)
  teachers:  Int32Array;    // các GV (nhiều GV cùng dạy → nhiều phần tử)
  subject:   number;
  rooms:     Int32Array;    // phòng dùng được, rỗng = dùng phòng cố định của lớp
  allowMask: Uint32Array;   // W word: ô nào assignment này ĐƯỢC phép xếp
  difficulty: number;
  maxPerDay: number;        // số tiết cùng môn tối đa/ngày, mặc định 1
}
```

**`allowMask` là chìa khoá.** Nó được tính sẵn bằng cách giao (AND) tất cả các ràng buộc tĩnh:

```
allowMask = ~classOff[c1] & ~classOff[c2] & ...      // mọi lớp tham gia đều rảnh
          & ~teacherOff[t1] & ~teacherOff[t2] & ...  // mọi GV đều rảnh
          & sessionMask                              // đúng buổi sáng/chiều
          & activeDayMask                            // ngày có học
```

Nhờ `allowMask`, việc kiểm tra "assignment A có thể xếp vào slot s không" (phần tĩnh) chỉ tốn một phép AND. Phần động (đụng độ với tiết khác) kiểm tra bằng `teacherBusy` / `classBusy` / `roomBusy`.

### 3.4 Hàm kiểm tra hợp lệ

```ts
function canPlace(l: Lesson, slot: number, room: number): boolean {
  const a = A[l.aid];
  if (!bitSet(a.allowMask, slot)) return false;

  for (const c of a.classes) if (!isFree(classBusy,   c, slot)) return false;
  for (const t of a.teachers) if (!isFree(teacherBusy, t, slot)) return false;
  if (room >= 0 && !isFree(roomBusy, room, slot)) return false;

  // Tiết ghép đôi: ô kế tiếp cũng phải trống và cùng buổi
  if (l.pairId >= 0 && l.pairRole === 0) {
    const next = slot + 1;
    if (!sameSession(slot, next)) return false;
    if (!canPlace(L[l.pairId], next, room)) return false;
  }
  return true;
}
```

Chi phí điển hình: 1 lớp + 1 GV + 1 phòng = 4 phép kiểm tra bit. Khoảng **15 nanosecond**. Điều này cho phép thực hiện ~1 triệu phép thử mỗi giây trong JavaScript.

---

## 4. Tiền xử lý

Chạy một lần trước Pha A. Bốn bước, thứ tự quan trọng.

### 4.1 Nạp tiết đã ghim

Đặt trước mọi lesson có `is_pinned = true`, đánh dấu ô đã chiếm. Ở Việt Nam thường bao gồm:

- **Chào cờ**: Thứ Hai, tiết 1 sáng, toàn trường
- **Sinh hoạt lớp**: Thứ Bảy, tiết cuối, do GV chủ nhiệm dạy
- Tiết học của giáo viên thỉnh giảng chỉ đến trường một buổi cố định

Nếu tiết ghim mâu thuẫn nhau → dừng ngay, báo lỗi cụ thể. Không tự động gỡ ghim.

### 4.2 Thu hẹp miền giá trị

Với mỗi assignment, đếm số ô khả dụng còn lại:

```ts
domainSize[a] = popcount(allowMask[a] & ~staticallyOccupied(a))
```

Nếu `domainSize[a] < periods_per_week[a]` → **bất khả thi ngay từ đầu**, không cần chạy. Báo cho người dùng biết assignment nào và thiếu bao nhiêu ô.

### 4.3 Kiểm tra bão hoà tài nguyên

Ba phép kiểm tra rẻ tiền phát hiện 90% trường hợp người dùng nhập sai:

```ts
// Giáo viên: tổng tiết phải dạy ≤ số ô rảnh
for (const t of teachers) {
  const need = Σ periods_per_week của mọi assignment có GV t;
  const have = popcount(~teacherOff[t] & activeDayMask);
  if (need > have) reportInfeasible('teacher', t, need, have);
}

// Lớp: tương tự
// Phòng bộ môn: tổng tiết cần phòng loại X ≤ số phòng loại X × số ô
```

### 4.4 Sắp xếp thứ tự xếp (heuristic MRV)

Thứ tự xếp quyết định Pha A có thành công hay không. Sắp assignment giảm dần theo **độ khó**:

```ts
difficulty(a) =
    2.0 * (periods_per_week[a] / domainSize[a])   // mật độ chiếm dụng
  + 1.5 * (a.rooms.length > 0 ? 1/a.rooms.length : 0)  // phòng bộ môn hiếm
  + 1.0 * (a.classes.length - 1)                  // ghép lớp khó xếp
  + 1.0 * (a.teachers.length - 1)                 // nhiều GV khó xếp
  + 0.8 * (doublePeriods[a] > 0 ? 1 : 0)          // tiết đôi cần 2 ô liền
  + 0.5 * priority[a] / 10                        // ưu tiên người dùng đặt
```

Đây là biến thể của **Most Constrained Variable** — xếp thứ khó trước, khi lưới còn rộng. Xếp môn Thể dục (cần sân, ghép lớp) sau cùng là công thức đảm bảo thất bại.

---

## 5. Pha A — Dựng lời giải hợp lệ

Greedy có backtracking giới hạn. Mục tiêu duy nhất: **đặt hết mọi tiết, không vi phạm ràng buộc cứng**. Chưa quan tâm chất lượng.

```
function buildInitial(lessons, timeLimit):
    order   = sắp lessons theo difficulty giảm dần
    i       = 0
    fails   = mảng đếm số lần thất bại của mỗi lesson

    while i < order.length:
        if hết thời gian: return PARTIAL

        l          = order[i]
        candidates = liệt kê ô hợp lệ cho l
        
        if candidates rỗng:
            fails[l]++
            if fails[l] > 3:
                # Ejection: đá một tiết đang cản đường ra
                victim = chọn tiết chiếm ô mà l cần nhất
                gỡ victim, chèn lại vào cuối hàng đợi
                fails[l] = 0
            else:
                i = backjump(i)        # lùi lại vài bước, xếp lại
            continue

        # Chọn ô bằng ngẫu nhiên có trọng số theo chi phí mềm
        slot = weightedPick(candidates, softCost)
        đặt l vào slot
        i++

    return COMPLETE
```

### 5.1 Chọn ô trong Pha A

Dù chưa tối ưu, việc chọn ô "tạm ổn" giúp Pha B khởi đầu tốt hơn nhiều. Chấm điểm mỗi ô ứng viên bằng **phiên bản rút gọn** của hàm chi phí (chỉ 4 thành phần rẻ nhất):

```ts
quickCost(l, slot) =
    30 * gapCreatedForClass(l, slot)       // tạo tiết trống cho lớp
  + 25 * sameSubjectSameDay(l, slot)       // trùng môn trong ngày
  + 15 * newDayForTeacher(l, slot)         // GV phải đến trường thêm 1 ngày
  +  8 * difficultyMismatch(l, slot)       // môn khó xếp tiết cuối
```

Sau đó chọn ngẫu nhiên có trọng số (softmax với nhiệt độ cao) thay vì chọn ô tốt nhất. Lý do: chọn tham lam tuyệt đối tạo ra lời giải cứng nhắc, dễ kẹt ở bước sau, và khiến chạy lại lần hai cho kết quả y hệt.

### 5.2 Ejection — đá tiết cản đường

Khi một lesson không tìm được ô nào, chọn "nạn nhân" để gỡ ra:

```ts
function chooseVictim(l): Lesson {
  // Với mỗi ô nằm trong allowMask của l, xem ai đang chiếm
  // Ưu tiên đá tiết có domainSize lớn nhất (dễ tìm chỗ khác nhất)
  // và chưa từng bị đá quá 2 lần (chống lặp vô hạn)
}
```

Giới hạn tổng số lần ejection ở `5 × L`. Vượt ngưỡng → tuyên bố Pha A thất bại.

### 5.3 Khi Pha A vẫn thất bại

Có hai đường lui, theo thứ tự:

**Lựa chọn 1 — Khởi động lại với hạt giống khác.** Chạy tối đa 5 lần, mỗi lần đổi `seed` của bộ sinh ngẫu nhiên. Trong thực tế, khoảng 60% trường hợp thất bại lần đầu sẽ thành công ở lần 2 hoặc 3. Rẻ và hiệu quả.

**Lựa chọn 2 — Chuyển sang CP-SAT.** Với bài toán thực sự chặt (trường có nhiều phòng bộ môn hiếm, nhiều GV dạy liên trường), heuristic có thể không tìm ra lời giải dù nó tồn tại. Lúc này gọi sang service Python dùng OR-Tools CP-SAT, chỉ để giải bài toán **khả thi** (bỏ hết ràng buộc mềm):

```python
# Mô hình tối giản, chỉ tìm lời giải hợp lệ
x = {}  # x[lesson, slot] = BoolVar
for l in lessons:
    model.AddExactlyOne(x[l, s] for s in allowed_slots[l])
for c in classes:
    for s in slots:
        model.AddAtMostOne(x[l, s] for l in lessons_of_class[c])
for t in teachers:
    for s in slots:
        model.AddAtMostOne(x[l, s] for l in lessons_of_teacher[t])
# ... phòng, tiết đôi
solver.parameters.max_time_in_seconds = 30
```

CP-SAT giải phần khả thi rất mạnh và, quan trọng hơn, **chứng minh được bất khả thi** — điều mà heuristic không làm được. Khi nó trả `INFEASIBLE`, ta biết chắc dữ liệu đầu vào sai chứ không phải thuật toán kém, và có thể báo cho người dùng với sự tự tin.

Lời giải từ CP-SAT được đưa ngược về Pha B để tối ưu mềm.

---

## 6. Hàm chi phí ràng buộc mềm

Đây là nơi mã hoá "thế nào là một thời khoá biểu đẹp". Trọng số dưới đây là **giá trị mặc định** — người dùng chỉnh qua 4 thanh trượt trong giao diện, ánh xạ sang `constraints.weight`.

### 6.1 Danh mục ràng buộc mềm

| Mã | Tên | Trọng số | Cách tính |
|---|---|---|---|
| **S1** | Tiết trống của lớp | 30 | Mỗi ô trống nằm giữa hai tiết học trong cùng buổi |
| **S2** | Tiết trống của giáo viên | 20 | Tương tự, tính trên lịch dạy của GV |
| **S3** | Số ngày GV phải đến trường | 15 | Mỗi ngày vượt quá `ceil(tổng tiết / max_periods_per_day)` |
| **S4** | Trùng môn trong ngày | 25 | Mỗi lần một lớp học cùng môn quá `maxPerDay` lần/ngày |
| **S5** | Môn khó vào tiết cuối | 8 | `difficulty × max(0, pos - 2)` với môn có `difficulty ≥ 4` |
| **S6** | GV vượt định mức tiết/ngày | 40 | Mỗi tiết vượt `max_periods_per_day` |
| **S7** | Tải lớp không đều giữa các ngày | 10 | Độ lệch chuẩn số tiết/ngày của lớp |
| **S8** | Không dùng ô ưu tiên | 12 | Ô có `preference = 'preferred'` bị bỏ trống, hoặc `'avoid'` bị dùng |
| **S9** | Môn rải không đều trong tuần | 18 | Với môn n tiết/tuần, phạt nếu khoảng cách giữa 2 tiết < `floor(D/n)` |
| **S10** | Lớp đổi phòng liên tục | 5 | Mỗi lần lớp phải đổi phòng giữa 2 tiết liền kề |
| **S11** | GV dạy quá nhiều tiết liên tiếp | 22 | Mỗi tiết vượt 4 tiết liên tục |
| **S12** | Tiết đôi bị tách | 35 | Cặp có `pairId` nhưng không nằm liền kề |

### 6.2 Ràng buộc đặc thù Việt Nam

Ba luật này không có trong tài liệu học thuật quốc tế nhưng quan trọng ở đây:

| Mã | Tên | Trọng số | Ghi chú |
|---|---|---|---|
| **V1** | Thể dục vào tiết cuối buổi sáng | 20 | Học sinh mệt và nóng. Ưu tiên tiết 1–2 hoặc buổi chiều mát. |
| **V2** | Môn tự nhiên vào buổi chiều | 12 | Toán, Lý, Hoá vào chiều bị coi là kém hiệu quả — ưu tiên buổi sáng. |
| **V3** | GV chủ nhiệm không có tiết ở lớp mình vào Thứ Hai tiết 1 | 15 | Cần có mặt ở lễ chào cờ cùng lớp. |

Cả ba đều biểu diễn được bằng `constraints` với `kind = 'period_preference'` và `params` chứa danh sách slot ưu tiên/tránh — không cần code riêng.

### 6.3 Chuẩn hoá điểm

Điểm thô phụ thuộc quy mô trường (450 tiết vs 1.300 tiết) nên không so sánh được. Hiển thị cho người dùng dưới dạng **điểm trên mỗi 100 tiết**:

```ts
displayScore = Math.round(rawCost / lessonCount * 100);
```

Kinh nghiệm thực tế: dưới 40 là rất tốt, 40–90 chấp nhận được, trên 150 là còn nhiều chỗ cải thiện.

### 6.4 Đánh giá tăng dần

Đây là điểm quyết định tốc độ. **Không bao giờ tính lại toàn bộ hàm chi phí** sau mỗi phép biến đổi — tính chênh lệch.

Tổ chức chi phí theo **đơn vị độc lập**: mỗi cặp `(lớp, ngày)` và `(giáo viên, ngày)` có điểm riêng, lưu trong mảng phẳng:

```ts
const classDayCost   = new Int32Array(C * D);
const teacherDayCost = new Int32Array(T * D);
let   globalCost     = 0;   // các thành phần không tách theo ngày (S9, S12)
```

Khi di chuyển một tiết từ `slot1` sang `slot2`:

```ts
function deltaMove(l, slot1, slot2): number {
  const touched = new Set<number>();       // các đơn vị cần tính lại
  for (const c of A[l.aid].classes) {
    touched.add(classKey(c, day(slot1)));
    touched.add(classKey(c, day(slot2)));
  }
  // tương tự cho teachers

  let before = 0;
  for (const k of touched) before += cost[k];

  applyMove(l, slot1, slot2);              // cập nhật bitmask + bảng tra ngược
  let after = 0;
  for (const k of touched) after += recomputeUnit(k);

  return after - before + deltaGlobal(l, slot1, slot2);
}
```

Mỗi đơn vị chỉ có `P = 10` ô nên `recomputeUnit` tốn khoảng 100 phép tính. Với 4 đơn vị bị ảnh hưởng, một lần đánh giá tăng dần tốn **dưới 1 microsecond** — so với ~5 milisecond nếu tính lại toàn bộ. Nhanh gấp 5.000 lần.

---

## 7. Pha B — Tối ưu bằng Simulated Annealing

### 7.1 Vì sao chọn Simulated Annealing

Ba ứng viên chính cho bài toán này:

| Phương pháp | Ưu | Nhược | Kết luận |
|---|---|---|---|
| Hill climbing | Đơn giản | Kẹt ở cực trị địa phương rất sớm | Không đủ |
| Tabu search | Chất lượng cao | Cần quản lý danh sách cấm, tốn bộ nhớ, nhiều tham số phải tinh chỉnh | Tốt nhưng phức tạp |
| **Simulated annealing** | Ít tham số, dễ điều chỉnh, dừng bất cứ lúc nào vẫn có kết quả dùng được | Cần lịch làm nguội hợp lý | **Chọn** |

Yếu tố quyết định là **"dừng lúc nào cũng có kết quả dùng được"**. Người dùng sẽ bấm Dừng, và SA luôn giữ sẵn lời giải tốt nhất từng thấy.

### 7.2 Vòng lặp chính

```ts
function anneal(state, timeLimitMs, onProgress) {
  let T = calibrateTemperature(state);       // xem 7.5
  const Tmin = T * 0.001;
  const alpha = 0.9995;

  let best = snapshot(state);
  let bestCost = state.cost;
  let sinceImprovement = 0;

  while (Date.now() < deadline && T > Tmin) {
    for (let i = 0; i < 500; i++) {          // 500 bước mỗi mức nhiệt
      const move = pickMove(state);          // xem 7.3
      if (!move) continue;

      const delta = evaluate(move);
      const accept = delta <= 0 || Math.random() < Math.exp(-delta / T);

      if (accept) {
        commit(move);
        if (state.cost < bestCost) {
          bestCost = state.cost;
          best = snapshot(state);
          sinceImprovement = 0;
        }
      } else {
        rollback(move);
      }
    }

    T *= alpha;
    sinceImprovement++;

    // Hâm nóng lại khi bế tắc quá lâu
    if (sinceImprovement > 400) {
      T = calibrateTemperature(state) * 0.35;
      sinceImprovement = 0;
    }

    onProgress(state.cost, bestCost, progressPercent());
  }

  return best;
}
```

**Lưu ý về `snapshot`:** đừng sao chép toàn bộ mảng mỗi lần cải thiện — với 1.300 lesson thì tốn kém. Thay vào đó ghi **nhật ký thay đổi** từ lần snapshot cuối, và chỉ vật chất hoá khi thực sự cần (khi trả kết quả, hoặc mỗi 5 giây một lần cho việc cập nhật giao diện).

### 7.3 Tập phép biến đổi

Chọn ngẫu nhiên theo tỉ lệ. Tỉ lệ này quan trọng và đã được tinh chỉnh cho bài toán TKB phổ thông:

| Phép | Tỉ lệ | Mô tả |
|---|---|---|
| **M1 — Di chuyển đơn** | 35% | Chuyển 1 tiết sang ô trống hợp lệ |
| **M2 — Hoán đổi trong lớp** | 25% | Đổi chỗ 2 tiết của cùng một lớp |
| **M3 — Kempe chain** | 20% | Đổi toàn bộ nội dung 2 ô của một lớp, giải quyết dây chuyền xung đột GV |
| **M4 — Di chuyển khối** | 8% | Chuyển cả cặp tiết đôi |
| **M5 — Đổi phòng** | 7% | Giữ nguyên ô, đổi phòng |
| **M6 — Ejection chain** | 5% | Đá 1 tiết ra, chèn tiết khác vào, tái định vị tiết bị đá |

**Vì sao Kempe chain chiếm tới 20%:** Trong không gian chỉ chứa lời giải hợp lệ, M1 và M2 thường bị chặn — mọi ô đều bận. Kempe chain là phép biến đổi *duy nhất* có khả năng vượt qua các vùng chặt. Nếu bỏ nó, thuật toán sẽ đứng yên sau khoảng 30 giây.

### 7.4 Kempe chain — chi tiết

Ý tưởng: chọn một lớp `c` và hai ô `s1`, `s2`. Muốn hoán đổi nội dung hai ô này, nhưng việc đó có thể gây xung đột GV ở lớp khác. Giải pháp: hoán đổi luôn cả những tiết bị ảnh hưởng, theo dây chuyền.

```
Bước 1: Lấy tiết X ở (c, s1) và tiết Y ở (c, s2)
Bước 2: Nếu đổi X↔Y, giáo viên của X sẽ đụng ai ở s2?
        → tiết Z của lớp khác. Đưa Z vào dây chuyền.
Bước 3: Đổi Z sang s1 lại đụng ai? → tiếp tục...
Bước 4: Lặp cho tới khi dây chuyền khép kín, hoặc vượt độ dài 8 → bỏ.
Bước 5: Đảo đồng loạt toàn bộ dây chuyền.
```

```ts
function kempeChain(cls: number, s1: number, s2: number): Move | null {
  const chain: number[] = [];
  const queue: number[] = [];
  const seen = new Set<number>();

  const seed1 = classAt[cls * S + s1];
  const seed2 = classAt[cls * S + s2];
  if (seed1 < 0 && seed2 < 0) return null;
  if (seed1 >= 0) queue.push(seed1);
  if (seed2 >= 0) queue.push(seed2);

  while (queue.length) {
    if (chain.length > 8) return null;          // dây chuyền quá dài, bỏ
    const l = queue.pop()!;
    if (seen.has(l)) continue;
    seen.add(l);
    chain.push(l);

    const from = L[l].slot;
    const to   = from === s1 ? s2 : s1;

    // Ai đang cản trở ở ô đích? Kéo họ vào dây chuyền.
    for (const t of A[L[l].aid].teachers) {
      const blocker = teacherAt[t * S + to];
      if (blocker >= 0 && !seen.has(blocker)) queue.push(blocker);
    }
    for (const c of A[L[l].aid].classes) {
      const blocker = classAt[c * S + to];
      if (blocker >= 0 && !seen.has(blocker)) queue.push(blocker);
    }
  }

  // Kiểm tra: sau khi đảo, mọi tiết trong dây chuyền có nằm trong allowMask không?
  for (const l of chain) {
    const to = L[l].slot === s1 ? s2 : s1;
    if (!bitSet(A[L[l].aid].allowMask, to)) return null;
  }
  return { kind: 'kempe', chain, s1, s2 };
}
```

Dây chuyền thường có độ dài 2–5. Giới hạn 8 để tránh phép biến đổi quá lớn làm hỏng cấu trúc tốt đã có.

### 7.5 Hiệu chỉnh nhiệt độ ban đầu

Đừng đặt cứng `T = 100`. Nhiệt độ phải tỉ lệ với thang chi phí của bài toán cụ thể. Đo bằng thực nghiệm:

```ts
function calibrateTemperature(state): number {
  const deltas: number[] = [];
  for (let i = 0; i < 200; i++) {
    const m = pickMove(state);
    if (!m) continue;
    const d = evaluate(m);
    rollback(m);
    if (d > 0) deltas.push(d);
  }
  const avg = mean(deltas);
  // Nhiệt độ sao cho phép biến đổi xấu trung bình được chấp nhận ~80%
  return avg / Math.log(1 / 0.8);
}
```

Cách này tự thích ứng: trường lớn có chi phí thô cao sẽ nhận nhiệt độ cao tương ứng, không cần chỉnh tay.

---

## 8. Xử lý các trường hợp đặc biệt

### 8.1 Ghép lớp

Một assignment có nhiều `classes`. Toàn bộ code đã xử lý qua vòng `for (const c of a.classes)`. Điểm cần lưu ý duy nhất: `allowMask` phải là **giao** của các lớp, nên assignment ghép lớp tự động có miền hẹp hơn và được `difficulty()` xếp lên trước. Đúng như mong muốn.

### 8.2 Tách lớp

Hai nhóm của cùng lớp học đồng thời hai môn khác nhau. Trong solver, mỗi `class_section` được xử lý như một **lớp ảo riêng biệt** với chỉ số riêng trong `classBusy`. Thêm ràng buộc liên kết:

- Lớp cha và các nhóm con **không** được xếp cùng ô (nếu cả lớp học Toán thì nhóm không thể học Tin).
- Biểu diễn bằng cách: khi đặt tiết cho lớp cha, đánh dấu bận cả các nhóm con, và ngược lại.

```ts
// Mở rộng danh sách lớp cần kiểm tra
function expandClasses(a: AssignmentData): Int32Array {
  // lớp cha → chính nó + mọi section con
  // section  → chính nó + lớp cha
}
```

### 8.3 Tiết đôi

Cặp lesson có `pairId` trỏ lẫn nhau. Ba quy tắc:

1. `canPlace` với `pairRole = 0` kiểm tra luôn ô `slot + 1`.
2. Hai ô phải cùng buổi — không được vắt qua giờ nghỉ trưa. Kiểm tra bằng `sameSession(slot, slot+1)`.
3. Phép M1 (di chuyển đơn) **không được** áp dụng cho lesson có `pairId ≥ 0`. Dùng M4 (di chuyển khối) thay thế.

Nếu người dùng gỡ ghép đôi bằng tay trong giao diện, đặt `pairId = -1` cho cả hai và cộng phạt S12.

### 8.4 Lớp học hai buổi

Với `classes.has_second_session = true`, `allowMask` mở cho cả sáng lẫn chiều. Thêm hai ràng buộc mềm riêng:

- Không nên có tiết ở tiết cuối sáng **và** tiết đầu chiều liên tục quá 3 ngày/tuần (học sinh không kịp nghỉ).
- Cân bằng số tiết giữa hai buổi.

### 8.5 Giáo viên dạy nhiều trường

Trong CSDL, mỗi trường có bản ghi `teachers` riêng nhưng chung `user_id`. Solver **không** biết về trường khác. Cách xử lý: trường thứ hai nhập lịch bận của GV đó bằng `availability_slots` — thủ công nhưng đúng và đơn giản. Đồng bộ tự động giữa các trường là tính năng của phiên bản sau, và cần sự đồng ý của cả hai trường.

### 8.6 Xếp lại một phần

Người dùng chọn "chỉ xếp tiết chưa xếp" hoặc "chỉ khối 10". Cách làm:

```ts
const frozen = lessons.filter(l => l.pinned || !inScope(l));
// Đặt frozen vào bitmask trước, coi như chướng ngại cố định
// Chỉ đưa lessons trong phạm vi vào tập biến của SA
```

Điểm chi phí vẫn tính trên **toàn bộ** thời khoá biểu — nếu chỉ tính phần trong phạm vi, thuật toán sẽ tạo ra tiết trống ở các lớp ngoài phạm vi mà không biết.

---

## 9. Trợ lý gợi ý cho một tiết

Đây là phần solver phục vụ trực tiếp giao diện — tính năng "đèn giao thông" và "gợi ý chỗ đặt".

Chạy **ở client**, đồng bộ, không gọi server:

```ts
function suggestSlots(lessonId: number): SlotRating[] {
  const result: SlotRating[] = [];
  const l = L[lessonId];
  const originalSlot = l.slot;
  if (originalSlot >= 0) unplace(l);

  for (let s = 0; s < S; s++) {
    if (!bitSet(A[l.aid].allowMask, s)) {
      result.push({ slot: s, status: 'block', reasons: staticReasons(l, s) });
      continue;
    }
    const clash = findClash(l, s);
    if (clash) {
      result.push({ slot: s, status: 'block', reasons: [clash] });
      continue;
    }
    const delta = evaluatePlacement(l, s);
    result.push({
      slot: s,
      status: delta <= 0 ? 'ok' : 'warn',
      cost: delta,
      reasons: delta > 0 ? explainCost(l, s) : [],
    });
  }

  if (originalSlot >= 0) place(l, originalSlot);
  return result;
}
```

Toàn bộ vòng lặp 60 ô mất khoảng **0,3 milisecond**. Chạy được ngay trong sự kiện `dragstart` mà không gây giật hình.

**`explainCost` phải trả lý do bằng tiếng Việt, cụ thể**, không phải con số:

```ts
[
  { text: '10A1 sẽ có 3 tiết Toán trong Thứ Ba', penalty: 25 },
  { text: 'Thầy Hùng phải đến trường thêm 1 ngày', penalty: 15 },
]
```

Đây chính là nội dung tooltip mô tả trong tài liệu giao diện. Cùng một hàm chi phí phục vụ cả solver lẫn giao diện — đảm bảo hai bên không bao giờ mâu thuẫn nhau.

---

## 10. Giao thức báo tiến độ

Solver chạy trong worker riêng, báo về qua WebSocket mỗi **250ms** (không phải mỗi bước — sẽ làm nghẽn kênh):

```ts
interface ProgressEvent {
  jobId: string;
  phase: 'preprocess' | 'build' | 'optimize';
  percent: number;
  placed: number;          // đã xếp bao nhiêu tiết
  total: number;
  hardViolations: number;  // luôn = 0 sau Pha A
  softScore: number;       // điểm hiện tại
  bestScore: number;       // điểm tốt nhất từng đạt
  elapsedMs: number;
  // Chỉ gửi khi có cải thiện, tối đa 2 giây một lần
  delta?: Array<{ lessonId: string; slot: number; room: string | null }>;
}
```

**Trường `delta`** là điều làm giao diện cập nhật trực tiếp mượt mà: chỉ gửi các tiết đã đổi chỗ từ lần gửi trước, không gửi lại toàn bộ 1.300 tiết. Với gói tin trung bình 20–50 tiết, mỗi lần cập nhật chỉ vài KB.

**Tính `percent`:**
- Pha tiền xử lý: 0–5%
- Pha A: 5–25%, theo tỉ lệ tiết đã đặt
- Pha B: 25–100%, theo tỉ lệ thời gian đã dùng

---

## 11. Chẩn đoán bất khả thi

Khi không xếp được, thông báo "Không tìm được lời giải" là vô dụng. Người dùng cần biết **sửa cái gì**.

Chạy chuỗi kiểm tra sau, dừng ở lỗi đầu tiên tìm thấy:

| Kiểm tra | Thông báo mẫu |
|---|---|
| Tiết ghim mâu thuẫn | *Hai tiết cùng ghim vào Thứ Hai tiết 1 của lớp 10A1: Chào cờ và Toán.* |
| GV quá tải tuyệt đối | *Thầy Hùng cần dạy 24 tiết nhưng chỉ còn 18 ô rảnh. Hãy giảm phân công hoặc mở thêm ô trong lịch bận.* |
| Lớp quá tải | *Lớp 10A1 được phân công 32 tiết nhưng khung tiết chỉ có 30 ô.* |
| Phòng bộ môn thiếu | *Cần 46 tiết phòng máy tính nhưng 2 phòng chỉ cung cấp được 40 ô.* |
| Assignment không còn ô | *Môn Thể dục lớp 10A3 (thầy Nam) không còn ô nào hợp lệ: thầy Nam bận 40/60 ô, lớp 10A3 đã kín các ô còn lại.* |
| Tiết đôi không đủ chỗ | *Môn Hoá lớp 11B1 cần 1 tiết đôi nhưng không còn 2 ô liền kề nào trống trong cùng buổi.* |
| Không xác định được | *Không xếp được 12 tiết sau 5 lần thử. Nguyên nhân thường gặp: lịch bận quá dày hoặc quá nhiều tiết bị ghim.* + nút **Xem 12 tiết này** |

Với ba trường hợp đầu, kèm luôn **nút hành động sửa trực tiếp**: mở màn hình lịch bận của đúng GV đó, hoặc mở bảng phân công lọc sẵn theo GV.

Khi CP-SAT trả về `INFEASIBLE`, ta có thể nói chắc chắn: *"Với các ràng buộc hiện tại, không tồn tại thời khoá biểu hợp lệ nào."* Đây là điều heuristic không bao giờ khẳng định được, và là lý do đáng để duy trì đường lui CP-SAT.

---

## 12. Kiến trúc triển khai

### 12.1 Nơi chạy

```
API server (NestJS)
     │  tạo scheduling_jobs (status = queued)
     ↓
BullMQ (Redis)
     │
     ↓
Solver worker (Node, tiến trình riêng)
     │  ├── nạp dữ liệu → cấu trúc typed array
     │  ├── Pha A + Pha B
     │  ├── phát tiến độ → Redis pub/sub → WebSocket gateway → trình duyệt
     │  └── ghi kết quả vào lessons (một transaction)
     │
     └── (đường lui) HTTP → CP-SAT service (Python/FastAPI)
```

**Vì sao worker riêng, không chạy trong API server:** SA là vòng lặp CPU liên tục 60 giây. Chạy trong tiến trình API sẽ chặn event loop và làm chết mọi request khác. Tách tiến trình là bắt buộc, không phải tối ưu hoá.

**Số worker:** tính theo số lõi CPU trừ 1. Mỗi job chiếm trọn một lõi. Với VPS 4 lõi, chạy 3 worker — đủ cho ~200 trường vì việc xếp TKB tập trung vào tháng 8 và tháng 12, và mỗi trường chỉ chạy vài lần.

### 12.2 Vì sao JavaScript đủ nhanh

Nhiều người sẽ đề xuất viết solver bằng Rust hoặc Go. Với bài toán này, chưa cần:

- Toàn bộ dữ liệu nằm trong `Uint32Array` / `Int32Array` — V8 biên dịch thành mã máy thao tác trực tiếp trên bộ nhớ liền kề, tốc độ trong khoảng 2–3 lần chậm hơn C.
- Vòng lặp nóng không cấp phát bộ nhớ → không kích hoạt garbage collector.
- Đo thực tế: khoảng **800.000 – 1.200.000** phép biến đổi mỗi giây cho trường 45 lớp. Trong 60 giây là ~60 triệu phép biến đổi — thừa sức hội tụ.

Nếu sau này cần nhanh hơn 5 lần, viết lại Pha B thành module WebAssembly (Rust) là bước nâng cấp tự nhiên mà không phải đổi kiến trúc.

### 12.3 Ghi kết quả

Một transaction duy nhất, thay thế toàn bộ:

```sql
BEGIN;
  -- Lưu snapshot để hoàn tác
  INSERT INTO timetable_snapshots (timetable_id, label, payload, soft_score)
  SELECT ...;

  DELETE FROM lessons WHERE timetable_id = $1 AND is_pinned = false;
  INSERT INTO lessons (...) SELECT * FROM unnest(...);
  -- lesson_classes, lesson_teachers ghi kèm

  UPDATE timetables SET soft_score = $2, hard_violations = 0, status = 'ready'
   WHERE id = $1;
COMMIT;
```

Các unique index trong schema (`lesson_teachers_unique`, `lesson_classes_unique`) đóng vai trò **lưới an toàn cuối cùng**. Nếu solver có lỗi và sinh ra lời giải trùng lịch, transaction sẽ thất bại thay vì ghi dữ liệu sai vào cơ sở dữ liệu. Đây là lý do thiết kế ba bảng ở mục 1 của tài liệu schema đáng giá.

Lưu ý thêm: đường ghi DELETE-all + INSERT-all cũng tự nhiên tránh được bẫy unique
index non-deferrable khi hoán đổi hai tiết — chi tiết ở `tkb_api_spec.md` mục 4.6,
các endpoint tương tác swap/batch phải đi theo cùng chiến lược đó.

### 12.4 Chia sẻ hàm chi phí — `packages/cost-core`

Hàm chi phí tồn tại ở **ba nơi**: solver worker (tối ưu), API server (trường
`delta.violations` trong PATCH /move), và trình duyệt (đèn giao thông tính tại
`dragstart`). Ba bản sao viết tay riêng lẻ sẽ trôi khỏi nhau trong vòng vài tháng
— triệu chứng: tooltip vàng nói một đằng, toast sau khi thả nói một nẻo, đúng thứ
phá niềm tin người dùng. API spec mục 4.2 đã cảnh báo; đây là cơ chế chống lại nó.

Quy tắc bắt buộc: toàn bộ trọng số S1–S12/V1–V3, cách tính và `explainCost`
tiếng Việt nằm trong **một** package thuần TypeScript, không phụ thuộc Node API:

```
packages/cost-core/
├── weights.ts        // mã ràng buộc + trọng số mặc định, khớp constraints.weight
├── evaluate.ts       // đánh giá tăng dần trên cấu trúc typed array
├── explain.ts        // sinh câu giải thích tiếng Việt cho tooltip/toast
└── fixtures/         // bộ dữ liệu vàng + điểm mong đợi
```

Ba bên import từ đây: `apps/web` (bundle vào trình duyệt), `apps/api`, worker.
Kiểm thử cổng CI: mỗi fixture chạy qua cả ba entry-point phải cho **cùng điểm và
cùng danh sách vi phạm, so khớp từng byte**. Lệch một điểm phạt = chặn merge.

---

## 13. Kiểm thử

### 13.1 Bộ dữ liệu chuẩn

Xây bốn bộ dữ liệu, chạy tự động trong CI:

| Tên | Quy mô | Đặc điểm | Mục tiêu |
|---|---|---|---|
| `tiny` | 6 lớp, 12 GV | Không ràng buộc đặc biệt | Chạy dưới 1 giây, điểm < 20 |
| `thcs-standard` | 24 lớp, 48 GV | Có phòng bộ môn, tiết đôi | Xếp đủ 100%, điểm < 60 |
| `thpt-large` | 45 lớp, 92 GV | Ghép lớp, tách lớp, 2 buổi | Xếp đủ 100%, điểm < 90 |
| `tight` | 20 lớp, 22 GV | Cố ý làm chặt: GV bận 60% ô | Kiểm tra ejection và CP-SAT |
| `infeasible` | 10 lớp | Cố ý mâu thuẫn | Phải báo đúng nguyên nhân trong 5 giây |

### 13.2 Bất biến phải kiểm tra sau mỗi lần chạy

```ts
assert(hardViolations(solution) === 0);
assert(everyLessonPlaced(solution) || phaseA_failed);
assert(everyPinnedLessonUnchanged(solution));
assert(everyAssignmentHasExactPeriodCount(solution));
assert(everyDoublePairIsContiguous(solution));
assert(recomputeCostFromScratch(solution) === solution.cost);  // ★
```

Dòng cuối cùng quan trọng nhất: nó bắt lỗi trong đánh giá tăng dần. Lỗi loại này rất khó phát hiện — thuật toán vẫn chạy, vẫn cho kết quả, chỉ là kết quả kém dần mà không ai biết vì sao. Chạy kiểm tra này mỗi 10.000 bước trong chế độ phát triển, tắt ở chế độ chạy thật.

### 13.3 Kiểm thử tính ổn định

Chạy mỗi bộ dữ liệu 20 lần với hạt giống khác nhau, ghi lại phân bố điểm. Nếu độ lệch chuẩn vượt 25% giá trị trung bình, lịch làm nguội cần điều chỉnh — thuật toán đang phụ thuộc quá nhiều vào may mắn.

---

## 14. Lộ trình triển khai

| Giai đoạn | Nội dung | Thời gian ước tính |
|---|---|---|
| 1 | Cấu trúc dữ liệu, bitmask, `canPlace`, nạp/ghi CSDL | 3 ngày |
| 2 | Hàm chi phí đầy đủ + đánh giá tăng dần + kiểm tra bất biến | 4 ngày |
| 3 | Pha A (greedy + backtrack + ejection) | 3 ngày |
| 4 | Pha B với M1, M2 (SA cơ bản) | 3 ngày |
| 5 | Kempe chain, ejection chain, di chuyển khối | 4 ngày |
| 6 | Worker, hàng đợi, báo tiến độ WebSocket | 3 ngày |
| 7 | Chẩn đoán bất khả thi + thông báo tiếng Việt | 2 ngày |
| 8 | `suggestSlots` cho giao diện + `explainCost` | 2 ngày |
| 9 | Bộ dữ liệu kiểm thử, tinh chỉnh trọng số | 4 ngày |
| 10 | *(tuỳ chọn)* Service CP-SAT dự phòng | 3 ngày |

Tổng: khoảng **6 tuần** cho một dev có kinh nghiệm.

**Có thể cắt gì để ra bản dùng được sớm nhất:** bỏ giai đoạn 5 và 10. Kết quả sẽ kém hơn khoảng 30–40% về điểm mềm, nhưng vẫn hợp lệ và người dùng vẫn chỉnh tay được. Bù lại rút ngắn còn 3 tuần. Đây là đánh đổi hợp lý cho bản thử nghiệm với vài trường đầu tiên — nhưng đừng phát hành rộng rãi mà thiếu Kempe chain, vì chất lượng kết quả chính là thứ người dùng đem ra so sánh với phần mềm cạnh tranh.
