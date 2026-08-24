-- =============================================================================
--  0002 — Chuyển tiếp năm học (tkb_year_rollover_design.md mục 3)
--  Bổ sung truy vết nguồn gốc + bảng theo dõi job chuyển tiếp.
-- =============================================================================

-- 1. Cột truy vết nguồn gốc — mỗi bản ghi năm mới trỏ về bản ghi năm trước
ALTER TABLE grades      ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES grades(id)      ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE subjects    ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES subjects(id)    ON DELETE SET NULL;
ALTER TABLE rooms       ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES rooms(id)       ON DELETE SET NULL;
ALTER TABLE teachers    ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES teachers(id)    ON DELETE SET NULL;
ALTER TABLE classes     ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES classes(id)     ON DELETE SET NULL;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES assignments(id) ON DELETE SET NULL;
ALTER TABLE periods     ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES periods(id)     ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_source_idx  ON classes  (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teachers_source_idx ON teachers (source_id) WHERE source_id IS NOT NULL;

-- 2. Đánh dấu lịch bận cố định (mang sang năm sau) vs tạm thời của riêng năm này
ALTER TABLE availability_slots
    ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN availability_slots.is_recurring IS
  'true = ràng buộc lâu dài (nghỉ Thứ Bảy, đi học cao học Thứ Năm) -> mang sang năm sau. '
  'false = tình huống nhất thời của riêng năm học này -> không mang sang.';

-- 3. Job chuyển tiếp + quyết định ánh xạ từng đối tượng
CREATE TYPE rollover_status AS ENUM ('draft','applying','completed','rolled_back','failed');
CREATE TYPE rollover_action AS ENUM ('copy','promote','create','skip','remap','graduate');

CREATE TABLE rollover_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    source_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    target_year_id  uuid REFERENCES school_years(id) ON DELETE SET NULL,
    status          rollover_status NOT NULL DEFAULT 'draft',
    options         jsonb NOT NULL DEFAULT '{}'::jsonb,
    stats           jsonb NOT NULL DEFAULT '{}'::jsonb,
    warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
    undo_expires_at timestamptz,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    applied_at      timestamptz
);
CREATE INDEX IF NOT EXISTS rollover_jobs_school_idx ON rollover_jobs (school_id, status);

CREATE TABLE rollover_mappings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      uuid NOT NULL REFERENCES rollover_jobs(id) ON DELETE CASCADE,
    entity_type text NOT NULL,          -- class | teacher | subject | assignment | room
    source_id   uuid,                   -- NULL khi action = 'create'
    target_id   uuid,                   -- điền sau khi áp dụng
    action      rollover_action NOT NULL,
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_auto     boolean NOT NULL DEFAULT true,
    note        text,
    UNIQUE (job_id, entity_type, source_id)
);
CREATE INDEX IF NOT EXISTS rollover_mappings_job_idx ON rollover_mappings (job_id, entity_type);

-- RLS cho hai bảng mới (khớp mẫu tenant_isolation ở 0001)
ALTER TABLE rollover_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollover_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rollover_jobs
    USING (school_id = current_school_id())
    WITH CHECK (school_id = current_school_id());

ALTER TABLE rollover_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollover_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rollover_mappings
    USING (EXISTS (SELECT 1 FROM rollover_jobs j
                   WHERE j.id = rollover_mappings.job_id
                     AND j.school_id = current_school_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM rollover_jobs j
                        WHERE j.id = rollover_mappings.job_id
                          AND j.school_id = current_school_id()));
