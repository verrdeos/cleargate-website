-- =============================================================================
--  ClearGate: Student Clearance Management System database
--  Target: MariaDB 10.4+ (the version bundled with XAMPP) and MySQL 8.0+
--
--  How to import (XAMPP):
--    1. Start Apache and MySQL in the XAMPP Control Panel.
--    2. Open http://localhost/phpmyadmin, go to the Import tab,
--       choose this file and click Import (or Go).
--  Command line alternative:
--    C:\xampp\mysql\bin\mysql -u root < cleargate_db.sql
--
--  Running this file again RESETS the cleargate database to the demo data.
--  Demo sign-in details are listed in README.md.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE DATABASE IF NOT EXISTS cleargate
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cleargate;

-- Drop in child-to-parent order so the script can be re-run safely.
DROP VIEW IF EXISTS v_clearance_items;
DROP VIEW IF EXISTS v_clearance_summary;
DROP PROCEDURE IF EXISTS sp_update_clearance_item;
DROP PROCEDURE IF EXISTS sp_open_clearance;
DROP TABLE IF EXISTS deadline_alerts;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS office_deadlines;
DROP TABLE IF EXISTS admin_actions;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS office_messages;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS clearance_item_logs;
DROP TABLE IF EXISTS clearance_items;
DROP TABLE IF EXISTS clearances;
DROP TABLE IF EXISTS office_staff;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS offices;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS programs;


-- =============================================================================
--  1. REFERENCE TABLES
-- =============================================================================

CREATE TABLE programs (
  program_id   INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  code         VARCHAR(10)  NOT NULL COMMENT 'Short code shown on the website, e.g. BSCS',
  name         VARCHAR(120) NOT NULL COMMENT 'Full program name',
  PRIMARY KEY (program_id),
  UNIQUE KEY uq_programs_code (code)
) ENGINE=InnoDB COMMENT='Degree programs students are enrolled in';

CREATE TABLE academic_years (
  academic_year_id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  label            VARCHAR(20)  NOT NULL COMMENT 'Display label, e.g. 2026 - 2027',
  start_date       DATE         NOT NULL COMMENT 'First day of the academic year',
  end_date         DATE         NOT NULL COMMENT 'Last day of the academic year',
  is_current       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = the year new clearances are opened for',
  PRIMARY KEY (academic_year_id),
  UNIQUE KEY uq_academic_years_label (label),
  CONSTRAINT ck_academic_years_dates CHECK (end_date > start_date),
  CONSTRAINT ck_academic_years_current CHECK (is_current IN (0, 1))
) ENGINE=InnoDB COMMENT='School years a clearance belongs to';

CREATE TABLE offices (
  office_id     INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  code          VARCHAR(20)  NOT NULL COMMENT 'Stable slug used by the website, e.g. library',
  name          VARCHAR(80)  NOT NULL COMMENT 'Office name shown to students',
  icon          VARCHAR(20)  NOT NULL DEFAULT 'file' COMMENT 'Icon key the website draws (book, wallet, file, heart, cap, box)',
  contact_email VARCHAR(190) NOT NULL COMMENT 'Address students can contact',
  office_hours  VARCHAR(80)  NOT NULL COMMENT 'Opening hours shown on the office details sheet',
  sort_order    SMALLINT     NOT NULL DEFAULT 0 COMMENT 'Display order when statuses are equal',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = office no longer signs clearances',
  PRIMARY KEY (office_id),
  UNIQUE KEY uq_offices_code (code)
) ENGINE=InnoDB COMMENT='School offices that must sign off a clearance';


-- =============================================================================
--  2. PEOPLE AND ACCOUNTS
-- =============================================================================

CREATE TABLE users (
  user_id       INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  email         VARCHAR(190) NOT NULL COMMENT 'Sign-in email, unique per account',
  password_hash VARCHAR(255) NOT NULL COMMENT 'PHP password_hash() output (bcrypt); never the plain password',
  role          ENUM('student','staff','admin') NOT NULL COMMENT 'student = sees own clearance; staff = signs for one office; admin = everything',
  full_name     VARCHAR(120) NULL COMMENT 'Display name for admins (staff names live in office_staff, students in students)',
  personal_email VARCHAR(190) NULL COMMENT 'Student''s own email from the application; also accepted by Forgot password',
  phone         VARCHAR(20)  NULL COMMENT 'Mobile number the user keeps up to date on My Profile',
  avatar_name   VARCHAR(80)  NULL COMMENT 'Profile picture file inside api/uploads/avatars (NULL = initials)',
  avatar_mime   VARCHAR(40)  NULL COMMENT 'Content type of the profile picture',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = signed in with a temporary password and must set a new one',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = account disabled, cannot sign in',
  last_login_at DATETIME     NULL COMMENT 'Time of the most recent successful sign-in',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the account was created',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last change to this row',
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_personal_email (personal_email)
) ENGINE=InnoDB COMMENT='Sign-in accounts for students, office staff and admins';

