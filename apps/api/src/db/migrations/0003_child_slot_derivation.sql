-- Bảng con của lessons mang các cột denormalize để unique index chặn trùng
-- lớp/GV. Mọi đường ghi (place, swap, snapshot, seed) chỉ cần truyền lesson_id;
-- trigger luôn lấy school + slot từ bản ghi cha, tránh dữ liệu thiếu hoặc lệch.
CREATE OR REPLACE FUNCTION derive_school_id_from_parent() RETURNS trigger AS $$
DECLARE
    parent_school_id uuid;
    parent_timetable_id uuid;
    parent_day_of_week smallint;
    parent_period_id uuid;
BEGIN
    IF TG_ARGV[0] = 'lessons' THEN
        SELECT school_id, timetable_id, day_of_week, period_id
          INTO parent_school_id, parent_timetable_id, parent_day_of_week, parent_period_id
          FROM lessons WHERE id = NEW.lesson_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION '%: không tìm thấy bản ghi cha (lessons)', TG_TABLE_NAME;
        END IF;
        NEW.school_id := parent_school_id;
        NEW.timetable_id := parent_timetable_id;
        NEW.day_of_week := parent_day_of_week;
        NEW.period_id := parent_period_id;
    ELSE
        SELECT school_id INTO parent_school_id
          FROM timetables WHERE id = NEW.timetable_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION '%: không tìm thấy bản ghi cha (timetables)', TG_TABLE_NAME;
        END IF;
        NEW.school_id := parent_school_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
