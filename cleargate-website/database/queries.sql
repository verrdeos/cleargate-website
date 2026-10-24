-- =============================================================================
--  ClearGate: handy queries
--  Run these in phpMyAdmin (SQL tab) after importing cleargate_db.sql.
-- =============================================================================

USE cleargate;

-- 1. Dashboard summary for every student this academic year
SELECT student_number, student_name, program, year_level, term,
       approved_count, pending_count, needs_action_count,
       CONCAT(percent_complete, '%') AS progress,
       IF(is_eligible, 'Eligible', 'Not yet') AS enrollment
  FROM v_clearance_summary
 WHERE academic_year = '2026 - 2027'
 ORDER BY percent_complete DESC, student_name;

-- 2. One student's clearance, outstanding items first (what the website shows)
SELECT office_name, status, task, next_step, contact_email
  FROM v_clearance_items
 WHERE student_number = '2024-00123'
 ORDER BY FIELD(status, 'needs_action', 'pending', 'approved'), sort_order;

-- 3. Library's work queue: students it still has to clear
SELECT student_number, student_name, status, task, updated_at
  FROM v_clearance_items
 WHERE office_code = 'library' AND status <> 'approved'
 ORDER BY FIELD(status, 'needs_action', 'pending'), student_name;

-- 4. Students who are fully cleared and may enroll
SELECT student_number, student_name, program
  FROM v_clearance_summary
 WHERE is_eligible = 1;

-- 5. Which office is holding up the most students?
SELECT o.name AS office, COUNT(*) AS students_waiting
  FROM clearance_items ci
  JOIN offices o ON o.office_id = ci.office_id
 WHERE ci.status <> 'approved'
 GROUP BY o.office_id, o.name
 ORDER BY students_waiting DESC;

-- 6. Unread notifications per student
SELECT u.email, COUNT(n.notification_id) AS unread
  FROM users u
  LEFT JOIN notifications n ON n.user_id = u.user_id AND n.is_read = 0
 WHERE u.role = 'student'
 GROUP BY u.user_id, u.email;

-- 7. Full audit trail for one student
SELECT l.changed_at, o.name AS office, l.old_status, l.new_status, l.note,
       COALESCE(st.full_name, 'System') AS changed_by
  FROM clearance_item_logs l
  JOIN clearance_items ci ON ci.item_id = l.item_id
  JOIN clearances c       ON c.clearance_id = ci.clearance_id
  JOIN students s         ON s.student_id = c.student_id
  JOIN offices o          ON o.office_id = ci.office_id
  LEFT JOIN office_staff st ON st.user_id = l.changed_by
 WHERE s.student_number = '2024-00123'
 ORDER BY l.changed_at;

-- 8. Example: Library staff (user 10) clears Ariel's book.
--    The trigger records the change and notifies Ariel automatically.
--    Uncomment to try it:
-- CALL sp_update_clearance_item(
--   (SELECT item_id FROM v_clearance_items WHERE student_number = '2024-00123' AND office_code = 'library'),
--   'approved', 'Book returned', 'Book returned', 'Library has already cleared your account.',
--   NULL, 'Book returned on time', 10);

-- 9. Example: open next semester's clearance for Ariel (every office starts as pending)
-- CALL sp_open_clearance(1, 2, '2nd Semester');