CREATE TABLE applications (
  application_id   INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  reference        VARCHAR(20)  NULL COMMENT 'Shown to the applicant, e.g. APP-2026-0001',
  status           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' COMMENT 'Registrar decision',
  status_token     CHAR(64)     NOT NULL COMMENT 'SHA-256 of the token the applicant''s browser uses to check status',
  photo_name       VARCHAR(80)  NULL COMMENT 'Optional 2x2 photo file inside api/uploads/photos',
  photo_mime       VARCHAR(30)  NULL COMMENT 'image/jpeg, image/png or image/webp',
  admission_type   VARCHAR(40)  NOT NULL COMMENT 'New student, Transferee, Returnee or Cross-enrollee',
  program_id       INT UNSIGNED NOT NULL COMMENT 'FK to programs: program applied for',
  year_level       TINYINT UNSIGNED NOT NULL COMMENT 'Academic level applied for, 1 to 4',
  last_name        VARCHAR(60)  NOT NULL,
  first_name       VARCHAR(60)  NOT NULL,
  middle_name      VARCHAR(60)  NULL,
  suffix           VARCHAR(10)  NULL,
  sex              ENUM('Male','Female') NOT NULL,
  civil_status     VARCHAR(20)  NOT NULL,
  birthday         DATE         NOT NULL,
  place_of_birth   VARCHAR(120) NULL,
  personal_email   VARCHAR(190) NOT NULL COMMENT 'Applicant''s own email; becomes users.personal_email',
  contact_number   VARCHAR(20)  NOT NULL,
  religion         VARCHAR(60)  NULL,
  permanent_address VARCHAR(255) NULL,
  region           VARCHAR(80)  NOT NULL,
  province         VARCHAR(80)  NOT NULL,
  city             VARCHAR(80)  NOT NULL,
  barangay         VARCHAR(80)  NOT NULL,
  street           VARCHAR(160) NOT NULL COMMENT 'House no. / street / subdivision',
  postal_code      VARCHAR(10)  NULL,
  father_first     VARCHAR(60)  NOT NULL,
  father_middle    VARCHAR(60)  NULL,
  father_last      VARCHAR(60)  NOT NULL,
  father_occupation VARCHAR(80) NOT NULL,
  mother_first     VARCHAR(60)  NOT NULL,
  mother_middle    VARCHAR(60)  NULL,
  mother_last      VARCHAR(60)  NOT NULL,
  mother_occupation VARCHAR(80) NOT NULL,
  guardian_first   VARCHAR(60)  NOT NULL,
  guardian_middle  VARCHAR(60)  NULL,
  guardian_last    VARCHAR(60)  NOT NULL,
  guardian_relationship VARCHAR(40) NOT NULL,
  guardian_contact VARCHAR(20)  NOT NULL,
  submitted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by      INT UNSIGNED NULL COMMENT 'FK to users: Registrar staff or admin who decided',
  reviewed_at      DATETIME NULL,
  reject_reason    VARCHAR(255) NULL COMMENT 'Shown to the applicant when rejected',
  user_id          INT UNSIGNED NULL COMMENT 'FK to users: the account created on approval',
  temp_password    VARCHAR(40)  NULL COMMENT 'Temporary password shown to the applicant and Registrar; cleared once the student sets their own',
  PRIMARY KEY (application_id),
  UNIQUE KEY uq_applications_reference (reference),
  KEY ix_applications_status (status, submitted_at),
  KEY ix_applications_email (personal_email),
  CONSTRAINT fk_applications_program FOREIGN KEY (program_id) REFERENCES programs (program_id),
  CONSTRAINT fk_applications_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT fk_applications_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT ck_applications_year CHECK (year_level BETWEEN 1 AND 4)
) ENGINE=InnoDB COMMENT='Student sign-up applications the Registrar approves or rejects';

CREATE TABLE students (
  student_id     INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  user_id        INT UNSIGNED NOT NULL COMMENT 'FK to users: the student''s sign-in account',
  student_number VARCHAR(20)  NOT NULL COMMENT 'School ID; students can sign in with it instead of email',
  first_name     VARCHAR(60)  NOT NULL COMMENT 'Given name',
  last_name      VARCHAR(60)  NOT NULL COMMENT 'Family name',
  program_id     INT UNSIGNED NOT NULL COMMENT 'FK to programs: current degree program',
  year_level     TINYINT UNSIGNED NOT NULL COMMENT 'Current year level, 1 to 4',
  application_id INT UNSIGNED NULL COMMENT 'FK to applications: the sign-up this account came from (photo and personal details)',
  current_address   VARCHAR(255) NULL COMMENT 'Address the student keeps up to date (NULL = the one on their application)',
  emergency_name    VARCHAR(120) NULL COMMENT 'Emergency contact person (NULL = the guardian on their application)',
  emergency_contact VARCHAR(20)  NULL COMMENT 'Emergency contact number',
  PRIMARY KEY (student_id),
  UNIQUE KEY uq_students_user (user_id),
  UNIQUE KEY uq_students_number (student_number),
  KEY ix_students_program (program_id),
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_students_program FOREIGN KEY (program_id) REFERENCES programs (program_id),
  CONSTRAINT fk_students_application FOREIGN KEY (application_id) REFERENCES applications (application_id) ON DELETE SET NULL,
  CONSTRAINT ck_students_year CHECK (year_level BETWEEN 1 AND 4)
) ENGINE=InnoDB COMMENT='Student profiles, one per student account';

CREATE TABLE office_staff (
  user_id   INT UNSIGNED NOT NULL COMMENT 'PK and FK to users: the staff member''s account',
  office_id INT UNSIGNED NOT NULL COMMENT 'FK to offices: the office this person signs for',
  full_name VARCHAR(120) NOT NULL COMMENT 'Name shown in the audit log',
  position  VARCHAR(80)  NULL COMMENT 'Job title, e.g. Head Librarian',
  PRIMARY KEY (user_id),
  KEY ix_office_staff_office (office_id),
  CONSTRAINT fk_office_staff_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_office_staff_office FOREIGN KEY (office_id) REFERENCES offices (office_id)
) ENGINE=InnoDB COMMENT='Which office each staff account can approve for';


-- =============================================================================
--  3. CLEARANCES
-- =============================================================================

CREATE TABLE clearances (
  clearance_id     INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  student_id       INT UNSIGNED NOT NULL COMMENT 'FK to students: whose clearance this is',
  academic_year_id INT UNSIGNED NOT NULL COMMENT 'FK to academic_years: the year being cleared',
  term             ENUM('1st Semester','2nd Semester','Summer') NOT NULL COMMENT 'Term being cleared',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the clearance was opened',
  PRIMARY KEY (clearance_id),
  UNIQUE KEY uq_clearances_student_term (student_id, academic_year_id, term),
  KEY ix_clearances_year (academic_year_id),
  CONSTRAINT fk_clearances_student FOREIGN KEY (student_id) REFERENCES students (student_id) ON DELETE CASCADE,
  CONSTRAINT fk_clearances_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (academic_year_id)
) ENGINE=InnoDB COMMENT='One clearance per student per term';

CREATE TABLE clearance_items (
  item_id      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  clearance_id INT UNSIGNED NOT NULL COMMENT 'FK to clearances: the clearance this sign-off belongs to',
  office_id    INT UNSIGNED NOT NULL COMMENT 'FK to offices: the office that must sign off',
  status       ENUM('needs_action','pending','approved') NOT NULL DEFAULT 'pending'
               COMMENT 'needs_action = student must do something; pending = office reviewing; approved = cleared',
  task         VARCHAR(160) NOT NULL COMMENT 'Headline requirement, e.g. Return 1 unreturned book',
  remarks      VARCHAR(120) NOT NULL COMMENT 'Short note shown on the office tile, e.g. 1 unreturned book',
  description  VARCHAR(255) NOT NULL COMMENT 'One-sentence explanation shown to the student',
  next_step    VARCHAR(255) NULL COMMENT 'What the student should do next; NULL once approved',
  due_at       DATETIME NULL COMMENT 'Deadline for this student only; NULL = use the office deadline',
  updated_by   INT UNSIGNED NULL COMMENT 'FK to users: who last changed this item (NULL = system/seed)',
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last change to this item',
  approved_at  DATETIME NULL COMMENT 'When the office approved; set automatically by trigger',
  PRIMARY KEY (item_id),
  UNIQUE KEY uq_clearance_items_office (clearance_id, office_id),
  KEY ix_clearance_items_office_status (office_id, status),
  CONSTRAINT fk_clearance_items_clearance FOREIGN KEY (clearance_id) REFERENCES clearances (clearance_id) ON DELETE CASCADE,
  CONSTRAINT fk_clearance_items_office FOREIGN KEY (office_id) REFERENCES offices (office_id),
  CONSTRAINT fk_clearance_items_user FOREIGN KEY (updated_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Each office''s sign-off on a clearance';

CREATE TABLE clearance_item_logs (
  log_id     INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  item_id    INT UNSIGNED NOT NULL COMMENT 'FK to clearance_items: the item that changed',
  old_status ENUM('needs_action','pending','approved') NULL COMMENT 'Status before the change',
  new_status ENUM('needs_action','pending','approved') NOT NULL COMMENT 'Status after the change',
  note       VARCHAR(255) NULL COMMENT 'Optional reason given by staff',
  changed_by INT UNSIGNED NULL COMMENT 'FK to users: who made the change',
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the change happened',
  PRIMARY KEY (log_id),
  KEY ix_clearance_item_logs_item (item_id, changed_at),
  CONSTRAINT fk_item_logs_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE CASCADE,
  CONSTRAINT fk_item_logs_user FOREIGN KEY (changed_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Audit trail of every status change (written by trigger)';


CREATE TABLE submissions (
  submission_id   INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  item_id         INT UNSIGNED NOT NULL COMMENT 'FK to clearance_items: the office sign-off this evidence is for',
  reference       VARCHAR(20)  NULL COMMENT 'Human reference shown to staff, e.g. LIB-2026-0007',
  stored_name     VARCHAR(80)  NOT NULL COMMENT 'Random file name inside api/uploads (never the student''s file name)',
  original_name   VARCHAR(160) NOT NULL COMMENT 'File name the student uploaded',
  mime_type       VARCHAR(60)  NOT NULL COMMENT 'application/pdf, image/jpeg, image/png or image/webp',
  file_size       INT UNSIGNED NOT NULL COMMENT 'Bytes',
  student_note    VARCHAR(255) NULL COMMENT 'Optional message from the student',
  status          ENUM('submitted','approved','returned','replaced') NOT NULL DEFAULT 'submitted'
                  COMMENT 'submitted = waiting for staff; approved/returned = staff decision; replaced = student uploaded a newer file',
  submitted_by    INT UNSIGNED NULL COMMENT 'FK to users: the student who uploaded it',
  submitted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Upload time',
  reviewed_by     INT UNSIGNED NULL COMMENT 'FK to users: staff member or admin who decided',
  reviewed_at     DATETIME NULL COMMENT 'Decision time',
  return_category VARCHAR(80)  NULL COMMENT 'Reason category when returned',
  review_note     VARCHAR(500) NULL COMMENT 'Reason for return, shown to the student',
  checklist       VARCHAR(500) NULL COMMENT 'Checklist items the reviewer ticked (JSON array)',
  PRIMARY KEY (submission_id),
  UNIQUE KEY uq_submissions_reference (reference),
  KEY ix_submissions_item (item_id, submitted_at),
  KEY ix_submissions_status (status, submitted_at),
  KEY ix_submissions_reviewed (reviewed_at),
  CONSTRAINT fk_submissions_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE CASCADE,
  CONSTRAINT fk_submissions_student FOREIGN KEY (submitted_by) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT fk_submissions_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Evidence files students upload for an office to review';


CREATE TABLE office_messages (
  message_id  INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  item_id     INT UNSIGNED NOT NULL COMMENT 'FK to clearance_items: the requirement (student + office) this conversation is about',
  sender_id   INT UNSIGNED NULL COMMENT 'FK to users: who wrote it',
  sender_role ENUM('student','staff','admin') NOT NULL COMMENT 'Which side wrote it',
  body        VARCHAR(1000) NOT NULL COMMENT 'Message text',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When it was sent',
  read_at     DATETIME NULL COMMENT 'When the other side opened it (NULL = unread)',
  PRIMARY KEY (message_id),
  KEY ix_office_messages_item (item_id, created_at),
  KEY ix_office_messages_unread (read_at, sender_role),
  CONSTRAINT fk_office_messages_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE CASCADE,
  CONSTRAINT fk_office_messages_sender FOREIGN KEY (sender_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Messages between a student and an office about one clearance requirement';


-- =============================================================================
--  4. NOTIFICATIONS AND SECURITY
-- =============================================================================

CREATE TABLE notifications (
  notification_id INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  user_id         INT UNSIGNED NOT NULL COMMENT 'FK to users: who receives it',
  item_id         INT UNSIGNED NULL COMMENT 'FK to clearance_items: the item it is about, if any',
  tone            ENUM('needs_action','pending','approved','info') NOT NULL DEFAULT 'info' COMMENT 'Colour/icon the app uses',
  title           VARCHAR(120) NOT NULL COMMENT 'Headline, e.g. Library needs action',
  body            VARCHAR(255) NOT NULL COMMENT 'Supporting sentence',
  link            VARCHAR(255) NULL COMMENT 'Page the notification opens, e.g. review.html?id=12 (staff and admin)',
  is_read         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = the user has opened it',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When it was sent',
  PRIMARY KEY (notification_id),
  KEY ix_notifications_user (user_id, is_read, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Website notifications (the bell) for students, staff and admins';

CREATE TABLE password_resets (
  reset_id   INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  user_id    INT UNSIGNED NOT NULL COMMENT 'FK to users: account being reset',
  token_hash CHAR(64)     NOT NULL COMMENT 'SHA-256 of the emailed token; the token itself is never stored',
  expires_at DATETIME     NOT NULL COMMENT 'Token stops working after this time',
  used_at    DATETIME     NULL COMMENT 'Set when the token is used; a token works only once',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the reset was requested',
  PRIMARY KEY (reset_id),
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY ix_password_resets_user (user_id),
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='One-time password reset tokens';

CREATE TABLE login_attempts (
  attempt_id   INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  login        VARCHAR(190) NOT NULL COMMENT 'Email or student number that was typed',
  ip_address   VARCHAR(45)  NOT NULL COMMENT 'Client IP (IPv4 or IPv6)',
  succeeded    TINYINT(1)   NOT NULL COMMENT '1 = correct password',
  attempted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When the attempt happened',
  PRIMARY KEY (attempt_id),
  KEY ix_login_attempts_login (login, attempted_at),
  KEY ix_login_attempts_ip (ip_address, attempted_at)
) ENGINE=InnoDB COMMENT='Sign-in attempts, used to slow down password guessing';


CREATE TABLE admin_actions (
  action_id  INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  user_id    INT UNSIGNED NULL COMMENT 'FK to users: the admin (or Registrar) who did it',
  action     VARCHAR(60)  NOT NULL COMMENT 'What happened, e.g. office.update, term.open, staff.create',
  details    VARCHAR(500) NOT NULL COMMENT 'Readable summary of the change',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When it happened',
  PRIMARY KEY (action_id),
  KEY ix_admin_actions_time (created_at),
  CONSTRAINT fk_admin_actions_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Settings and account changes made from the website (shown in the Audit Log)';

CREATE TABLE office_deadlines (
  deadline_id      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  office_id        INT UNSIGNED NOT NULL COMMENT 'FK to offices: the office whose requirement is due',
  academic_year_id INT UNSIGNED NOT NULL COMMENT 'FK to academic_years: the year the deadline applies to',
  term             ENUM('1st Semester','2nd Semester','Summer') NOT NULL COMMENT 'Term the deadline applies to',
  due_at           DATETIME     NOT NULL COMMENT 'When students must be cleared by this office',
  note             VARCHAR(255) NULL COMMENT 'Optional note shown to students, e.g. Office closes for the break',
  set_by           INT UNSIGNED NULL COMMENT 'FK to users: who set it',
  passed_notified_at DATETIME   NULL COMMENT 'When staff were told the deadline passed (once per deadline)',
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last change',
  PRIMARY KEY (deadline_id),
  UNIQUE KEY uq_office_deadlines (office_id, academic_year_id, term),
  CONSTRAINT fk_office_deadlines_office FOREIGN KEY (office_id) REFERENCES offices (office_id) ON DELETE CASCADE,
  CONSTRAINT fk_office_deadlines_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (academic_year_id) ON DELETE CASCADE,
  CONSTRAINT fk_office_deadlines_user FOREIGN KEY (set_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='One deadline per office per term (students can have their own on clearance_items.due_at)';

CREATE TABLE reminders (
  reminder_id      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  office_id        INT UNSIGNED NULL COMMENT 'FK to offices: the office reminding; NULL = every office (admin)',
  item_id          INT UNSIGNED NULL COMMENT 'FK to clearance_items: one student requirement (audience = student)',
  academic_year_id INT UNSIGNED NOT NULL COMMENT 'FK to academic_years: term the reminder is for',
  term             ENUM('1st Semester','2nd Semester','Summer') NOT NULL COMMENT 'Term the reminder is for',
  audience         ENUM('outstanding','overdue','student') NOT NULL COMMENT 'outstanding = not yet cleared; overdue = past the deadline; student = one student',
  message          VARCHAR(255) NOT NULL COMMENT 'Text the students see',
  send_at          DATETIME     NOT NULL COMMENT 'When to send it (now or scheduled)',
  sent_at          DATETIME     NULL COMMENT 'When it went out; NULL = still scheduled',
  cancelled_at     DATETIME     NULL COMMENT 'Set if staff cancelled it before it went out',
  recipients       INT UNSIGNED NULL COMMENT 'How many students received it',
  created_by       INT UNSIGNED NULL COMMENT 'FK to users: staff or admin who wrote it',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When it was written',
  PRIMARY KEY (reminder_id),
  KEY ix_reminders_due (sent_at, cancelled_at, send_at),
  CONSTRAINT fk_reminders_office FOREIGN KEY (office_id) REFERENCES offices (office_id) ON DELETE CASCADE,
  CONSTRAINT fk_reminders_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE CASCADE,
  CONSTRAINT fk_reminders_year FOREIGN KEY (academic_year_id) REFERENCES academic_years (academic_year_id) ON DELETE CASCADE,
  CONSTRAINT fk_reminders_user FOREIGN KEY (created_by) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Reminders staff send to students, now or at a scheduled time';

CREATE TABLE deadline_alerts (
  item_id INT UNSIGNED NOT NULL COMMENT 'FK to clearance_items: the requirement',
  stage   ENUM('3d','1d','overdue') NOT NULL COMMENT 'Which automatic reminder: 3 days left, 1 day left, or overdue',
  due_at  DATETIME NOT NULL COMMENT 'The deadline it was sent for (a new deadline gets new reminders)',
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When it was sent',
  PRIMARY KEY (item_id, stage, due_at),
  CONSTRAINT fk_deadline_alerts_item FOREIGN KEY (item_id) REFERENCES clearance_items (item_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Automatic deadline reminders already sent, so each goes out once';


-- =============================================================================
--  5. TRIGGERS: approval time, audit log and student notification
-- =============================================================================

DELIMITER $$

CREATE TRIGGER trg_clearance_items_before_update
BEFORE UPDATE ON clearance_items
FOR EACH ROW
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SET NEW.approved_at = NOW();
    SET NEW.next_step = NULL;
  ELSEIF NEW.status <> 'approved' THEN
    SET NEW.approved_at = NULL;
  END IF;
END$$

CREATE TRIGGER trg_clearance_items_after_update
AFTER UPDATE ON clearance_items
FOR EACH ROW
BEGIN
  DECLARE v_student_user INT UNSIGNED;
  DECLARE v_office_name  VARCHAR(80);

  IF NEW.status <> OLD.status THEN
    -- @cg_note is set by sp_update_clearance_item; NULL for direct edits.
    INSERT INTO clearance_item_logs (item_id, old_status, new_status, note, changed_by)
    VALUES (NEW.item_id, OLD.status, NEW.status, @cg_note, NEW.updated_by);

    SELECT s.user_id INTO v_student_user
      FROM clearances c
      JOIN students s ON s.student_id = c.student_id
     WHERE c.clearance_id = NEW.clearance_id;

    SELECT name INTO v_office_name FROM offices WHERE office_id = NEW.office_id;

    INSERT INTO notifications (user_id, item_id, tone, title, body)
    VALUES (
      v_student_user,
      NEW.item_id,
      NEW.status,
      CASE NEW.status
        WHEN 'approved'     THEN CONCAT(v_office_name, ' cleared you')
        WHEN 'needs_action' THEN CONCAT(v_office_name, ' needs action')
        ELSE                     CONCAT(v_office_name, ' is reviewing')
      END,
      -- Approvals and requests for action explain themselves; pending shows the requirement.
      IF(NEW.status IN ('needs_action', 'approved'), NEW.description, NEW.task)
    );
  END IF;
END$$


-- =============================================================================
--  6. STORED PROCEDURES
-- =============================================================================

-- Opens a clearance for a student and term, with a pending item for every
-- active office. Returns the clearance_id (existing one if already opened).
CREATE PROCEDURE sp_open_clearance(
  IN p_student_id       INT UNSIGNED,
  IN p_academic_year_id INT UNSIGNED,
  IN p_term             VARCHAR(20)
)
BEGIN
  DECLARE v_clearance_id INT UNSIGNED;

  SELECT clearance_id INTO v_clearance_id
    FROM clearances
   WHERE student_id = p_student_id
     AND academic_year_id = p_academic_year_id
     AND term = p_term;

  IF v_clearance_id IS NULL THEN
    INSERT INTO clearances (student_id, academic_year_id, term)
    VALUES (p_student_id, p_academic_year_id, p_term);
    SET v_clearance_id = LAST_INSERT_ID();

    INSERT INTO clearance_items (clearance_id, office_id, status, task, remarks, description, next_step)
    SELECT v_clearance_id, office_id, 'pending',
           'Awaiting office review',
           'Awaiting review',
           CONCAT(name, ' has not reviewed your account yet.'),
           CONCAT('Wait for ', name, ' to review your account, or visit the office.')
      FROM offices
     WHERE is_active = 1;
  END IF;

  SELECT v_clearance_id AS clearance_id;
END$$

-- Changes one clearance item on behalf of a staff member or admin.
-- Staff may only change items for their own office.
CREATE PROCEDURE sp_update_clearance_item(
  IN p_item_id     INT UNSIGNED,
  IN p_status      VARCHAR(20),
  IN p_task        VARCHAR(160),
  IN p_remarks     VARCHAR(120),
  IN p_description VARCHAR(255),
  IN p_next_step   VARCHAR(255),
  IN p_note        VARCHAR(255),
  IN p_user_id     INT UNSIGNED
)
BEGIN
  DECLARE v_role        VARCHAR(10);
  DECLARE v_item_office INT UNSIGNED;
  DECLARE v_staff_office INT UNSIGNED;

  SELECT role INTO v_role FROM users WHERE user_id = p_user_id AND is_active = 1;
  SELECT office_id INTO v_item_office FROM clearance_items WHERE item_id = p_item_id;
  SELECT office_id INTO v_staff_office FROM office_staff WHERE user_id = p_user_id;

  IF v_item_office IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Clearance item not found';
  END IF;

  IF v_role IS NULL OR v_role = 'student'
     OR (v_role = 'staff' AND (v_staff_office IS NULL OR v_staff_office <> v_item_office)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Not allowed to update this office''s items';
  END IF;

  IF p_status NOT IN ('needs_action', 'pending', 'approved') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid status';
  END IF;

  SET @cg_note = p_note;

  UPDATE clearance_items
     SET status      = p_status,
         task        = COALESCE(p_task, task),
         remarks     = COALESCE(p_remarks, remarks),
         description = COALESCE(p_description, description),
         next_step   = p_next_step,
         updated_by  = p_user_id
   WHERE item_id = p_item_id;

  SET @cg_note = NULL;
END$$

DELIMITER ;


-- =============================================================================
--  7. VIEWS: what the website reads
-- =============================================================================

-- One row per clearance with the counts and percentage shown on the dashboard.
CREATE VIEW v_clearance_summary AS
SELECT
  c.clearance_id,
  s.student_id,
  s.user_id,
  s.student_number,
  CONCAT(s.first_name, ' ', s.last_name)                AS student_name,
  p.code                                                AS program,
  s.year_level,
  ay.label                                              AS academic_year,
  c.term,
  COUNT(ci.item_id)                                     AS total_offices,
  COALESCE(SUM(ci.status = 'approved'), 0)              AS approved_count,
  COALESCE(SUM(ci.status = 'pending'), 0)               AS pending_count,
  COALESCE(SUM(ci.status = 'needs_action'), 0)          AS needs_action_count,
  ROUND(100 * COALESCE(SUM(ci.status = 'approved'), 0) / NULLIF(COUNT(ci.item_id), 0)) AS percent_complete,
  (COUNT(ci.item_id) > 0 AND SUM(ci.status <> 'approved') = 0) AS is_eligible
FROM clearances c
JOIN students s        ON s.student_id = c.student_id
JOIN programs p        ON p.program_id = s.program_id
JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
LEFT JOIN clearance_items ci ON ci.clearance_id = c.clearance_id
GROUP BY c.clearance_id, s.student_id, s.user_id, s.student_number, s.first_name, s.last_name,
         p.code, s.year_level, ay.label, c.term;

-- One row per office sign-off, with everything the office details sheet needs.
CREATE VIEW v_clearance_items AS
SELECT
  ci.item_id,
  ci.clearance_id,
  c.student_id,
  s.student_number,
  CONCAT(s.first_name, ' ', s.last_name) AS student_name,
  o.office_id,
  o.code          AS office_code,
  o.name          AS office_name,
  o.icon          AS office_icon,
  o.contact_email,
  o.office_hours,
  o.sort_order,
  ci.status,
  ci.task,
  ci.remarks,
  ci.description,
  ci.next_step,
  ci.updated_at,
  ci.approved_at,
  COALESCE(ci.due_at, od.due_at) AS due_at,
  ci.due_at        AS own_due_at,
  od.due_at        AS office_due_at,
  od.note          AS due_note
FROM clearance_items ci
JOIN clearances c ON c.clearance_id = ci.clearance_id
JOIN students s   ON s.student_id = c.student_id
JOIN offices o    ON o.office_id = ci.office_id
LEFT JOIN office_deadlines od
       ON od.office_id = ci.office_id AND od.academic_year_id = c.academic_year_id AND od.term = c.term;


-- =============================================================================
--  8. DEMO DATA
--  Every demo account uses the same password (see README.md). The value below
--  is its bcrypt hash, created with PHP password_hash().
-- =============================================================================

SET @demo_hash = '$2y$10$4ZemjkFlN6fB6Wgi2X.mkO3oQ5sfbsvJm7.RgbHSs4HDaTugutfDW';

INSERT INTO programs (program_id, code, name) VALUES
  (1, 'BSCS', 'Bachelor of Science in Computer Science'),
  (2, 'BSIT', 'Bachelor of Science in Information Technology'),
  (3, 'BSBA', 'Bachelor of Science in Business Administration'),
  (4, 'BSN',  'Bachelor of Science in Nursing');

INSERT INTO academic_years (academic_year_id, label, start_date, end_date, is_current) VALUES
  (1, '2025 - 2026', '2025-08-01', '2026-05-31', 0),
  (2, '2026 - 2027', '2026-08-01', '2027-05-31', 1);

INSERT INTO offices (office_id, code, name, icon, contact_email, office_hours, sort_order) VALUES
  (1, 'library',    'Library',            'book',   'library@cgateway.edu.ph',    'Mon to Fri · 8:00 AM to 5:00 PM', 1),
  (2, 'accounting', 'Accounting',         'wallet', 'accounting@cgateway.edu.ph', 'Mon to Fri · 8:00 AM to 4:00 PM', 2),
  (3, 'registrar',  'Registrar',          'file',   'registrar@cgateway.edu.ph',  'Mon to Fri · 8:00 AM to 5:00 PM', 3),
  (4, 'guidance',   'Guidance Office',    'heart',  'guidance@cgateway.edu.ph',   'Mon to Fri · 8:00 AM to 5:00 PM', 4),
  (5, 'dean',       'Dean''s Office',     'cap',    'dean@cgateway.edu.ph',       'Mon to Fri · 9:00 AM to 4:00 PM', 5),
  (6, 'property',   'Property Custodian', 'box',    'property@cgateway.edu.ph',   'Mon to Fri · 8:00 AM to 5:00 PM', 6);

-- Accounts: 1 demo student, 1 staff member per office, 1 admin.
-- More students are added through the website's sign-up page.
INSERT INTO users (user_id, email, password_hash, role, full_name) VALUES
  (1,  'tapnioariel@cgateway.edu.ph',          @demo_hash, 'student', NULL),
  (10, 'resosojustinlibrary@cgateway.edu.ph',      @demo_hash, 'staff',   NULL),
  (11, 'maligrogerardoaccounting@cgateway.edu.ph', @demo_hash, 'staff',   NULL),
  (12, 'bordeosjamesregistrar@cgateway.edu.ph',    @demo_hash, 'staff',   NULL),
  (13, 'tapnioyelguidance@cgateway.edu.ph',     @demo_hash, 'staff',   NULL),
  (14, 'sundiamaldrindean@cgateway.edu.ph',      @demo_hash, 'staff',   NULL),
  (15, 'maritinitoeugeneproperty@cgateway.edu.ph', @demo_hash, 'staff', NULL),
  (20, 'loretodenveradmin@cgateway.edu.ph',        @demo_hash, 'admin',   'Denver Loreto');

INSERT INTO students (student_id, user_id, student_number, first_name, last_name, program_id, year_level) VALUES
  (1, 1, '2024-00123', 'Ariel', 'Tapnio', 1, 3);

INSERT INTO office_staff (user_id, office_id, full_name, position) VALUES
  (10, 1, 'Justin Edelf Khalil Resoso', 'Head Librarian'),
  (11, 2, 'Gerardo Maligro Jr.',        'Accounting Officer'),
  (12, 3, 'James Bordeos',              'Registrar'),
  (13, 4, 'Yel Tapnio',                 'Guidance Counselor'),
  (14, 5, 'Aldrin Sundiam',             'Dean''s Secretary'),
  (15, 6, 'Eugene Maritinito',          'Property Custodian');

-- Clearances for A.Y 2026 - 2027, 1st Semester
INSERT INTO clearances (clearance_id, student_id, academic_year_id, term) VALUES
  (1, 1, 2, '1st Semester');

-- Ariel Tapnio: matches the website design (4 of 6 cleared)
INSERT INTO clearance_items (clearance_id, office_id, status, task, remarks, description, next_step, approved_at) VALUES
  (1, 1, 'needs_action', 'Return 1 unreturned book', '1 unreturned book',
      'Library is waiting for the book to be returned before your account can be cleared.',
      'Return the book to the Library so the office can clear your account.', NULL),
  (1, 2, 'pending', 'Review balance PHP 3,600', 'Review balance PHP 3,600',
      'Review your balance with Accounting to resolve the pending clearance.',
      'Review your balance with Accounting to resolve the pending clearance.', NULL),
  (1, 3, 'approved', 'Records verified, form submitted', 'Records verified, form submitted',
      'Registrar has already cleared your account.', NULL, '2026-09-28 10:15:00'),
  (1, 4, 'approved', 'No issues, cleared', 'No issues, cleared',
      'Guidance Office has already cleared your account.', NULL, '2026-09-28 13:40:00'),
  (1, 5, 'approved', 'Academic stand okay', 'Academic stand okay',
      'Dean''s Office has already cleared your account.', NULL, '2026-09-29 09:05:00'),
  (1, 6, 'approved', 'No liabilities', 'No liabilities',
      'Property Custodian has already cleared your account.', NULL, '2026-09-29 15:20:00');

-- Audit history for Ariel's approvals (the triggers only log later changes)
INSERT INTO clearance_item_logs (item_id, old_status, new_status, note, changed_by, changed_at)
SELECT ci.item_id, 'pending', 'approved', 'Cleared during clearance week', st.user_id, ci.approved_at
  FROM clearance_items ci
  JOIN office_staff st ON st.office_id = ci.office_id
 WHERE ci.clearance_id = 1 AND ci.status = 'approved';

-- Ariel's bell: two unread, one read (matches the website)
INSERT INTO notifications (user_id, item_id, tone, title, body, is_read, created_at)
SELECT 1, item_id, 'needs_action', 'Library needs action', '1 unreturned book is holding your clearance.', 0, '2026-10-01 09:00:00'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 1;
INSERT INTO notifications (user_id, item_id, tone, title, body, is_read, created_at)
SELECT 1, item_id, 'pending', 'Accounting is reviewing', 'Review your balance of PHP 3,600 to finish clearance.', 0, '2026-10-01 09:05:00'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 2;
INSERT INTO notifications (user_id, item_id, tone, title, body, is_read, created_at)
SELECT 1, item_id, 'approved', 'Registrar cleared you', 'Records verified, form submitted.', 1, '2026-09-28 10:15:00'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 3;

-- Evidence: Accounting is reviewing Ariel's official receipt; Library returned
-- an unsigned book return slip, so Library needs action again.
INSERT INTO submissions (item_id, reference, stored_name, original_name, mime_type, file_size, student_note,
                         status, submitted_by, submitted_at, reviewed_by, reviewed_at, return_category, review_note)
SELECT item_id, 'LIB-2026-0001', 'demo-book-return-slip.pdf', 'book-return-slip.pdf', 'application/pdf', 2123,
       'Returned the book at the circulation desk.', 'returned', 1, '2026-09-30 15:10:00', 10, '2026-10-01 09:00:00',
       'Incomplete or unverified evidence',
       'The slip has no staff signature. Bring the book or your signed slip to the Library, then upload the signed copy.'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 1;
INSERT INTO submissions (item_id, reference, stored_name, original_name, mime_type, file_size, student_note,
                         status, submitted_by, submitted_at)
SELECT item_id, 'ACC-2026-0002', 'demo-official-receipt.pdf', 'official-receipt.pdf', 'application/pdf', 2099,
       'Paid PHP 3,600 at the cashier.', 'submitted', 1, '2026-10-01 09:05:00'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 2;

-- Accounting staff's bell: Ariel's receipt is waiting for review.
INSERT INTO notifications (user_id, item_id, tone, title, body, link, is_read, created_at)
SELECT 11, item_id, 'pending', 'Ariel Tapnio uploaded evidence', 'ACC-2026-0002 · official-receipt.pdf for "Review balance PHP 3,600"', 'review.html?id=2', 0, '2026-10-01 09:05:00'
  FROM clearance_items WHERE clearance_id = 1 AND office_id = 2;

-- Deadlines for the open term, counted from the day the database is imported:
-- Library in 5 days, Accounting in 2 days (both at 5:00 PM).
INSERT INTO office_deadlines (office_id, academic_year_id, term, due_at, note, set_by)
SELECT 1, c.academic_year_id, c.term, TIMESTAMP(CURDATE() + INTERVAL 5 DAY, '17:00:00'), 'Return borrowed books before the semester break.', 10
  FROM clearances c WHERE c.clearance_id = 1;
INSERT INTO office_deadlines (office_id, academic_year_id, term, due_at, note, set_by)
SELECT 2, c.academic_year_id, c.term, TIMESTAMP(CURDATE() + INTERVAL 2 DAY, '17:00:00'), NULL, 11
  FROM clearances c WHERE c.clearance_id = 1;

SET @demo_hash = NULL;
