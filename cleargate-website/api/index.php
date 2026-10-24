<?php
/*
 * ClearGate JSON API
 *
 * One entry point, routed by ?route=NAME. Every response is JSON:
 *   success  { "ok": true,  "data": ... }
 *   failure  { "ok": false, "error": { "code": "...", "message": "..." } }
 *
 * Routes
 *   GET  health              Is the API up and can it reach the database?
 *   POST login               { login, password, remember, portal }  login = email or student number;
 *                            portal 'student' or 'staff' limits which accounts that sign-in page accepts
 *   GET  programs            Degree programs for the sign-up form
 *   POST apply               Public, multipart: student application with a 2x2 photo (Registrar approves it)
 *   POST application-status  Public: { reference, token } or { reference, personal_email, birthday }
 *   POST change-password     Signed in: { current_password, new_password }
 *   GET  applications        Registrar/admin: list (?status=pending|approved|rejected)
 *   GET  application         Registrar/admin: ?id= one application
 *   GET  application-photo   Registrar/admin: ?id=   (students: ?mine=1 for their own photo)
 *   POST review-application  Registrar/admin: { id, decision: approve|reject, reason? }
 *   POST reset-temp-password Registrar/admin: { id }  new temporary password for an approved applicant
 *   POST logout
 *   GET  me                  Signed-in user: profile, current clearance, notifications
 *   POST notifications-read  Mark all of the user's notifications as read
 *   POST forgot              { email }  Start a password reset
 *   POST reset               { token, password }  Finish a password reset
 *   POST submit-evidence     Student, multipart: item_id, file (PDF/JPG/PNG/WEBP), note?
 *   GET  submission-file     ?id=  Streams an evidence file to its student, that office's staff, or admin
 *   GET  pending-list        Staff/admin: evidence waiting for review + today's counts  (admin: ?office=code)
 *   GET  submission          ?id=  Staff/admin: one submission with student, requirement and history
 *   POST review-submission   Staff/admin: { submission_id, decision: approve|return, checklist[], return_category?, reason? }
 *   GET  review-history      Staff/admin: decided submissions  (?decision=approved|returned, admin: ?office=code)
 *   GET  messages            ?item_id=  Conversation between a student and an office about one requirement
 *   POST send-message        { item_id, body }  Student, that office's staff, or admin
 *   GET  message-threads     Staff/admin: conversations for their office (admin: ?office=code)
 *   GET  reports             Registrar/admin: clearance progress for the current term (report-export = CSV)
 *   GET  audit-log           Registrar/admin: everything that changed (?from=&to=, &csv=1)
 *   GET  settings            Admin: offices, programs, academic years (save-office, save-program, delete-program,
 *                            save-year, set-current-year, open-term)
 *   GET  staff-accounts      Admin: staff and admin accounts (save-staff, staff-status, staff-reset-password)
 *   GET  office-queue        Staff/admin: items for their office  (?status=, admin: ?office=code)
 *   POST item-update         Staff/admin: { item_id, status, task?, remarks?, description?, next_step?, note? }
 *
 * Sign-in uses a PHP session cookie (HttpOnly, SameSite=Lax). POST bodies must
 * be JSON, which browsers cannot send cross-site without CORS approval, so
 * other websites cannot submit requests on a signed-in user's behalf.
 */

declare(strict_types=1);

$config = require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ------------------------------------------------------------- Responses */

final class ApiError extends Exception
{
    public function __construct(public int $status, public string $errorCode, string $message)
    {
        parent::__construct($message);
    }
}

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ok(mixed $data = null): never
{
    respond(200, ['ok' => true, 'data' => $data]);
}

function fail(int $status, string $code, string $message): never
{
    throw new ApiError($status, $code, $message);
}

/* -------------------------------------------------------------- Database */

function db(): PDO
{
    static $pdo = null;
    global $config;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config['db_host'], $config['db_port'], $config['db_name']);
        $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET time_zone = '+08:00'");
    }
    return $pdo;
}

function one(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function all(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function run(string $sql, array $params = []): int
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}

/* ------------------------------------------------------- Request helpers */

function method(): string
{
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

function requireMethod(string $expected): void
{
    if (method() !== $expected) {
        header('Allow: ' . $expected);
        fail(405, 'method_not_allowed', "Use $expected for this route.");
    }
}

/** Reads the JSON body of a POST, refusing anything that isn't JSON. */
function body(): array
{
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($type, 'application/json') !== 0) {
        fail(415, 'json_required', 'Send the request body as application/json.');
    }
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($data)) {
        fail(400, 'invalid_json', 'The request body is not valid JSON.');
    }
    return $data;
}

function str(array $data, string $key, int $max = 255): string
{
    $value = $data[$key] ?? '';
    if (!is_string($value)) {
        fail(400, 'invalid_field', "$key must be text.");
    }
    $value = trim($value);
    if (mb_strlen($value) > $max) {
        fail(400, 'invalid_field', "$key is too long (max $max characters).");
    }
    return $value;
}

function optionalStr(array $data, string $key, int $max): ?string
{
    if (!array_key_exists($key, $data) || $data[$key] === null) {
        return null;
    }
    return str($data, $key, $max);
}

/** Rejects POSTs whose Origin header names a different site. */
function checkOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return; // same-origin requests from some browsers and non-browser clients
    }
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '') !== $host) {
        fail(403, 'bad_origin', 'Requests must come from the ClearGate site.');
    }
}

function clientIp(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', 0, 45);
}

/* --------------------------------------------------------------- Session */

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function startSession(): void
{
    global $config;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) ($config['remember_days'] * 86400));
    session_name('CLEARGATE');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => isHttps(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    // Expire idle sessions that were not "remembered".
    if (isset($_SESSION['user_id'])) {
        $idle = time() - ($_SESSION['last_seen'] ?? 0);
        if (empty($_SESSION['remember']) && $idle > $config['idle_timeout_minutes'] * 60) {
            endSession();
            session_start();
        } else {
            $_SESSION['last_seen'] = time();
        }
    }
}

function endSession(): void
{
    $_SESSION = [];
    setcookie(session_name(), '', [
        'expires' => time() - 3600, 'path' => '/', 'secure' => isHttps(), 'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_destroy();
}

/** Returns the signed-in user row or stops with 401. */
function requireUser(array $roles = []): array
{
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        fail(401, 'not_signed_in', 'Please sign in.');
    }
    $user = one('SELECT user_id, email, role, is_active FROM users WHERE user_id = ?', [$userId]);
    if (!$user || !$user['is_active']) {
        endSession();
        fail(401, 'not_signed_in', 'Please sign in.');
    }
    if ($roles && !in_array($user['role'], $roles, true)) {
        fail(403, 'forbidden', 'Your account cannot do that.');
    }
    return $user;
}

/* -------------------------------------------------------------- Payloads */

/* ---- Staff and admin notifications (the bell) */

/** Notifies the active staff of one office, and optionally every admin. */
function notifyOffice(int $officeId, bool $admins, ?int $itemId, string $tone, string $title, string $body, ?string $link): void
{
    $sql = 'SELECT st.user_id FROM office_staff st JOIN users u ON u.user_id = st.user_id AND u.is_active = 1 WHERE st.office_id = ?';
    if ($admins) $sql .= " UNION SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1";
    foreach (all($sql, [$officeId]) as $r) {
        run('INSERT INTO notifications (user_id, item_id, tone, title, body, link) VALUES (?, ?, ?, ?, ?, ?)',
            [$r['user_id'], $itemId, $tone, mb_substr($title, 0, 120), mb_substr($body, 0, 255), $link]);
    }
}

function notifyAdmins(string $tone, string $title, string $body, ?string $link): void
{
    run("INSERT INTO notifications (user_id, tone, title, body, link)
         SELECT user_id, ?, ?, ?, ? FROM users WHERE role = 'admin' AND is_active = 1",
        [$tone, mb_substr($title, 0, 120), mb_substr($body, 0, 255), $link]);
}

function notificationList(int $userId): array
{
    $rows = all(
        'SELECT n.notification_id, n.tone, n.title, n.body, n.link, n.is_read, n.created_at, o.icon AS office_icon
           FROM notifications n
           LEFT JOIN clearance_items ci ON ci.item_id = n.item_id
           LEFT JOIN offices o          ON o.office_id = ci.office_id
          WHERE n.user_id = ?
          ORDER BY n.created_at DESC, n.notification_id DESC
          LIMIT 30',
        [$userId]
    );
    return array_map(fn ($n) => [
        'id'          => (int) $n['notification_id'],
        'tone'        => $n['tone'],
        'title'       => $n['title'],
        'body'        => $n['body'],
        'link'        => $n['link'],
        'office_icon' => $n['office_icon'],
        'unread'      => !$n['is_read'],
        'created_at'  => $n['created_at'],
    ], $rows);
}

/** Everything the website shows after sign-in. */
function profilePayload(array $user): array
{
    if ($user['role'] !== 'student') {
        $staff = one(
            'SELECT st.full_name, st.position, o.code AS office_code, o.name AS office_name,
                    o.contact_email AS office_email, o.office_hours
               FROM office_staff st JOIN offices o ON o.office_id = st.office_id
              WHERE st.user_id = ?',
            [$user['user_id']]
        );
        $offices = all('SELECT code, name FROM offices WHERE is_active = 1 ORDER BY sort_order');
        $mw = ["m.sender_role = 'student'", 'm.read_at IS NULL'];
        $mp = [];
        if ($user['role'] === 'staff' && $staff) {
            $mw[] = 'o.code = ?';
            $mp[] = $staff['office_code'];
        }
        $unread = one('SELECT COUNT(*) AS n FROM office_messages m JOIN clearance_items ci ON ci.item_id = m.item_id
                         JOIN offices o ON o.office_id = ci.office_id WHERE ' . implode(' AND ', $mw), $mp)['n'] ?? 0;
        return ['user' => publicUser($user), 'staff' => $staff, 'offices' => $offices, 'unread_messages' => (int) $unread, 'server_now' => dbNow(),
                'notifications' => notificationList((int) $user['user_id'])];
    }

    $student = one(
        'SELECT s.student_id, s.student_number, s.first_name, s.last_name, s.year_level, s.application_id,
                p.code AS program, p.name AS program_name
           FROM students s JOIN programs p ON p.program_id = s.program_id
          WHERE s.user_id = ?',
        [$user['user_id']]
    );

    $clearance = $student ? one(
        "SELECT v.*
           FROM v_clearance_summary v
           JOIN clearances c       ON c.clearance_id = v.clearance_id
           JOIN academic_years ay  ON ay.academic_year_id = c.academic_year_id
          WHERE v.student_id = ?
          ORDER BY ay.start_date DESC, FIELD(c.term, 'Summer', '2nd Semester', '1st Semester')
          LIMIT 1",
        [$student['student_id']]
    ) : null;

    $items = $clearance ? all(
        'SELECT item_id, office_code, office_name, office_icon, contact_email, office_hours,
                status, task, remarks, description, next_step, updated_at, approved_at, due_at, own_due_at, due_note
           FROM v_clearance_items
          WHERE clearance_id = ?
          ORDER BY FIELD(status, \'needs_action\', \'pending\', \'approved\'), sort_order',
        [$clearance['clearance_id']]
    ) : [];

    $latest = [];
    if ($items) {
        $ids = array_map(fn ($i) => (int) $i['item_id'], $items);
        $rows = all(
            'SELECT submission_id, item_id, reference, status, original_name, mime_type, file_size, student_note,
                    submitted_at, reviewed_at, return_category, review_note
               FROM submissions
              WHERE status <> \'replaced\' AND item_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')
              ORDER BY submitted_at, submission_id',
            $ids
        );
        foreach ($rows as $r) {
            $latest[(int) $r['item_id']] = [
                'id'              => (int) $r['submission_id'],
                'reference'       => $r['reference'],
                'status'          => $r['status'],
                'file_name'       => $r['original_name'],
                'mime_type'       => $r['mime_type'],
                'file_size'       => (int) $r['file_size'],
                'note'            => $r['student_note'],
                'submitted_at'    => $r['submitted_at'],
                'reviewed_at'     => $r['reviewed_at'],
                'return_category' => $r['return_category'],
                'review_note'     => $r['review_note'],
            ];
        }
    }

    $msgCounts = [];
    if ($items) {
        $ids = array_map(fn ($i) => (int) $i['item_id'], $items);
        foreach (all("SELECT item_id, COUNT(*) AS total, SUM(sender_role <> 'student' AND read_at IS NULL) AS unread
                        FROM office_messages WHERE item_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ')
                       GROUP BY item_id', $ids) as $mc) {
            $msgCounts[(int) $mc['item_id']] = ['total' => (int) $mc['total'], 'unread' => (int) $mc['unread']];
        }
    }

    $notifications = notificationList((int) $user['user_id']);

    return [
        'user'          => publicUser($user),
        'server_now'    => dbNow(),
        'student'       => $student ? [
            'student_number' => $student['student_number'],
            'first_name'     => $student['first_name'],
            'last_name'      => $student['last_name'],
            'year_level'     => (int) $student['year_level'],
            'program'        => $student['program'],
            'program_name'   => $student['program_name'],
            'details'        => $student['application_id'] ? applicationDetails((int) $student['application_id']) : null,
            'contact'        => studentContact((int) $user['user_id']),
        ] : null,
        'clearance'     => $clearance ? [
            'clearance_id'       => (int) $clearance['clearance_id'],
            'academic_year'      => $clearance['academic_year'],
            'term'               => $clearance['term'],
            'total_offices'      => (int) $clearance['total_offices'],
            'approved_count'     => (int) $clearance['approved_count'],
            'pending_count'      => (int) $clearance['pending_count'],
            'needs_action_count' => (int) $clearance['needs_action_count'],
            'percent_complete'   => (int) $clearance['percent_complete'],
            'is_eligible'        => (bool) $clearance['is_eligible'],
        ] : null,
        'items'         => array_map(fn ($i) => [
            'item_id'     => (int) $i['item_id'],
            'office_code' => $i['office_code'],
            'office_name' => $i['office_name'],
            'office_icon' => $i['office_icon'],
            'email'       => $i['contact_email'],
            'hours'       => $i['office_hours'],
            'status'      => $i['status'],
            'due_at'      => $i['due_at'],
            'due_own'     => $i['own_due_at'] !== null,
            'due_note'    => $i['due_note'],
            'task'        => $i['task'],
            'remarks'     => $i['remarks'],
            'description' => $i['description'],
            'next_step'   => $i['next_step'],
            'updated_at'  => $i['updated_at'],
            'approved_at' => $i['approved_at'],
            'submission'  => $latest[(int) $i['item_id']] ?? null,
            'messages'    => $msgCounts[(int) $i['item_id']] ?? ['total' => 0, 'unread' => 0],
        ], $items),
        'notifications' => $notifications,
    ];
}

function publicUser(array $user): array
{
    $times = one('SELECT created_at, last_login_at, full_name, personal_email, must_change_password, phone, avatar_name FROM users WHERE user_id = ?', [$user['user_id']]);
    return [
        'id'            => (int) $user['user_id'],
        'email'         => $user['email'],
        'role'          => $user['role'],
        'full_name'     => $times['full_name'] ?? null,
        'personal_email' => $times['personal_email'] ?? null,
        'phone'         => $times['phone'] ?? null,
        'avatar'        => avatarUrl((int) $user['user_id'], $times['avatar_name'] ?? null),
        'must_change_password' => !empty($times['must_change_password']),
        'created_at'    => $times['created_at'] ?? null,
        'last_login_at' => $times['last_login_at'] ?? null,
    ];
}

/* ---------------------------------------------------------------- Routes */

function routeHealth(): never
{
    one('SELECT 1 AS up');
    ok(['api' => 'cleargate', 'database' => 'connected']);
}

function routeLogin(): never
{
    global $config;
    requireMethod('POST');
    checkOrigin();
    $in = body();
    $login = str($in, 'login', 190);
    $password = $in['password'] ?? '';
    if ($login === '' || !is_string($password) || $password === '') {
        fail(400, 'missing_fields', 'Enter your student ID or email and your password.');
    }

    $window = (int) $config['lockout_minutes'];
    $byLogin = one(
        "SELECT COUNT(*) AS n FROM login_attempts
          WHERE login = ? AND succeeded = 0 AND attempted_at > NOW() - INTERVAL $window MINUTE",
        [mb_strtolower($login)]
    )['n'];
    $byIp = one(
        "SELECT COUNT(*) AS n FROM login_attempts
          WHERE ip_address = ? AND succeeded = 0 AND attempted_at > NOW() - INTERVAL $window MINUTE",
        [clientIp()]
    )['n'];
    if ($byLogin >= $config['max_failures_per_login'] || $byIp >= $config['max_failures_per_ip']) {
        fail(429, 'too_many_attempts', "Too many failed sign-ins. Try again in $window minutes.");
    }

    $user = one(
        'SELECT u.user_id, u.email, u.role, u.is_active, u.password_hash
           FROM users u
           LEFT JOIN students s ON s.user_id = u.user_id
          WHERE u.email = ? OR s.student_number = ?
          LIMIT 1',
        [mb_strtolower($login), $login]
    );

    // Verify against a dummy hash when the user doesn't exist so response
    // time doesn't reveal which accounts are real.
    $hash = $user['password_hash'] ?? '$2y$10$BU52LP0meAi69CKjT8H9a.GPPxe0E2aYuenaPPk.HVGOaefQS7HNK';
    $valid = password_verify($password, $hash) && $user && $user['is_active'];

    run('INSERT INTO login_attempts (login, ip_address, succeeded) VALUES (?, ?, ?)',
        [mb_strtolower($login), clientIp(), $valid ? 1 : 0]);

    if (!$valid) {
        fail(401, 'invalid_credentials', 'That student ID/email and password don\'t match.');
    }

    // Each sign-in page only lets its own kind of account in.
    $portal = $in['portal'] ?? '';
    if ($portal === 'student' && $user['role'] !== 'student') {
        fail(403, 'wrong_portal', 'This sign-in is for students. Office staff and admins, use the Staff sign-in page.');
    }
    if ($portal === 'staff' && $user['role'] === 'student') {
        fail(403, 'wrong_portal', 'This sign-in is for office staff and admins. Students, use the Student sign-in page.');
    }

    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        run('UPDATE users SET password_hash = ? WHERE user_id = ?',
            [password_hash($password, PASSWORD_DEFAULT), $user['user_id']]);
    }
    run('UPDATE users SET last_login_at = NOW() WHERE user_id = ?', [$user['user_id']]);

    session_regenerate_id(true);
    $remember = !empty($in['remember']);
    $_SESSION['user_id'] = (int) $user['user_id'];
    $_SESSION['remember'] = $remember;
    $_SESSION['last_seen'] = time();
    if ($remember) {
        setcookie(session_name(), session_id(), [
            'expires'  => time() + $config['remember_days'] * 86400,
            'path'     => '/',
            'secure'   => isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    unset($user['password_hash']);
    ok(profilePayload($user));
}

function routePrograms(): never
{
    requireMethod('GET');
    ok(all('SELECT code, name FROM programs ORDER BY name'));
}

/* ------------------------------------------------- Student applications */

const ADMISSION_TYPES = ['New student', 'Transferee', 'Returnee', 'Cross-enrollee'];
const CIVIL_STATUSES  = ['Single', 'Married', 'Widowed', 'Separated'];

/** Registrar staff or admin only. */
function requireRegistrar(): array
{
    $user = requireUser(['staff', 'admin']);
    if ($user['role'] === 'staff') {
        $office = one('SELECT o.code FROM office_staff st JOIN offices o ON o.office_id = st.office_id WHERE st.user_id = ?', [$user['user_id']]);
        if (($office['code'] ?? '') !== 'registrar') {
            fail(403, 'forbidden', 'Only the Registrar and admins can manage applications.');
        }
    }
    return $user;
}

function photoDir(): string
{
    $dir = uploadDir() . DIRECTORY_SEPARATOR . 'photos';
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        fail(500, 'upload_dir', 'The server cannot store photos. Check that api/uploads is writable.');
    }
    return $dir;
}

/** Required text field from a multipart form. */
function formStr(string $key, int $max, bool $required = true, string $label = ''): ?string
{
    $v = trim((string) ($_POST[$key] ?? ''));
    $v = preg_replace('/\s+/u', ' ', $v);
    if ($v === '') {
        if ($required) fail(400, 'missing_field', ($label ?: $key) . ' is required.');
        return null;
    }
    if (mb_strlen($v) > $max) {
        fail(400, 'invalid_field', ($label ?: $key) . " is too long (max $max characters).");
    }
    return $v;
}

function formPhone(string $key, string $label): string
{
    $v = formStr($key, 20, true, $label);
    if (!preg_match('/^\+?[0-9][0-9 \-]{6,18}$/', $v)) {
        fail(400, 'invalid_field', "$label must be a phone number, e.g. 09171234567.");
    }
    return $v;
}

/** Lowercase a-z only, for building school emails (handles ñ and accents). */
function asciiSlug(string $s): string
{
    $map = ['ñ' => 'n', 'Ñ' => 'n', 'á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'ö' => 'o', 'ú' => 'u', 'ù' => 'u',
            'û' => 'u', 'ü' => 'u', 'Á' => 'a', 'É' => 'e', 'Í' => 'i', 'Ó' => 'o', 'Ú' => 'u'];
    return preg_replace('/[^a-z]/', '', strtolower(strtr($s, $map)));
}

function tempPassword(): string
{
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < 10; $i++) {
        $out .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $out;
}

function applicationDetails(int $id): ?array
{
    $a = one('SELECT a.*, p.code AS program, p.name AS program_name FROM applications a JOIN programs p ON p.program_id = a.program_id WHERE a.application_id = ?', [$id]);
    if (!$a) return null;
    return [
        'reference'      => $a['reference'],
        'admission_type' => $a['admission_type'],
        'middle_name'    => $a['middle_name'],
        'suffix'         => $a['suffix'],
        'sex'            => $a['sex'],
        'civil_status'   => $a['civil_status'],
        'birthday'       => $a['birthday'],
        'place_of_birth' => $a['place_of_birth'],
        'personal_email' => $a['personal_email'],
        'contact_number' => $a['contact_number'],
        'religion'       => $a['religion'],
        'permanent_address' => $a['permanent_address'],
        'current_address' => implode(', ', array_filter([$a['street'], $a['barangay'], $a['city'], $a['province'], $a['region'], $a['postal_code']])),
        'father'         => trim($a['father_first'] . ' ' . ($a['father_middle'] ?? '') . ' ' . $a['father_last']) . ' (' . $a['father_occupation'] . ')',
        'mother'         => trim($a['mother_first'] . ' ' . ($a['mother_middle'] ?? '') . ' ' . $a['mother_last']) . ' (' . $a['mother_occupation'] . ')',
        'guardian'       => trim($a['guardian_first'] . ' ' . ($a['guardian_middle'] ?? '') . ' ' . $a['guardian_last']) . ' (' . $a['guardian_relationship'] . ', ' . $a['guardian_contact'] . ')',
        'has_photo'      => !empty($a['photo_name']),
    ];
}

function routeApply(): never
{
    global $config;
    requireMethod('POST');
    checkOrigin();
    if (($_SERVER['HTTP_X_CLEARGATE'] ?? '') !== '1') {
        fail(400, 'bad_request', 'Apply from the ClearGate website.');
    }

    $window = (int) $config['lockout_minutes'];
    $recent = one("SELECT COUNT(*) AS n FROM login_attempts WHERE ip_address = ? AND login LIKE 'apply:%' AND attempted_at > NOW() - INTERVAL $window MINUTE", [clientIp()])['n'];
    if ($recent >= 10) {
        fail(429, 'too_many_attempts', "Too many applications from this computer. Try again in $window minutes.");
    }

    $f = [];
    $f['admission_type'] = formStr('admission_type', 40, true, 'Admission type');
    if (!in_array($f['admission_type'], ADMISSION_TYPES, true)) fail(400, 'invalid_field', 'Choose an admission type from the list.');
    $program = one('SELECT program_id FROM programs WHERE code = ?', [formStr('program', 10, true, 'Program')]);
    if (!$program) fail(400, 'invalid_field', 'Choose a program from the list.');
    $year = filter_var($_POST['year_level'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4]]);
    if (!$year) fail(400, 'invalid_field', 'Choose the academic level you are applying for (1st to 4th year).');

    $f['last_name']   = formStr('last_name', 60, true, 'Last name');
    $f['first_name']  = formStr('first_name', 60, true, 'First name');
    $f['middle_name'] = formStr('middle_name', 60, false);
    $f['suffix']      = formStr('suffix', 10, false);
    $f['sex']         = formStr('sex', 10, true, 'Sex');
    if (!in_array($f['sex'], ['Male', 'Female'], true)) fail(400, 'invalid_field', 'Choose Male or Female.');
    $f['civil_status'] = formStr('civil_status', 20, true, 'Civil status');
    if (!in_array($f['civil_status'], CIVIL_STATUSES, true)) fail(400, 'invalid_field', 'Choose a civil status from the list.');
    $f['birthday'] = formStr('birthday', 10, true, 'Birthday');
    $bd = DateTime::createFromFormat('!Y-m-d', $f['birthday']);
    if (!$bd || $bd->format('Y-m-d') !== $f['birthday'] || $bd > new DateTime('-10 years') || $bd < new DateTime('-100 years')) {
        fail(400, 'invalid_field', 'Enter a valid birthday.');
    }
    $f['place_of_birth'] = formStr('place_of_birth', 120, false);
    $f['personal_email'] = mb_strtolower(formStr('personal_email', 190, true, 'Email'));
    if (!filter_var($f['personal_email'], FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_field', 'Enter a valid personal email address.');
    if (str_ends_with($f['personal_email'], '@cgateway.edu.ph')) fail(400, 'invalid_field', 'Use your personal email, not a school address.');
    $f['contact_number']    = formPhone('contact_number', 'Contact number');
    $f['religion']          = formStr('religion', 60, false);
    $f['permanent_address'] = formStr('permanent_address', 255, false);
    $f['region']      = formStr('region', 80, true, 'Region');
    $f['province']    = formStr('province', 80, true, 'Province');
    $f['city']        = formStr('city', 80, true, 'City / Municipality');
    $f['barangay']    = formStr('barangay', 80, true, 'Barangay');
    $f['street']      = formStr('street', 160, true, 'House no. / Street / Subdivision');
    $f['postal_code'] = formStr('postal_code', 10, false);
    if ($f['postal_code'] !== null && !preg_match('/^\d{4}$/', $f['postal_code'])) fail(400, 'invalid_field', 'Postal code must be 4 digits.');
    foreach (['father' => 'Father', 'mother' => 'Mother'] as $k => $label) {
        $f[$k . '_first']      = formStr($k . '_first', 60, true, "$label's first name");
        $f[$k . '_middle']     = formStr($k . '_middle', 60, false);
        $f[$k . '_last']       = formStr($k . '_last', 60, true, "$label's last name");
        $f[$k . '_occupation'] = formStr($k . '_occupation', 80, true, "$label's occupation");
    }
    $f['guardian_first']        = formStr('guardian_first', 60, true, "Guardian's first name");
    $f['guardian_middle']       = formStr('guardian_middle', 60, false);
    $f['guardian_last']         = formStr('guardian_last', 60, true, "Guardian's last name");
    $f['guardian_relationship'] = formStr('guardian_relationship', 40, true, 'Relationship to guardian');
    $f['guardian_contact']      = formPhone('guardian_contact', 'Guardian contact number');

    if (one('SELECT 1 AS x FROM users WHERE personal_email = ? OR email = ?', [$f['personal_email'], $f['personal_email']])) {
        fail(409, 'already_registered', 'That email already has a ClearGate account. Sign in, or use Forgot password.');
    }
    if (one("SELECT 1 AS x FROM applications WHERE personal_email = ? AND status = 'pending'", [$f['personal_email']])) {
        fail(409, 'already_pending', 'An application with that email is already waiting for the Registrar. Check its status instead.');
    }

    // The 2x2 photo is optional.
    $photo = $_FILES['photo'] ?? null;
    $hasPhoto = $photo && ($photo['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    $type = null;
    if ($hasPhoto) {
    if (in_array($photo['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $photo['size'] > 5 * 1024 * 1024) {
        fail(413, 'file_too_large', 'Your photo is too large. The limit is 5 MB.');
    }
    if ($photo['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($photo['tmp_name'])) fail(400, 'upload_failed', 'The photo upload did not finish. Try again.');
    $type = sniffType($photo['tmp_name']);
    if (!$type || $type[0] === 'application/pdf') fail(415, 'file_type', 'The photo must be a JPG, PNG or WEBP image.');
    }

    run('INSERT INTO login_attempts (login, ip_address, succeeded) VALUES (?, ?, 0)', ['apply:' . $f['personal_email'], clientIp()]);

    $stored = null;
    $target = null;
    if ($hasPhoto) {
        $stored = bin2hex(random_bytes(16)) . '.' . $type[1];
        $target = photoDir() . DIRECTORY_SEPARATOR . $stored;
        if (!move_uploaded_file($photo['tmp_name'], $target)) fail(500, 'upload_failed', 'The server could not save your photo.');
    }

    $token = bin2hex(random_bytes(24));
    $cols = array_keys($f);
    try {
        run('INSERT INTO applications (status_token, photo_name, photo_mime, program_id, year_level, ' . implode(', ', $cols) . ')
             VALUES (?, ?, ?, ?, ?, ' . implode(', ', array_fill(0, count($cols), '?')) . ')',
            array_merge([hash('sha256', $token), $stored, $type[0] ?? null, $program['program_id'], $year], array_values($f)));
        $id = (int) db()->lastInsertId();
        $reference = 'APP-' . date('Y') . '-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT);
        run('UPDATE applications SET reference = ? WHERE application_id = ?', [$reference, $id]);
        $reg = one("SELECT office_id FROM offices WHERE code = 'registrar'");
        $title = 'New application: ' . trim(($f['first_name'] ?? '') . ' ' . ($f['last_name'] ?? ''));
        $body = $reference . ' is waiting for review.';
        if ($reg) notifyOffice((int) $reg['office_id'], true, null, 'pending', $title, $body, 'applications.html?id=' . $id);
        else notifyAdmins('pending', $title, $body, 'applications.html?id=' . $id);
    } catch (Throwable $e) {
        if ($target) @unlink($target);
        throw $e;
    }
    ok(['reference' => $reference, 'token' => $token]);
}

function routeApplicationStatus(): never
{
    requireMethod('POST');
    checkOrigin();
    $in = body();
    $reference = strtoupper(str($in, 'reference', 20));
    $token = (string) ($in['token'] ?? '');
    if ($token !== '') {
        $a = one('SELECT * FROM applications WHERE reference = ? AND status_token = ?', [$reference, hash('sha256', $token)]);
    } else {
        $email = mb_strtolower(str($in, 'personal_email', 190));
        $birthday = str($in, 'birthday', 10);
        $a = one('SELECT * FROM applications WHERE reference = ? AND personal_email = ? AND birthday = ?', [$reference, $email, $birthday]);
    }
    if (!$a) {
        fail(404, 'not_found', 'We could not find an application with those details. Check the reference number, email and birthday.');
    }
    $out = [
        'reference'    => $a['reference'],
        'status'       => $a['status'],
        'name'         => $a['first_name'] . ' ' . $a['last_name'],
        'submitted_at' => $a['submitted_at'],
        'reviewed_at'  => $a['reviewed_at'],
        'reject_reason' => $a['status'] === 'rejected' ? $a['reject_reason'] : null,
    ];
    if ($a['status'] === 'approved' && $a['user_id']) {
        $acc = one('SELECT u.email, s.student_number, u.must_change_password FROM users u JOIN students s ON s.user_id = u.user_id WHERE u.user_id = ?', [$a['user_id']]);
        $out['student_number'] = $acc['student_number'] ?? null;
        $out['student_email'] = $acc['email'] ?? null;
        $out['temp_password'] = $a['temp_password'];   // null once the student has set their own
    }
    ok($out);
}

function routeChangePassword(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser();
    $in = body();
    $current = $in['current_password'] ?? '';
    $new = $in['new_password'] ?? '';
    $row = one('SELECT password_hash FROM users WHERE user_id = ?', [$user['user_id']]);
    if (!is_string($current) || !password_verify($current, $row['password_hash'])) {
        fail(400, 'wrong_password', 'Your current password is not correct.');
    }
    if (!is_string($new) || mb_strlen($new) < 8 || mb_strlen($new) > 128) {
        fail(400, 'weak_password', 'Your new password needs 8 to 128 characters.');
    }
    if ($new === $current) {
        fail(400, 'same_password', 'Choose a password different from your current one.');
    }
    run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?', [password_hash($new, PASSWORD_DEFAULT), $user['user_id']]);
    run('UPDATE applications SET temp_password = NULL WHERE user_id = ?', [$user['user_id']]);
    ok(['message' => 'Your password has been changed.']);
}

function applicationRow(array $a): array
{
    return [
        'id'             => (int) $a['application_id'],
        'reference'      => $a['reference'],
        'status'         => $a['status'],
        'name'           => trim($a['last_name'] . ', ' . $a['first_name'] . ' ' . ($a['middle_name'] ?? '') . ' ' . ($a['suffix'] ?? '')),
        'first_name'     => $a['first_name'],
        'last_name'      => $a['last_name'],
        'program'        => $a['program'],
        'program_name'   => $a['program_name'],
        'year_level'     => (int) $a['year_level'],
        'admission_type' => $a['admission_type'],
        'personal_email' => $a['personal_email'],
        'contact_number' => $a['contact_number'],
        'submitted_at'   => $a['submitted_at'],
        'reviewed_at'    => $a['reviewed_at'],
        'has_photo'      => !empty($a['photo_name']),
        'reviewer'       => reviewerName($a['reviewer_full'] ?? null, $a['reviewer_role'] ?? null, $a['reviewer_email'] ?? null),
    ];
}

const APP_SELECT = 'SELECT a.*, p.code AS program, p.name AS program_name,
                           COALESCE(rs.full_name, ru.full_name) AS reviewer_full, ru.role AS reviewer_role, ru.email AS reviewer_email
                      FROM applications a
                      JOIN programs p ON p.program_id = a.program_id
                      LEFT JOIN users ru ON ru.user_id = a.reviewed_by
                      LEFT JOIN office_staff rs ON rs.user_id = a.reviewed_by';

function routeApplications(): never
{
    requireMethod('GET');
    requireRegistrar();
    $where = '1 = 1';
    $params = [];
    if (!empty($_GET['status']) && in_array($_GET['status'], ['pending', 'approved', 'rejected'], true)) {
        $where = 'a.status = ?';
        $params[] = $_GET['status'];
    }
    $rows = all(APP_SELECT . " WHERE $where ORDER BY a.status = 'pending' DESC, a.submitted_at DESC LIMIT 500", $params);
    $counts = one("SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected,
                          SUM(DATE(submitted_at) = CURDATE()) AS today FROM applications");
    ok([
        'counts' => array_map('intval', $counts ?? []),
        'rows'   => array_map('applicationRow', $rows),
    ]);
}

function loadApplication(): array
{
    $id = filter_var($_GET['id'] ?? ($GLOBALS['__app_id'] ?? null), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $a = $id ? one(APP_SELECT . ' WHERE a.application_id = ?', [$id]) : null;
    if (!$a) fail(404, 'not_found', 'That application was not found.');
    return $a;
}

function applicationFull(array $a): array
{
    $out = applicationRow($a);
    foreach (['middle_name', 'suffix', 'sex', 'civil_status', 'birthday', 'place_of_birth', 'religion', 'permanent_address',
              'region', 'province', 'city', 'barangay', 'street', 'postal_code',
              'father_first', 'father_middle', 'father_last', 'father_occupation',
              'mother_first', 'mother_middle', 'mother_last', 'mother_occupation',
              'guardian_first', 'guardian_middle', 'guardian_last', 'guardian_relationship', 'guardian_contact', 'reject_reason'] as $k) {
        $out[$k] = $a[$k];
    }
    if ($a['status'] === 'approved' && $a['user_id']) {
        $acc = one('SELECT u.email, s.student_number FROM users u JOIN students s ON s.user_id = u.user_id WHERE u.user_id = ?', [$a['user_id']]);
        $out['student_number'] = $acc['student_number'] ?? null;
        $out['student_email'] = $acc['email'] ?? null;
        $out['temp_password'] = $a['temp_password'];
    }
    return $out;
}

function routeApplication(): never
{
    requireMethod('GET');
    requireRegistrar();
    ok(applicationFull(loadApplication()));
}

function routeApplicationPhoto(): never
{
    requireMethod('GET');
    $user = requireUser();
    if (!empty($_GET['mine'])) {
        $a = one('SELECT a.photo_name, a.photo_mime FROM students s JOIN applications a ON a.application_id = s.application_id WHERE s.user_id = ?', [$user['user_id']]);
        if (!$a) fail(404, 'not_found', 'No photo on file.');
    } else {
        requireRegistrar();
        $a = loadApplication();
    }
    if (empty($a['photo_name'])) fail(404, 'no_photo', 'No photo was uploaded.');
    $path = photoDir() . DIRECTORY_SEPARATOR . basename($a['photo_name']);
    if (!is_file($path)) fail(404, 'file_missing', 'The photo file is missing from the server.');
    header_remove('Content-Type');
    header('Content-Type: ' . $a['photo_mime']);
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=300');
    readfile($path);
    exit;
}

/** Next student number for this year, e.g. 2026-00004. */
function nextStudentNumber(): string
{
    $year = date('Y');
    $row = one("SELECT MAX(CAST(SUBSTRING(student_number, 6) AS UNSIGNED)) AS n FROM students WHERE student_number LIKE ?", [$year . '-%']);
    return $year . '-' . str_pad((string) (((int) ($row['n'] ?? 0)) + 1), 5, '0', STR_PAD_LEFT);
}

/** surname + first name @cgateway.edu.ph, with a number added if taken. */
function studentEmail(string $last, string $first): string
{
    $base = asciiSlug($last) . asciiSlug($first);
    if ($base === '') $base = 'student';
    $email = $base . '@cgateway.edu.ph';
    for ($i = 2; one('SELECT 1 AS x FROM users WHERE email = ?', [$email]); $i++) {
        $email = $base . $i . '@cgateway.edu.ph';
    }
    return $email;
}

function routeReviewApplication(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireRegistrar();
    $in = body();
    $GLOBALS['__app_id'] = $in['id'] ?? null;
    $a = loadApplication();
    if ($a['status'] !== 'pending') fail(409, 'already_reviewed', 'This application has already been ' . $a['status'] . '.');
    $decision = $in['decision'] ?? '';

    if ($decision === 'reject') {
        $reason = str($in, 'reason', 255);
        if (mb_strlen($reason) < 5) fail(400, 'reason_required', 'Tell the applicant why (at least 5 characters).');
        run("UPDATE applications SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE application_id = ?",
            [$reason, $user['user_id'], $a['application_id']]);
    } elseif ($decision === 'approve') {
        if (one('SELECT 1 AS x FROM users WHERE personal_email = ?', [$a['personal_email']])) {
            fail(409, 'already_registered', 'An account with this personal email already exists.');
        }
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $number = nextStudentNumber();
            $email = studentEmail($a['last_name'], $a['first_name']);
            $temp = tempPassword();
            run("INSERT INTO users (email, password_hash, role, personal_email, must_change_password) VALUES (?, ?, 'student', ?, 1)",
                [$email, password_hash($temp, PASSWORD_DEFAULT), $a['personal_email']]);
            $userId = (int) $pdo->lastInsertId();
            run('INSERT INTO students (user_id, student_number, first_name, last_name, program_id, year_level, application_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$userId, $number, $a['first_name'], $a['last_name'], $a['program_id'], $a['year_level'], $a['application_id']]);
            $studentId = (int) $pdo->lastInsertId();
            $yearRow = one('SELECT academic_year_id FROM academic_years WHERE is_current = 1 LIMIT 1');
            if ($yearRow) {
                $term = one("SELECT c.term FROM clearances c WHERE c.academic_year_id = ? ORDER BY FIELD(c.term, 'Summer', '2nd Semester', '1st Semester') LIMIT 1",
                            [$yearRow['academic_year_id']])['term'] ?? '1st Semester';
                $stmt = $pdo->prepare('CALL sp_open_clearance(?, ?, ?)');
                $stmt->execute([$studentId, $yearRow['academic_year_id'], $term]);
                do { $stmt->fetchAll(); } while ($stmt->nextRowset());
                $stmt->closeCursor();
            }
            run("UPDATE applications SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), user_id = ?, temp_password = ? WHERE application_id = ?",
                [$user['user_id'], $userId, $temp, $a['application_id']]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    } else {
        fail(400, 'invalid_request', 'decision must be approve or reject.');
    }
    ok(applicationFull(loadApplication()));
}

function routeResetTempPassword(): never
{
    requireMethod('POST');
    checkOrigin();
    requireRegistrar();
    $in = body();
    $GLOBALS['__app_id'] = $in['id'] ?? null;
    $a = loadApplication();
    if ($a['status'] !== 'approved' || !$a['user_id']) fail(409, 'not_approved', 'Only approved applications have an account.');
    $temp = tempPassword();
    run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE user_id = ?', [password_hash($temp, PASSWORD_DEFAULT), $a['user_id']]);
    run('UPDATE applications SET temp_password = ? WHERE application_id = ?', [$temp, $a['application_id']]);
    ok(applicationFull(loadApplication()));
}

function routeLogout(): never
{
    requireMethod('POST');
    checkOrigin();
    endSession();
    ok();
}

function routeMe(): never
{
    requireMethod('GET');
    ok(profilePayload(requireUser()));
}

function routeNotificationsRead(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser();
    $id = filter_var(body()['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id) {
        run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND notification_id = ?', [$user['user_id'], $id]);
    } else {
        run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [$user['user_id']]);
    }
    ok();
}

function routeForgot(): never
{
    global $config;
    requireMethod('POST');
    checkOrigin();
    $in = body();
    $email = mb_strtolower(str($in, 'email', 190));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(400, 'invalid_email', 'Enter a valid email address.');
    }

    $data = ['message' => 'If that email has an account, a reset link is on its way.'];
    $user = one('SELECT user_id FROM users WHERE (email = ? OR personal_email = ?) AND is_active = 1 LIMIT 1', [$email, $email]);
    if ($user) {
        $token = bin2hex(random_bytes(32));
        run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [$user['user_id']]);
        run('INSERT INTO password_resets (user_id, token_hash, expires_at)
             VALUES (?, ?, NOW() + INTERVAL 30 MINUTE)',
            [$user['user_id'], hash('sha256', $token)]);
        // A real deployment emails a link containing $token here.
        if ($config['demo_mode']) {
            $data['demo_token'] = $token;
        }
    }
    ok($data);
}

function routeReset(): never
{
    requireMethod('POST');
    checkOrigin();
    $in = body();
    $token = str($in, 'token', 128);
    $password = $in['password'] ?? '';
    if (!is_string($password) || mb_strlen($password) < 8 || mb_strlen($password) > 128) {
        fail(400, 'weak_password', 'Your new password needs 8 to 128 characters.');
    }

    $reset = one(
        'SELECT reset_id, user_id FROM password_resets
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
        [hash('sha256', $token)]
    );
    if (!$reset) {
        fail(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    }

    db()->beginTransaction();
    run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?',
        [password_hash($password, PASSWORD_DEFAULT), $reset['user_id']]);
    run('UPDATE applications SET temp_password = NULL WHERE user_id = ?', [$reset['user_id']]);
    run('UPDATE password_resets SET used_at = NOW() WHERE reset_id = ?', [$reset['reset_id']]);
    db()->commit();
    ok(['message' => 'Your password has been reset.']);
}

/* ------------------------------------------------------ Evidence uploads */

/** The office a staff member signs for (null for admins). */
function staffOfficeId(array $user): ?int
{
    if ($user['role'] !== 'staff') {
        return null;
    }
    $row = one('SELECT office_id FROM office_staff WHERE user_id = ?', [$user['user_id']]);
    if (!$row) {
        fail(403, 'no_office', 'Your staff account is not linked to an office.');
    }
    return (int) $row['office_id'];
}

/** Adds the office filter for staff (their office) or admin (?office=code). */
function officeFilter(array $user, array &$where, array &$params, string $officeCol = 'o.office_id', string $codeCol = 'o.code'): void
{
    $officeId = staffOfficeId($user);
    if ($officeId !== null) {
        $where[] = "$officeCol = ?";
        $params[] = $officeId;
    } elseif (!empty($_GET['office'])) {
        $where[] = "$codeCol = ?";
        $params[] = (string) $_GET['office'];
    }
}

function reviewerName(?string $fullName, ?string $role, ?string $email): ?string
{
    if ($fullName) return $fullName;
    if ($role === 'admin') return 'System Administrator';
    return $email;
}

/** Detects the real file type from its first bytes (not from the name the browser sent). */
function sniffType(string $path): ?array
{
    $head = (string) file_get_contents($path, false, null, 0, 16);
    if (str_starts_with($head, '%PDF-'))                                   return ['application/pdf', 'pdf'];
    if (str_starts_with($head, "\xFF\xD8\xFF"))                             return ['image/jpeg', 'jpg'];
    if (str_starts_with($head, "\x89PNG\r\n\x1A\n"))                        return ['image/png', 'png'];
    if (str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP')   return ['image/webp', 'webp'];
    return null;
}

function uploadDir(): string
{
    global $config;
    $dir = rtrim($config['upload_dir'] ?? (__DIR__ . '/uploads'), '/\\');
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        fail(500, 'upload_dir', 'The server cannot store uploads. Check that api/uploads exists and is writable.');
    }
    return $dir;
}

function routeSubmitEvidence(): never
{
    global $config;
    requireMethod('POST');
    checkOrigin();
    // Browsers cannot add this header cross-site without CORS approval.
    if (($_SERVER['HTTP_X_CLEARGATE'] ?? '') !== '1') {
        fail(400, 'bad_request', 'Upload from the ClearGate website.');
    }
    $user = requireUser(['student']);

    $itemId = filter_var($_POST['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$itemId) {
        fail(400, 'invalid_item', 'Choose which office this file is for.');
    }
    $note = trim((string) ($_POST['note'] ?? ''));
    if (mb_strlen($note) > 255) {
        fail(400, 'invalid_field', 'Your note is too long (max 255 characters).');
    }

    $item = one(
        'SELECT ci.item_id, ci.status, o.office_id, o.code AS office_code, o.name AS office_name,
                CONCAT(s.first_name, \' \', s.last_name) AS student_name, s.student_number, ci.task
           FROM clearance_items ci
           JOIN clearances c ON c.clearance_id = ci.clearance_id
           JOIN students s   ON s.student_id = c.student_id
           JOIN offices o    ON o.office_id = ci.office_id
          WHERE ci.item_id = ? AND s.user_id = ?',
        [$itemId, $user['user_id']]
    );
    if (!$item) {
        fail(404, 'item_not_found', 'That clearance item was not found on your account.');
    }
    if ($item['status'] === 'approved') {
        fail(409, 'already_approved', $item['office_name'] . ' has already cleared you. No upload needed.');
    }

    $file = $_FILES['file'] ?? null;
    if (!$file || !is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        fail(400, 'no_file', 'Choose a file to upload.');
    }
    $maxBytes = (int) $config['max_upload_mb'] * 1024 * 1024;
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > $maxBytes) {
        fail(413, 'file_too_large', 'That file is too large. The limit is ' . $config['max_upload_mb'] . ' MB.');
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        fail(400, 'upload_failed', 'The upload did not finish. Please try again.');
    }
    $type = sniffType($file['tmp_name']);
    if (!$type) {
        fail(415, 'file_type', 'Upload a PDF, JPG, PNG or WEBP file.');
    }

    $original = preg_replace('/[^\w.\- ()]+/u', '_', basename((string) $file['name'])) ?: 'evidence.' . $type[1];
    $original = mb_substr($original, 0, 160);
    $stored = bin2hex(random_bytes(16)) . '.' . $type[1];
    $target = uploadDir() . DIRECTORY_SEPARATOR . $stored;
    if (!move_uploaded_file($file['tmp_name'], $target)) {
        fail(500, 'upload_failed', 'The server could not save the file.');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        run("UPDATE submissions SET status = 'replaced' WHERE item_id = ? AND status = 'submitted'", [$itemId]);
        run('INSERT INTO submissions (item_id, stored_name, original_name, mime_type, file_size, student_note, submitted_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$itemId, $stored, $original, $type[0], (int) $file['size'], $note === '' ? null : $note, $user['user_id']]);
        $id = (int) $pdo->lastInsertId();
        $reference = strtoupper(substr($item['office_code'], 0, 3)) . '-' . date('Y') . '-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT);
        run('UPDATE submissions SET reference = ? WHERE submission_id = ?', [$reference, $id]);

        if ($item['status'] !== 'pending') {
            run("SET @cg_note = 'Student uploaded evidence'");
            run("UPDATE clearance_items
                    SET status = 'pending', remarks = 'Evidence submitted',
                        next_step = ?, updated_by = ?
                  WHERE item_id = ?",
                ['Wait for ' . $item['office_name'] . ' to review your submission.', $user['user_id'], $itemId]);
            run('SET @cg_note = NULL');
        } else {
            run("UPDATE clearance_items SET remarks = 'Evidence submitted', next_step = ? WHERE item_id = ?",
                ['Wait for ' . $item['office_name'] . ' to review your submission.', $itemId]);
        }
        $again = (int) one("SELECT COUNT(*) AS n FROM submissions WHERE item_id = ? AND submission_id <> ?", [$itemId, $id])['n'] > 0;
        notifyOffice((int) $item['office_id'], false, $itemId, 'pending',
            $item['student_name'] . ($again ? ' resubmitted evidence' : ' uploaded evidence'),
            $reference . ' · ' . $original . ' for "' . $item['task'] . '"', 'review.html?id=' . $id);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        @unlink($target);
        throw $e;
    }

    ok(['submission_id' => $id, 'reference' => $reference, 'office_name' => $item['office_name']]);
}

/** Loads a submission with everything the review screens need, after a permission check. */
function loadSubmission(int $id, array $user): array
{
    $row = one(
        'SELECT sb.*, ci.status AS item_status, ci.task, ci.remarks, ci.description, ci.next_step, ci.updated_at AS item_updated_at,
                o.office_id, o.code AS office_code, o.name AS office_name, o.contact_email AS office_email,
                st.user_id AS student_user_id, st.student_number, st.first_name, st.last_name, st.year_level,
                p.code AS program, p.name AS program_name, su.email AS student_email,
                ay.label AS academic_year, c.term,
                COALESCE(rs.full_name, ru.full_name) AS reviewer_full_name, ru.role AS reviewer_role, ru.email AS reviewer_email
           FROM submissions sb
           JOIN clearance_items ci ON ci.item_id = sb.item_id
           JOIN offices o          ON o.office_id = ci.office_id
           JOIN clearances c       ON c.clearance_id = ci.clearance_id
           JOIN academic_years ay  ON ay.academic_year_id = c.academic_year_id
           JOIN students st        ON st.student_id = c.student_id
           JOIN users su           ON su.user_id = st.user_id
           JOIN programs p         ON p.program_id = st.program_id
           LEFT JOIN users ru         ON ru.user_id = sb.reviewed_by
           LEFT JOIN office_staff rs  ON rs.user_id = sb.reviewed_by
          WHERE sb.submission_id = ?',
        [$id]
    );
    if (!$row) {
        fail(404, 'not_found', 'That submission was not found.');
    }
    $allowed = $user['role'] === 'admin'
        || ($user['role'] === 'student' && (int) $row['student_user_id'] === (int) $user['user_id'])
        || ($user['role'] === 'staff' && staffOfficeId($user) === (int) $row['office_id']);
    if (!$allowed) {
        fail(403, 'forbidden', 'You cannot open this submission.');
    }
    return $row;
}

function submissionPayload(array $r): array
{
    $history = all(
        'SELECT sb.submission_id, sb.reference, sb.status, sb.original_name, sb.submitted_at, sb.reviewed_at,
                sb.return_category, sb.review_note, COALESCE(rs.full_name, ru.full_name) AS full_name, ru.role, ru.email
           FROM submissions sb
           LEFT JOIN users ru        ON ru.user_id = sb.reviewed_by
           LEFT JOIN office_staff rs ON rs.user_id = sb.reviewed_by
          WHERE sb.item_id = ? AND sb.submission_id <> ?
          ORDER BY sb.submitted_at DESC',
        [$r['item_id'], $r['submission_id']]
    );
    $returnedBefore = one(
        "SELECT COUNT(*) AS n FROM submissions WHERE item_id = ? AND status = 'returned' AND submitted_at < ?",
        [$r['item_id'], $r['submitted_at']]
    )['n'];

    return [
        'id'              => (int) $r['submission_id'],
        'reference'       => $r['reference'],
        'status'          => $r['status'],
        'resubmitted'     => $returnedBefore > 0,
        'file_name'       => $r['original_name'],
        'mime_type'       => $r['mime_type'],
        'file_size'       => (int) $r['file_size'],
        'note'            => $r['student_note'],
        'submitted_at'    => $r['submitted_at'],
        'reviewed_at'     => $r['reviewed_at'],
        'reviewer'        => reviewerName($r['reviewer_full_name'], $r['reviewer_role'], $r['reviewer_email']),
        'return_category' => $r['return_category'],
        'review_note'     => $r['review_note'],
        'checklist'       => $r['checklist'] ? json_decode($r['checklist'], true) : [],
        'student'         => [
            'name'         => $r['first_name'] . ' ' . $r['last_name'],
            'first_name'   => $r['first_name'],
            'number'       => $r['student_number'],
            'program'      => $r['program'],
            'program_name' => $r['program_name'],
            'year_level'   => (int) $r['year_level'],
            'email'        => $r['student_email'],
        ],
        'item'            => [
            'id'          => (int) $r['item_id'],
            'status'      => $r['item_status'],
            'task'        => $r['task'],
            'remarks'     => $r['remarks'],
            'description' => $r['description'],
            'next_step'   => $r['next_step'],
            'updated_at'  => $r['item_updated_at'],
        ],
        'office'          => ['code' => $r['office_code'], 'name' => $r['office_name'], 'email' => $r['office_email']],
        'academic_year'   => $r['academic_year'],
        'term'            => $r['term'],
        'history'         => array_map(fn ($h) => [
            'id'              => (int) $h['submission_id'],
            'reference'       => $h['reference'],
            'status'          => $h['status'],
            'file_name'       => $h['original_name'],
            'submitted_at'    => $h['submitted_at'],
            'reviewed_at'     => $h['reviewed_at'],
            'return_category' => $h['return_category'],
            'review_note'     => $h['review_note'],
            'reviewer'        => reviewerName($h['full_name'], $h['role'], $h['email']),
        ], $history),
    ];
}

function routeSubmissionFile(): never
{
    global $config;
    requireMethod('GET');
    $user = requireUser();
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) {
        fail(400, 'invalid_id', 'Missing submission id.');
    }
    $row = loadSubmission($id, $user);
    $path = uploadDir() . DIRECTORY_SEPARATOR . basename($row['stored_name']);
    if (!is_file($path)) {
        fail(404, 'file_missing', 'The file for this submission is missing from the server.');
    }
    $name = str_replace(['"', "\r", "\n"], '', $row['original_name']);
    header_remove('Content-Type');
    header('Content-Type: ' . $row['mime_type']);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: ' . (!empty($_GET['download']) ? 'attachment' : 'inline') . '; filename="' . $name . '"');
    header('X-Frame-Options: SAMEORIGIN');
    readfile($path);
    exit;
}

function routePendingList(): never
{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);
    $where = ["sb.status = 'submitted'", 'ay.is_current = 1'];
    $params = [];
    officeFilter($user, $where, $params);

    $rows = all(
        "SELECT sb.submission_id, sb.reference, sb.original_name, sb.mime_type, sb.submitted_at,
                st.first_name, st.last_name, st.student_number, st.year_level, p.code AS program,
                o.code AS office_code, o.name AS office_name, ci.task,
                (SELECT COUNT(*) FROM submissions prev
                  WHERE prev.item_id = sb.item_id AND prev.status = 'returned' AND prev.submitted_at < sb.submitted_at) AS returned_before
           FROM submissions sb
           JOIN clearance_items ci ON ci.item_id = sb.item_id
           JOIN offices o          ON o.office_id = ci.office_id
           JOIN clearances c       ON c.clearance_id = ci.clearance_id
           JOIN academic_years ay  ON ay.academic_year_id = c.academic_year_id
           JOIN students st        ON st.student_id = c.student_id
           JOIN programs p         ON p.program_id = st.program_id
          WHERE " . implode(' AND ', $where) . '
          ORDER BY sb.submitted_at DESC',
        $params
    );

    $sw = ['1 = 1']; $sp = [];
    officeFilter($user, $sw, $sp);
    $stats = one(
        "SELECT SUM(DATE(sb.submitted_at) = CURDATE()) AS submitted_today,
                SUM(sb.status = 'approved' AND DATE(sb.reviewed_at) = CURDATE()) AS approved_today,
                SUM(sb.status = 'returned' AND DATE(sb.reviewed_at) = CURDATE()) AS returned_today
           FROM submissions sb
           JOIN clearance_items ci ON ci.item_id = sb.item_id
           JOIN offices o          ON o.office_id = ci.office_id
          WHERE " . implode(' AND ', $sw),
        $sp
    );
    $term = one(
        "SELECT ay.label, COALESCE((SELECT c.term FROM clearances c WHERE c.academic_year_id = ay.academic_year_id
                 ORDER BY FIELD(c.term, 'Summer', '2nd Semester', '1st Semester') LIMIT 1), '1st Semester') AS term
           FROM academic_years ay WHERE ay.is_current = 1 LIMIT 1"
    );

    ok([
        'academic_year'   => $term['label'] ?? null,
        'term'            => $term['term'] ?? null,
        'submitted_today' => (int) ($stats['submitted_today'] ?? 0),
        'approved_today'  => (int) ($stats['approved_today'] ?? 0),
        'returned_today'  => (int) ($stats['returned_today'] ?? 0),
        'rows'            => array_map(fn ($r) => [
            'id'           => (int) $r['submission_id'],
            'reference'    => $r['reference'],
            'file_name'    => $r['original_name'],
            'mime_type'    => $r['mime_type'],
            'submitted_at' => $r['submitted_at'],
            'resubmitted'  => $r['returned_before'] > 0,
            'student_name' => $r['first_name'] . ' ' . $r['last_name'],
            'student_number' => $r['student_number'],
            'program'      => $r['program'],
            'year_level'   => (int) $r['year_level'],
            'office_code'  => $r['office_code'],
            'office_name'  => $r['office_name'],
            'task'         => $r['task'],
        ], $rows),
    ]);
}

function routeSubmission(): never
{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) {
        fail(400, 'invalid_id', 'Missing submission id.');
    }
    ok(submissionPayload(loadSubmission($id, $user)));
}

function routeReviewSubmission(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();

    $id = filter_var($in['submission_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $decision = $in['decision'] ?? '';
    if (!$id || !in_array($decision, ['approve', 'return'], true)) {
        fail(400, 'invalid_request', 'Send a submission_id and a decision of approve or return.');
    }
    $row = loadSubmission($id, $user);
    if ($row['status'] !== 'submitted') {
        fail(409, 'already_reviewed', 'This submission has already been ' . $row['status'] . '.');
    }

    $checklist = array_values(array_filter(array_map(
        fn ($c) => is_string($c) ? mb_substr(trim($c), 0, 120) : '',
        is_array($in['checklist'] ?? null) ? $in['checklist'] : []
    )));
    $category = null;
    $reason = null;
    if ($decision === 'return') {
        $category = str($in, 'return_category', 80);
        $reason = str($in, 'reason', 500);
        if ($category === '' || mb_strlen($reason) < 10) {
            fail(400, 'reason_required', 'Choose a reason category and explain what the student needs to fix (at least 10 characters).');
        }
    }

    $previous = $row['item_status'];
    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($decision === 'approve') {
            run('CALL sp_update_clearance_item(?, ?, ?, ?, ?, ?, ?, ?)', [
                $row['item_id'], 'approved', null, 'Evidence verified',
                $row['office_name'] . ' has cleared your account.', null,
                'Approved submission ' . $row['reference'], $user['user_id'],
            ]);
        } else {
            run('CALL sp_update_clearance_item(?, ?, ?, ?, ?, ?, ?, ?)', [
                $row['item_id'], 'needs_action', null, mb_substr('Returned: ' . $category, 0, 120),
                mb_substr($reason, 0, 255), 'Fix the issue, then upload a corrected file from your clearance page.',
                mb_substr('Returned submission ' . $row['reference'] . ': ' . $category, 0, 255), $user['user_id'],
            ]);
        }
        run('UPDATE submissions
                SET status = ?, reviewed_by = ?, reviewed_at = NOW(), return_category = ?, review_note = ?, checklist = ?
              WHERE submission_id = ?',
            [$decision === 'approve' ? 'approved' : 'returned', $user['user_id'], $category, $reason,
             json_encode($checklist, JSON_UNESCAPED_UNICODE), $id]);
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if (($e->errorInfo[0] ?? '') === '45000') {
            fail(403, 'update_rejected', $e->errorInfo[2] ?? 'Update rejected.');
        }
        throw $e;
    }

    $payload = submissionPayload(loadSubmission($id, $user));
    $payload['previous_item_status'] = $previous;
    $payload['notification'] = one(
        'SELECT title, body, created_at FROM notifications WHERE item_id = ? ORDER BY notification_id DESC LIMIT 1',
        [$row['item_id']]
    );
    ok($payload);
}

function routeReviewHistory(): never
{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);
    $where = ["sb.status IN ('approved', 'returned')"];
    $params = [];
    officeFilter($user, $where, $params);
    if (!empty($_GET['decision']) && in_array($_GET['decision'], ['approved', 'returned'], true)) {
        $where[] = 'sb.status = ?';
        $params[] = $_GET['decision'];
    }
    $rows = all(
        'SELECT sb.submission_id, sb.reference, sb.status, sb.original_name, sb.submitted_at, sb.reviewed_at,
                sb.return_category, sb.review_note,
                st.first_name, st.last_name, st.student_number, p.code AS program, st.year_level,
                o.code AS office_code, o.name AS office_name,
                COALESCE(rs.full_name, ru.full_name) AS full_name, ru.role, ru.email
           FROM submissions sb
           JOIN clearance_items ci ON ci.item_id = sb.item_id
           JOIN offices o          ON o.office_id = ci.office_id
           JOIN clearances c       ON c.clearance_id = ci.clearance_id
           JOIN students st        ON st.student_id = c.student_id
           JOIN programs p         ON p.program_id = st.program_id
           LEFT JOIN users ru        ON ru.user_id = sb.reviewed_by
           LEFT JOIN office_staff rs ON rs.user_id = sb.reviewed_by
          WHERE ' . implode(' AND ', $where) . '
          ORDER BY sb.reviewed_at DESC
          LIMIT 300',
        $params
    );
    ok(array_map(fn ($r) => [
        'id'              => (int) $r['submission_id'],
        'reference'       => $r['reference'],
        'status'          => $r['status'],
        'file_name'       => $r['original_name'],
        'submitted_at'    => $r['submitted_at'],
        'reviewed_at'     => $r['reviewed_at'],
        'return_category' => $r['return_category'],
        'review_note'     => $r['review_note'],
        'student_name'    => $r['first_name'] . ' ' . $r['last_name'],
        'student_number'  => $r['student_number'],
        'program'         => $r['program'],
        'year_level'      => (int) $r['year_level'],
        'office_code'     => $r['office_code'],
        'office_name'     => $r['office_name'],
        'reviewer'        => reviewerName($r['full_name'], $r['role'], $r['email']),
    ], $rows));
}

/* ------------------------------------------------------ Office messages */

/** One clearance item with its student and office, after a permission check. */
function loadItemForMessages(int $itemId, array $user): array
{
    $row = one(
        'SELECT ci.item_id, ci.status, ci.task, o.office_id, o.code AS office_code, o.name AS office_name,
                s.user_id AS student_user_id, s.first_name, s.last_name, s.student_number
           FROM clearance_items ci
           JOIN offices o    ON o.office_id = ci.office_id
           JOIN clearances c ON c.clearance_id = ci.clearance_id
           JOIN students s   ON s.student_id = c.student_id
          WHERE ci.item_id = ?',
        [$itemId]
    );
    if (!$row) {
        fail(404, 'not_found', 'That clearance item was not found.');
    }
    $allowed = $user['role'] === 'admin'
        || ($user['role'] === 'student' && (int) $row['student_user_id'] === (int) $user['user_id'])
        || ($user['role'] === 'staff' && staffOfficeId($user) === (int) $row['office_id']);
    if (!$allowed) {
        fail(403, 'forbidden', 'You cannot see messages for this requirement.');
    }
    return $row;
}

function messagesPayload(array $item, array $user): array
{
    // Opening the conversation marks the other side's messages as read.
    if ($user['role'] === 'student') {
        run("UPDATE office_messages SET read_at = NOW() WHERE item_id = ? AND sender_role <> 'student' AND read_at IS NULL", [$item['item_id']]);
    } else {
        run("UPDATE office_messages SET read_at = NOW() WHERE item_id = ? AND sender_role = 'student' AND read_at IS NULL", [$item['item_id']]);
    }
    $rows = all(
        "SELECT m.message_id, m.sender_role, m.body, m.created_at, m.read_at, m.sender_id,
                COALESCE(st.full_name, CONCAT(s.first_name, ' ', s.last_name), u.full_name,
                         IF(m.sender_role = 'admin', 'System Administrator', u.email)) AS sender_name
           FROM office_messages m
           LEFT JOIN users u         ON u.user_id = m.sender_id
           LEFT JOIN office_staff st ON st.user_id = m.sender_id
           LEFT JOIN students s      ON s.user_id = m.sender_id
          WHERE m.item_id = ?
          ORDER BY m.created_at, m.message_id",
        [$item['item_id']]
    );
    return [
        'item' => [
            'item_id'        => (int) $item['item_id'],
            'status'         => $item['status'],
            'task'           => $item['task'],
            'office_code'    => $item['office_code'],
            'office_name'    => $item['office_name'],
            'student_name'   => $item['first_name'] . ' ' . $item['last_name'],
            'student_number' => $item['student_number'],
        ],
        'messages' => array_map(fn ($m) => [
            'id'          => (int) $m['message_id'],
            'from'        => $m['sender_role'] === 'student' ? 'student' : 'office',
            'sender_name' => $m['sender_name'] ?? 'Deleted account',
            'mine'        => (int) $m['sender_id'] === (int) $user['user_id'],
            'body'        => $m['body'],
            'created_at'  => $m['created_at'],
            'read_at'     => $m['read_at'],
        ], $rows),
    ];
}

function routeMessages(): never
{
    requireMethod('GET');
    $user = requireUser();
    $itemId = filter_var($_GET['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$itemId) {
        fail(400, 'invalid_item', 'Missing item_id.');
    }
    ok(messagesPayload(loadItemForMessages($itemId, $user), $user));
}

function routeSendMessage(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser();
    $in = body();
    $itemId = filter_var($in['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$itemId) {
        fail(400, 'invalid_item', 'Missing item_id.');
    }
    $text = str($in, 'body', 1000);
    if ($text === '') {
        fail(400, 'empty_message', 'Write a message first.');
    }
    $item = loadItemForMessages($itemId, $user);

    // Slow down floods: at most 20 messages a minute per account.
    $recent = one('SELECT COUNT(*) AS n FROM office_messages WHERE sender_id = ? AND created_at > NOW() - INTERVAL 1 MINUTE', [$user['user_id']])['n'];
    if ($recent >= 20) {
        fail(429, 'too_many_messages', 'You are sending messages too quickly. Wait a minute and try again.');
    }

    run('INSERT INTO office_messages (item_id, sender_id, sender_role, body) VALUES (?, ?, ?, ?)',
        [$itemId, $user['user_id'], $user['role'], $text]);

    if ($user['role'] !== 'student') {
        // Tell the student under the bell.
        $excerpt = mb_strlen($text) > 120 ? mb_substr($text, 0, 117) . '...' : $text;
        run("INSERT INTO notifications (user_id, item_id, tone, title, body) VALUES (?, ?, 'info', ?, ?)",
            [$item['student_user_id'], $itemId, $item['office_name'] . ' sent you a message', $excerpt]);
    } else {
        // Tell the office. Several messages in a row become one unread notification.
        $excerpt = mb_strlen($text) > 120 ? mb_substr($text, 0, 117) . '...' : $text;
        $title = $item['first_name'] . ' ' . $item['last_name'] . ' sent a message';
        $link = 'messages.html?item=' . $itemId;
        run('DELETE FROM notifications WHERE link = ? AND is_read = 0', [$link]);
        notifyOffice((int) $item['office_id'], false, $itemId, 'info', $title, $excerpt, $link);
    }
    ok(messagesPayload($item, $user));
}

function routeMessageThreads(): never
{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);
    $where = ['1 = 1'];
    $params = [];
    officeFilter($user, $where, $params);
    $rows = all(
        "SELECT ci.item_id, ci.status, ci.task, o.code AS office_code, o.name AS office_name,
                s.first_name, s.last_name, s.student_number, p.code AS program, s.year_level,
                COUNT(m.message_id) AS total,
                SUM(m.sender_role = 'student' AND m.read_at IS NULL) AS unread,
                MAX(m.created_at) AS last_at,
                SUBSTRING_INDEX(GROUP_CONCAT(m.body ORDER BY m.created_at DESC, m.message_id DESC SEPARATOR '\x1e'), '\x1e', 1) AS last_body,
                SUBSTRING_INDEX(GROUP_CONCAT(m.sender_role ORDER BY m.created_at DESC, m.message_id DESC), ',', 1) AS last_role
           FROM office_messages m
           JOIN clearance_items ci ON ci.item_id = m.item_id
           JOIN offices o          ON o.office_id = ci.office_id
           JOIN clearances c       ON c.clearance_id = ci.clearance_id
           JOIN students s         ON s.student_id = c.student_id
           JOIN programs p         ON p.program_id = s.program_id
          WHERE " . implode(' AND ', $where) . '
          GROUP BY ci.item_id, ci.status, ci.task, o.code, o.name, s.first_name, s.last_name, s.student_number, p.code, s.year_level
          ORDER BY SUM(m.sender_role = \'student\' AND m.read_at IS NULL) > 0 DESC, MAX(m.created_at) DESC
          LIMIT 300',
        $params
    );
    ok(array_map(fn ($r) => [
        'item_id'        => (int) $r['item_id'],
        'status'         => $r['status'],
        'task'           => $r['task'],
        'office_code'    => $r['office_code'],
        'office_name'    => $r['office_name'],
        'student_name'   => $r['first_name'] . ' ' . $r['last_name'],
        'student_number' => $r['student_number'],
        'program'        => $r['program'],
        'year_level'     => (int) $r['year_level'],
        'total'          => (int) $r['total'],
        'unread'         => (int) $r['unread'],
        'last_at'        => $r['last_at'],
        'last_body'      => $r['last_body'],
        'last_from'      => $r['last_role'] === 'student' ? 'student' : 'office',
    ], $rows));
}

/* ------------------------------------------------- Admin and Registrar */

function requireAdmin(): array
{
    return requireUser(['admin']);
}

function logAdmin(array $user, string $action, string $details): void
{
    run('INSERT INTO admin_actions (user_id, action, details) VALUES (?, ?, ?)',
        [$user['user_id'], $action, mb_substr($details, 0, 500)]);
}

/** The academic year marked current and its newest opened term. */
function currentTerm(): ?array
{
    $ay = one('SELECT academic_year_id, label FROM academic_years WHERE is_current = 1 LIMIT 1');
    if (!$ay) return null;
    $t = one("SELECT term FROM clearances WHERE academic_year_id = ?
               ORDER BY FIELD(term, 'Summer', '2nd Semester', '1st Semester') LIMIT 1", [$ay['academic_year_id']]);
    return ['academic_year_id' => (int) $ay['academic_year_id'], 'label' => $ay['label'], 'term' => $t['term'] ?? '1st Semester'];
}

/* ---- Reports */

function routeReports(): never
{
    requireMethod('GET');
    requireRegistrar();
    $ct = currentTerm();
    if (!$ct) ok(['term' => null]);
    $p = [$ct['academic_year_id'], $ct['term']];

    $summary = one(
        "SELECT COUNT(*) AS clearances, SUM(v.is_eligible) AS cleared, ROUND(AVG(v.percent_complete)) AS avg_percent
           FROM v_clearance_summary v JOIN clearances c ON c.clearance_id = v.clearance_id
          WHERE c.academic_year_id = ? AND c.term = ?", $p);
    $students = one('SELECT COUNT(*) AS n FROM students s JOIN users u ON u.user_id = s.user_id WHERE u.is_active = 1')['n'];

    $byProgram = all(
        "SELECT pr.code, pr.name, COUNT(v.clearance_id) AS clearances, COALESCE(SUM(v.is_eligible), 0) AS cleared,
                ROUND(AVG(v.percent_complete)) AS avg_percent
           FROM programs pr
           LEFT JOIN students s ON s.program_id = pr.program_id
           LEFT JOIN clearances c ON c.student_id = s.student_id AND c.academic_year_id = ? AND c.term = ?
           LEFT JOIN v_clearance_summary v ON v.clearance_id = c.clearance_id
          GROUP BY pr.program_id, pr.code, pr.name ORDER BY pr.code", $p);
    $byYear = all(
        "SELECT s.year_level, COUNT(*) AS clearances, SUM(v.is_eligible) AS cleared, ROUND(AVG(v.percent_complete)) AS avg_percent
           FROM v_clearance_summary v JOIN clearances c ON c.clearance_id = v.clearance_id JOIN students s ON s.student_id = c.student_id
          WHERE c.academic_year_id = ? AND c.term = ? GROUP BY s.year_level ORDER BY s.year_level", $p);
    $byOffice = all(
        "SELECT o.code, o.name,
                SUM(ci.status = 'approved') AS approved, SUM(ci.status = 'pending') AS pending, SUM(ci.status = 'needs_action') AS needs_action,
                (SELECT COUNT(*) FROM submissions sb JOIN clearance_items x ON x.item_id = sb.item_id
                  WHERE x.office_id = o.office_id AND sb.status = 'submitted') AS waiting_evidence,
                (SELECT ROUND(AVG(TIMESTAMPDIFF(MINUTE, sb.submitted_at, sb.reviewed_at)) / 60, 1) FROM submissions sb JOIN clearance_items x ON x.item_id = sb.item_id
                  WHERE x.office_id = o.office_id AND sb.reviewed_at IS NOT NULL) AS avg_review_hours,
                (SELECT MIN(sb.submitted_at) FROM submissions sb JOIN clearance_items x ON x.item_id = sb.item_id
                  WHERE x.office_id = o.office_id AND sb.status = 'submitted') AS oldest_waiting
           FROM offices o
           LEFT JOIN clearance_items ci ON ci.office_id = o.office_id
                 AND ci.clearance_id IN (SELECT clearance_id FROM clearances WHERE academic_year_id = ? AND term = ?)
          WHERE o.is_active = 1
          GROUP BY o.office_id, o.code, o.name ORDER BY o.sort_order", $p);
    $apps = one("SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected FROM applications");

    $ints = fn ($rows, $keys) => array_map(function ($r) use ($keys) { foreach ($keys as $k) { $r[$k] = $r[$k] === null ? null : (float) $r[$k]; } return $r; }, $rows);
    ok([
        'term'       => $ct,
        'students'   => (int) $students,
        'clearances' => (int) ($summary['clearances'] ?? 0),
        'cleared'    => (int) ($summary['cleared'] ?? 0),
        'avg_percent' => (int) ($summary['avg_percent'] ?? 0),
        'by_program' => $ints($byProgram, ['clearances', 'cleared', 'avg_percent']),
        'by_year'    => $ints($byYear, ['year_level', 'clearances', 'cleared', 'avg_percent']),
        'by_office'  => $ints($byOffice, ['approved', 'pending', 'needs_action', 'waiting_evidence', 'avg_review_hours']),
        'applications' => array_map('intval', $apps ?? []),
    ]);
}

function csvOut(string $filename, array $header, array $rows): never
{
    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // so Excel reads ñ and ₱ correctly
    fputcsv($out, $header);
    foreach ($rows as $r) {
        fputcsv($out, array_map(fn ($v) => is_string($v) && preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v, $r));
    }
    fclose($out);
    exit;
}

function routeReportExport(): never
{
    requireMethod('GET');
    requireRegistrar();
    $ct = currentTerm();
    if (!$ct) fail(404, 'no_term', 'No current academic year is set.');
    $offices = all('SELECT office_id, name FROM offices WHERE is_active = 1 ORDER BY sort_order');
    $rows = all(
        "SELECT v.clearance_id, v.student_number, v.student_name, v.program, v.year_level, v.approved_count, v.total_offices,
                v.percent_complete, v.is_eligible, u.email
           FROM v_clearance_summary v JOIN clearances c ON c.clearance_id = v.clearance_id
           JOIN users u ON u.user_id = v.user_id
          WHERE c.academic_year_id = ? AND c.term = ? ORDER BY v.program, v.student_name",
        [$ct['academic_year_id'], $ct['term']]);
    $status = [];
    foreach (all("SELECT ci.clearance_id, ci.office_id, ci.status FROM clearance_items ci JOIN clearances c ON c.clearance_id = ci.clearance_id
                   WHERE c.academic_year_id = ? AND c.term = ?", [$ct['academic_year_id'], $ct['term']]) as $s) {
        $status[$s['clearance_id']][$s['office_id']] = ['needs_action' => 'Needs action', 'pending' => 'Pending', 'approved' => 'Approved'][$s['status']];
    }
    $header = array_merge(['Student ID', 'Name', 'School email', 'Program', 'Year'], array_column($offices, 'name'), ['Offices cleared', 'Percent', 'Eligible to enroll']);
    $out = [];
    foreach ($rows as $r) {
        $line = [$r['student_number'], $r['student_name'], $r['email'], $r['program'], $r['year_level']];
        foreach ($offices as $o) { $line[] = $status[$r['clearance_id']][$o['office_id']] ?? ''; }
        $out[] = array_merge($line, [$r['approved_count'] . ' of ' . $r['total_offices'], $r['percent_complete'] . '%', $r['is_eligible'] ? 'Yes' : 'No']);
    }
    $name = 'cleargate-clearances-' . preg_replace('/\W+/', '', $ct['label']) . '-' . preg_replace('/\W+/', '', $ct['term']) . '.csv';
    csvOut($name, $header, $out);
}

/* ---- Settings: offices, programs, academic years and terms */

const OFFICE_ICONS = ['book', 'wallet', 'file', 'heart', 'cap', 'box'];

function routeSettings(): never
{
    requireMethod('GET');
    requireAdmin();
    ok([
        'offices'  => all('SELECT o.office_id, o.code, o.name, o.icon, o.contact_email, o.office_hours, o.sort_order, o.is_active,
                                  (SELECT COUNT(*) FROM office_staff st WHERE st.office_id = o.office_id) AS staff_count
                             FROM offices o ORDER BY o.sort_order, o.name'),
        'programs' => all('SELECT p.program_id, p.code, p.name,
                                  (SELECT COUNT(*) FROM students s WHERE s.program_id = p.program_id) AS student_count,
                                  (SELECT COUNT(*) FROM applications a WHERE a.program_id = p.program_id) AS application_count
                             FROM programs p ORDER BY p.code'),
        'years'    => all("SELECT ay.academic_year_id, ay.label, ay.start_date, ay.end_date, ay.is_current,
                                  (SELECT GROUP_CONCAT(DISTINCT c.term ORDER BY FIELD(c.term, '1st Semester', '2nd Semester', 'Summer') SEPARATOR ', ')
                                     FROM clearances c WHERE c.academic_year_id = ay.academic_year_id) AS terms_opened
                             FROM academic_years ay ORDER BY ay.start_date DESC"),
        'current'  => currentTerm(),
        'active_students' => (int) one('SELECT COUNT(*) AS n FROM students s JOIN users u ON u.user_id = s.user_id WHERE u.is_active = 1')['n'],
    ]);
}

function routeSaveOffice(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['office_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $name = str($in, 'name', 80);
    $email = mb_strtolower(str($in, 'contact_email', 190));
    $hours = str($in, 'office_hours', 80);
    $icon = str($in, 'icon', 20);
    $sort = filter_var($in['sort_order'] ?? 0, FILTER_VALIDATE_INT) ?: 0;
    $active = !empty($in['is_active']) ? 1 : 0;
    if ($name === '' || $hours === '') fail(400, 'missing_fields', 'Fill in the office name and hours.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_email', 'Enter a valid contact email.');
    if (!in_array($icon, OFFICE_ICONS, true)) fail(400, 'invalid_icon', 'Choose an icon from the list.');

    if ($id) {
        $old = one('SELECT * FROM offices WHERE office_id = ?', [$id]);
        if (!$old) fail(404, 'not_found', 'Office not found.');
        run('UPDATE offices SET name = ?, contact_email = ?, office_hours = ?, icon = ?, sort_order = ?, is_active = ? WHERE office_id = ?',
            [$name, $email, $hours, $icon, $sort, $active, $id]);
        logAdmin($user, 'office.update', "Updated office {$old['name']}" . ($old['name'] !== $name ? " (renamed to $name)" : '') .
            ($old['is_active'] != $active ? ($active ? ', turned it on' : ', turned it off') : ''));
        ok(['office_id' => $id]);
    }
    $code = strtolower(str($in, 'code', 20));
    if (!preg_match('/^[a-z][a-z0-9-]{1,19}$/', $code)) fail(400, 'invalid_code', 'Code must be lowercase letters, numbers or dashes, e.g. clinic.');
    if (one('SELECT 1 AS x FROM offices WHERE code = ?', [$code])) fail(409, 'code_taken', 'Another office already uses that code.');
    run('INSERT INTO offices (code, name, icon, contact_email, office_hours, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$code, $name, $icon, $email, $hours, $sort, $active]);
    $newId = (int) db()->lastInsertId();
    $added = 0;
    if ($active && !empty($in['add_to_open'])) {
        $ct = currentTerm();
        if ($ct) {
            $added = run("INSERT INTO clearance_items (clearance_id, office_id, status, task, remarks, description, next_step)
                          SELECT c.clearance_id, ?, 'pending', 'Awaiting office review', 'Awaiting review', ?, ?
                            FROM clearances c WHERE c.academic_year_id = ? AND c.term = ?",
                [$newId, "$name has not reviewed your account yet.", "Wait for $name to review your account, or visit the office.",
                 $ct['academic_year_id'], $ct['term']]);
        }
    }
    logAdmin($user, 'office.create', "Added office $name ($code)" . ($added ? ", added to $added open clearances" : ''));
    ok(['office_id' => $newId, 'added_to' => $added]);
}

function routeSaveProgram(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['program_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $code = strtoupper(str($in, 'code', 10));
    $name = str($in, 'name', 120);
    if (!preg_match('/^[A-Z][A-Z0-9-]{1,9}$/', $code)) fail(400, 'invalid_code', 'Code must be 2 to 10 letters or numbers, e.g. BSCE.');
    if ($name === '') fail(400, 'missing_fields', 'Enter the program name.');
    $dup = one('SELECT program_id FROM programs WHERE code = ?', [$code]);
    if ($dup && (int) $dup['program_id'] !== (int) $id) fail(409, 'code_taken', 'Another program already uses that code.');
    if ($id) {
        $old = one('SELECT code, name FROM programs WHERE program_id = ?', [$id]);
        if (!$old) fail(404, 'not_found', 'Program not found.');
        run('UPDATE programs SET code = ?, name = ? WHERE program_id = ?', [$code, $name, $id]);
        logAdmin($user, 'program.update', "Updated program {$old['code']} to $code, $name");
    } else {
        run('INSERT INTO programs (code, name) VALUES (?, ?)', [$code, $name]);
        $id = (int) db()->lastInsertId();
        logAdmin($user, 'program.create', "Added program $code, $name");
    }
    ok(['program_id' => $id]);
}

function routeDeleteProgram(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['program_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $p = $id ? one('SELECT code, name FROM programs WHERE program_id = ?', [$id]) : null;
    if (!$p) fail(404, 'not_found', 'Program not found.');
    $used = one('SELECT (SELECT COUNT(*) FROM students WHERE program_id = ?) + (SELECT COUNT(*) FROM applications WHERE program_id = ?) AS n', [$id, $id])['n'];
    if ($used > 0) fail(409, 'in_use', "{$p['code']} still has students or applications, so it can't be deleted. Rename it instead.");
    run('DELETE FROM programs WHERE program_id = ?', [$id]);
    logAdmin($user, 'program.delete', "Deleted program {$p['code']}, {$p['name']}");
    ok();
}

function routeSaveYear(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $start = str($in, 'start_date', 10);
    $end = str($in, 'end_date', 10);
    $sd = DateTime::createFromFormat('!Y-m-d', $start);
    $ed = DateTime::createFromFormat('!Y-m-d', $end);
    if (!$sd || !$ed || $ed <= $sd) fail(400, 'invalid_dates', 'Enter a start date and a later end date.');
    $label = $sd->format('Y') . ' - ' . $ed->format('Y');
    if (one('SELECT 1 AS x FROM academic_years WHERE label = ?', [$label])) fail(409, 'exists', "Academic year $label already exists.");
    run('INSERT INTO academic_years (label, start_date, end_date, is_current) VALUES (?, ?, ?, 0)', [$label, $start, $end]);
    logAdmin($user, 'year.create', "Added academic year $label ($start to $end)");
    ok(['label' => $label]);
}

function routeSetCurrentYear(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['academic_year_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $ay = $id ? one('SELECT label FROM academic_years WHERE academic_year_id = ?', [$id]) : null;
    if (!$ay) fail(404, 'not_found', 'Academic year not found.');
    db()->beginTransaction();
    run('UPDATE academic_years SET is_current = 0');
    run('UPDATE academic_years SET is_current = 1 WHERE academic_year_id = ?', [$id]);
    db()->commit();
    logAdmin($user, 'year.current', "Set {$ay['label']} as the current academic year");
    ok();
}

function routeOpenTerm(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['academic_year_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $term = $in['term'] ?? '';
    if (!in_array($term, ['1st Semester', '2nd Semester', 'Summer'], true)) fail(400, 'invalid_term', 'Choose 1st Semester, 2nd Semester or Summer.');
    $ay = $id ? one('SELECT label FROM academic_years WHERE academic_year_id = ?', [$id]) : null;
    if (!$ay) fail(404, 'not_found', 'Academic year not found.');
    $students = all('SELECT s.student_id FROM students s JOIN users u ON u.user_id = s.user_id WHERE u.is_active = 1');
    $before = (int) one('SELECT COUNT(*) AS n FROM clearances WHERE academic_year_id = ? AND term = ?', [$id, $term])['n'];
    $pdo = db();
    foreach ($students as $st) {
        $stmt = $pdo->prepare('CALL sp_open_clearance(?, ?, ?)');
        $stmt->execute([$st['student_id'], $id, $term]);
        do { $stmt->fetchAll(); } while ($stmt->nextRowset());
        $stmt->closeCursor();
    }
    $opened = (int) one('SELECT COUNT(*) AS n FROM clearances WHERE academic_year_id = ? AND term = ?', [$id, $term])['n'] - $before;
    logAdmin($user, 'term.open', "Opened $term, A.Y {$ay['label']}: $opened new clearances");
    ok(['opened' => $opened, 'already' => $before]);
}

/* ---- Staff accounts */

function routeStaffAccounts(): never
{
    requireMethod('GET');
    requireAdmin();
    ok(all("SELECT u.user_id, u.email, u.role, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
                   COALESCE(st.full_name, u.full_name) AS full_name, st.position, o.code AS office_code, o.name AS office_name
              FROM users u
              LEFT JOIN office_staff st ON st.user_id = u.user_id
              LEFT JOIN offices o ON o.office_id = st.office_id
             WHERE u.role IN ('staff', 'admin')
             ORDER BY u.role = 'admin' DESC, o.sort_order, full_name"));
}

function routeSaveStaff(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $name = str($in, 'full_name', 120);
    $email = mb_strtolower(str($in, 'email', 190));
    $role = $in['role'] ?? '';
    $position = optionalStr($in, 'position', 80);
    if ($name === '') fail(400, 'missing_fields', 'Enter the full name.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_email', 'Enter a valid email.');
    if (!in_array($role, ['staff', 'admin'], true)) fail(400, 'invalid_role', 'Role must be staff or admin.');
    $office = null;
    if ($role === 'staff') {
        $office = one('SELECT office_id, name FROM offices WHERE code = ?', [str($in, 'office', 20)]);
        if (!$office) fail(400, 'invalid_office', 'Choose the office this staff member signs for.');
    }
    $dup = one('SELECT user_id FROM users WHERE email = ? OR personal_email = ?', [$email, $email]);
    if ($dup && (int) $dup['user_id'] !== (int) $id) fail(409, 'email_taken', 'Another account already uses that email.');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $temp = null;
        if ($id) {
            $old = one("SELECT u.role, u.email FROM users u WHERE u.user_id = ? AND u.role IN ('staff', 'admin')", [$id]);
            if (!$old) fail(404, 'not_found', 'Staff account not found.');
            if ((int) $id === (int) $user['user_id'] && $role !== 'admin') fail(400, 'self', "You can't remove your own admin role.");
            run('UPDATE users SET email = ?, role = ?, full_name = ? WHERE user_id = ?', [$email, $role, $role === 'admin' ? $name : null, $id]);
            $action = 'staff.update';
            $details = "Updated $name ($email)";
        } else {
            $temp = tempPassword();
            run('INSERT INTO users (email, password_hash, role, full_name, must_change_password) VALUES (?, ?, ?, ?, 1)',
                [$email, password_hash($temp, PASSWORD_DEFAULT), $role, $role === 'admin' ? $name : null]);
            $id = (int) $pdo->lastInsertId();
            $action = 'staff.create';
            $details = "Created " . ($role === 'admin' ? 'admin' : $office['name'] . ' staff') . " account for $name ($email)";
        }
        if ($role === 'staff') {
            run('INSERT INTO office_staff (user_id, office_id, full_name, position) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE office_id = VALUES(office_id), full_name = VALUES(full_name), position = VALUES(position)',
                [$id, $office['office_id'], $name, $position]);
        } else {
            run('DELETE FROM office_staff WHERE user_id = ?', [$id]);
        }
        logAdmin($user, $action, $details);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    ok(['user_id' => $id, 'temp_password' => $temp]);
}

function routeStaffStatus(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $acc = $id ? one("SELECT u.email, COALESCE(st.full_name, u.full_name, u.email) AS name FROM users u LEFT JOIN office_staff st ON st.user_id = u.user_id
                      WHERE u.user_id = ? AND u.role IN ('staff', 'admin')", [$id]) : null;
    if (!$acc) fail(404, 'not_found', 'Staff account not found.');
    if ((int) $id === (int) $user['user_id']) fail(400, 'self', "You can't turn off your own account.");
    $active = !empty($in['active']) ? 1 : 0;
    run('UPDATE users SET is_active = ? WHERE user_id = ?', [$active, $id]);
    logAdmin($user, $active ? 'staff.enable' : 'staff.disable', ($active ? 'Turned on' : 'Turned off') . " the account of {$acc['name']} ({$acc['email']})");
    ok();
}

function routeStaffResetPassword(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $in = body();
    $id = filter_var($in['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $acc = $id ? one("SELECT u.email, COALESCE(st.full_name, u.full_name, u.email) AS name FROM users u LEFT JOIN office_staff st ON st.user_id = u.user_id
                      WHERE u.user_id = ? AND u.role IN ('staff', 'admin')", [$id]) : null;
    if (!$acc) fail(404, 'not_found', 'Staff account not found.');
    $temp = tempPassword();
    run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE user_id = ?', [password_hash($temp, PASSWORD_DEFAULT), $id]);
    logAdmin($user, 'staff.reset_password', "Issued a temporary password to {$acc['name']} ({$acc['email']})");
    ok(['temp_password' => $temp]);
}

/* ---- Audit log */

function auditRows(): array
{
    $from = $_GET['from'] ?? '';
    $to = $_GET['to'] ?? '';
    $fromOk = DateTime::createFromFormat('!Y-m-d', $from) ? $from : date('Y-m-d', strtotime('-90 days'));
    $toOk = DateTime::createFromFormat('!Y-m-d', $to) ? $to : date('Y-m-d');
    $p = [$fromOk . ' 00:00:00', $toOk . ' 23:59:59'];
    $who = "COALESCE(st.full_name, CONCAT(s.first_name, ' ', s.last_name), u.full_name, IF(u.role = 'admin', 'System Administrator', u.email), 'System')";
    $sql = "
      SELECT l.changed_at AS at, 'Status change' AS kind, $who AS actor, o.name AS office,
             CONCAT(cs.first_name, ' ', cs.last_name, ' (', cs.student_number, ')') AS subject,
             CONCAT(COALESCE(l.old_status, 'new'), ' → ', l.new_status, IF(l.note IS NULL, '', CONCAT(': ', l.note))) AS details
        FROM clearance_item_logs l
        JOIN clearance_items ci ON ci.item_id = l.item_id JOIN offices o ON o.office_id = ci.office_id
        JOIN clearances c ON c.clearance_id = ci.clearance_id JOIN students cs ON cs.student_id = c.student_id
        LEFT JOIN users u ON u.user_id = l.changed_by LEFT JOIN office_staff st ON st.user_id = u.user_id LEFT JOIN students s ON s.user_id = u.user_id
       WHERE l.changed_at BETWEEN ? AND ?
      UNION ALL
      SELECT sb.submitted_at, 'Evidence uploaded', CONCAT(cs.first_name, ' ', cs.last_name), o.name,
             CONCAT(cs.first_name, ' ', cs.last_name, ' (', cs.student_number, ')'), CONCAT(sb.reference, ': ', sb.original_name)
        FROM submissions sb JOIN clearance_items ci ON ci.item_id = sb.item_id JOIN offices o ON o.office_id = ci.office_id
        JOIN clearances c ON c.clearance_id = ci.clearance_id JOIN students cs ON cs.student_id = c.student_id
       WHERE sb.submitted_at BETWEEN ? AND ?
      UNION ALL
      SELECT sb.reviewed_at, IF(sb.status = 'approved', 'Evidence approved', 'Evidence returned'), $who, o.name,
             CONCAT(cs.first_name, ' ', cs.last_name, ' (', cs.student_number, ')'),
             CONCAT(sb.reference, IF(sb.return_category IS NULL, '', CONCAT(': ', sb.return_category)))
        FROM submissions sb JOIN clearance_items ci ON ci.item_id = sb.item_id JOIN offices o ON o.office_id = ci.office_id
        JOIN clearances c ON c.clearance_id = ci.clearance_id JOIN students cs ON cs.student_id = c.student_id
        LEFT JOIN users u ON u.user_id = sb.reviewed_by LEFT JOIN office_staff st ON st.user_id = u.user_id LEFT JOIN students s ON s.user_id = u.user_id
       WHERE sb.reviewed_at IS NOT NULL AND sb.status IN ('approved', 'returned') AND sb.reviewed_at BETWEEN ? AND ?
      UNION ALL
      SELECT a.submitted_at, 'Application submitted', CONCAT(a.first_name, ' ', a.last_name), 'Registrar',
             CONCAT(a.first_name, ' ', a.last_name), CONCAT(a.reference, ' · ', a.personal_email)
        FROM applications a WHERE a.submitted_at BETWEEN ? AND ?
      UNION ALL
      SELECT a.reviewed_at, IF(a.status = 'approved', 'Application approved', 'Application rejected'), $who, 'Registrar',
             CONCAT(a.first_name, ' ', a.last_name), CONCAT(a.reference, IF(a.reject_reason IS NULL, '', CONCAT(': ', a.reject_reason)))
        FROM applications a LEFT JOIN users u ON u.user_id = a.reviewed_by LEFT JOIN office_staff st ON st.user_id = u.user_id LEFT JOIN students s ON s.user_id = u.user_id
       WHERE a.reviewed_at IS NOT NULL AND a.reviewed_at BETWEEN ? AND ?
      UNION ALL
      SELECT x.created_at, CASE WHEN x.action LIKE 'deadline.%' THEN 'Deadline' WHEN x.action LIKE 'reminder.%' THEN 'Reminder' ELSE 'Admin change' END, $who, COALESCE(o2.name, ''), '', x.details
        FROM admin_actions x LEFT JOIN users u ON u.user_id = x.user_id LEFT JOIN office_staff st ON st.user_id = u.user_id LEFT JOIN students s ON s.user_id = u.user_id LEFT JOIN offices o2 ON o2.office_id = st.office_id
       WHERE x.created_at BETWEEN ? AND ?
      ORDER BY at DESC
      LIMIT 1000";
    $rows = all($sql, array_merge($p, $p, $p, $p, $p, $p));
    return ['from' => $fromOk, 'to' => $toOk, 'rows' => $rows];
}

function routeAuditLog(): never
{
    requireMethod('GET');
    requireRegistrar();
    $a = auditRows();
    if (!empty($_GET['csv'])) {
        csvOut('cleargate-audit-' . $a['from'] . '-to-' . $a['to'] . '.csv', ['When', 'Type', 'By', 'Office', 'About', 'Details'],
            array_map(fn ($r) => [$r['at'], $r['kind'], $r['actor'], $r['office'], $r['subject'], $r['details']], $a['rows']));
    }
    ok($a);
}

/* ---- Deadlines and reminders */

/** Offices a user may set deadlines and reminders for: staff = their office, admin = any (or all). */
function deadlineOffices(array $user, string $code): array
{
    $own = staffOfficeId($user);
    if ($own !== null) {
        $o = one('SELECT office_id, code, name FROM offices WHERE office_id = ?', [$own]);
        if ($code !== '' && $code !== $o['code']) fail(403, 'forbidden', 'You can only manage deadlines for your own office.');
        return [$o];
    }
    if ($code === 'all') return all('SELECT office_id, code, name FROM offices WHERE is_active = 1 ORDER BY sort_order');
    $o = one('SELECT office_id, code, name FROM offices WHERE code = ?', [$code]);
    if (!$o) fail(400, 'invalid_office', 'Choose an office.');
    return [$o];
}

/** Parses the "YYYY-MM-DDTHH:MM" value of a datetime-local input. */
function parseLocalDateTime(string $value): ?string
{
    $value = str_replace('T', ' ', trim($value));
    foreach (['!Y-m-d H:i', '!Y-m-d H:i:s'] as $fmt) {
        $d = DateTime::createFromFormat($fmt, $value);
        if ($d) return $d->format('Y-m-d H:i:s');
    }
    return null;
}

function dbNow(): string
{
    return one('SELECT NOW() AS n')['n'];
}

function prettyDue(string $dt): string
{
    return date('D, M j, g:i A', strtotime($dt));
}

/** Sends one reminder: writes a bell notification for every student it reaches. Returns how many. */
function deliverReminder(int $id, bool $tellAuthor = false): int
{
    // Claim it first, so two requests can't send the same reminder twice.
    if (run('UPDATE reminders SET sent_at = NOW() WHERE reminder_id = ? AND sent_at IS NULL AND cancelled_at IS NULL', [$id]) !== 1) {
        return 0;
    }
    $r = one('SELECT r.*, o.name AS office_name FROM reminders r LEFT JOIN offices o ON o.office_id = r.office_id WHERE r.reminder_id = ?', [$id]);
    $where = ["c.academic_year_id = ?", "c.term = ?", "ci.status <> 'approved'", 'u.is_active = 1', 'o.is_active = 1'];
    $params = [$r['academic_year_id'], $r['term']];
    if ($r['office_id']) { $where[] = 'ci.office_id = ?'; $params[] = $r['office_id']; }
    if ($r['audience'] === 'overdue') $where[] = 'COALESCE(ci.due_at, od.due_at) < NOW()';
    if ($r['audience'] === 'student') { $where[] = 'ci.item_id = ?'; $params[] = $r['item_id']; }
    $from = "FROM clearance_items ci
             JOIN clearances c ON c.clearance_id = ci.clearance_id
             JOIN students s ON s.student_id = c.student_id
             JOIN users u ON u.user_id = s.user_id
             JOIN offices o ON o.office_id = ci.office_id
             LEFT JOIN office_deadlines od ON od.office_id = ci.office_id AND od.academic_year_id = c.academic_year_id AND od.term = c.term
            WHERE " . implode(' AND ', $where);
    $title = mb_substr('Reminder from ' . ($r['office_name'] ?: 'the Administrator'), 0, 120);
    $tone = $r['audience'] === 'overdue' ? 'needs_action' : 'info';
    if ($r['office_id']) {
        // One notification per requirement, linked to it.
        $n = run("INSERT INTO notifications (user_id, item_id, tone, title, body) SELECT u.user_id, ci.item_id, ?, ?, ? $from",
            array_merge([$tone, $title, $r['message']], $params));
    } else {
        // From the admin to every office's outstanding students: one per student.
        $n = run("INSERT INTO notifications (user_id, item_id, tone, title, body) SELECT DISTINCT u.user_id, NULL, ?, ?, ? $from",
            array_merge([$tone, $title, $r['message']], $params));
    }
    run('UPDATE reminders SET recipients = ? WHERE reminder_id = ?', [$n, $id]);
    if ($tellAuthor && $r['created_by']) {
        run("INSERT INTO notifications (user_id, tone, title, body, link) VALUES (?, 'approved', ?, ?, 'deadlines.html')",
            [$r['created_by'], 'Scheduled reminder sent', mb_substr("Sent to $n student" . ($n === 1 ? '' : 's') . ': ' . $r['message'], 0, 255)]);
    }
    return $n;
}

/**
 * Runs on API requests (at most once a minute): sends scheduled reminders that are due,
 * and the automatic deadline reminders (3 days left, 1 day left, overdue).
 */
function runScheduler(bool $force = false): void
{
    global $config;
    $stamp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cleargate-scheduler-' . preg_replace('/\W/', '', (string) $config['db_name']) . '.txt';
    if (!$force && is_file($stamp) && time() - (int) @filemtime($stamp) < 60) return;
    @touch($stamp);

    foreach (all('SELECT reminder_id FROM reminders WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= NOW() ORDER BY send_at LIMIT 50') as $r) {
        deliverReminder((int) $r['reminder_id'], true);
    }

    try {
        autoBackup();
    } catch (Throwable $e) {
        error_log('ClearGate backup: ' . $e->getMessage());
    }

    $ct = currentTerm();
    if (!$ct) return;

    // Tell the office (and admins) once when an office deadline passes.
    $passed = all("SELECT od.deadline_id, od.office_id, o.name, od.due_at FROM office_deadlines od JOIN offices o ON o.office_id = od.office_id
                    WHERE od.passed_notified_at IS NULL AND od.due_at < NOW() AND od.due_at > NOW() - INTERVAL 7 DAY
                      AND od.academic_year_id = ? AND od.term = ?", [$ct['academic_year_id'], $ct['term']]);
    foreach ($passed as $d) {
        if (run('UPDATE office_deadlines SET passed_notified_at = NOW() WHERE deadline_id = ? AND passed_notified_at IS NULL', [$d['deadline_id']]) !== 1) continue;
        $left = (int) one("SELECT COUNT(*) AS n FROM clearance_items ci JOIN clearances c ON c.clearance_id = ci.clearance_id
                            WHERE ci.office_id = ? AND c.academic_year_id = ? AND c.term = ? AND ci.status <> 'approved' AND ci.due_at IS NULL",
            [$d['office_id'], $ct['academic_year_id'], $ct['term']])['n'];
        notifyOffice((int) $d['office_id'], true, null, $left ? 'needs_action' : 'approved', "{$d['name']} deadline passed",
            $left ? "$left student" . ($left === 1 ? ' is' : 's are') . ' not cleared yet. Send them a reminder from Deadlines.' : 'Every student was cleared in time.',
            'deadlines.html');
    }

    $rows = all(
        "SELECT ci.item_id, u.user_id, o.name AS office_name, ci.task, COALESCE(ci.due_at, od.due_at) AS due,
                TIMESTAMPDIFF(MINUTE, NOW(), COALESCE(ci.due_at, od.due_at)) AS mins
           FROM clearance_items ci
           JOIN clearances c ON c.clearance_id = ci.clearance_id
           JOIN students s ON s.student_id = c.student_id
           JOIN users u ON u.user_id = s.user_id AND u.is_active = 1
           JOIN offices o ON o.office_id = ci.office_id AND o.is_active = 1
           LEFT JOIN office_deadlines od ON od.office_id = ci.office_id AND od.academic_year_id = c.academic_year_id AND od.term = c.term
          WHERE c.academic_year_id = ? AND c.term = ? AND ci.status <> 'approved'
            AND COALESCE(ci.due_at, od.due_at) BETWEEN NOW() - INTERVAL 7 DAY AND NOW() + INTERVAL 3 DAY",
        [$ct['academic_year_id'], $ct['term']]
    );
    foreach ($rows as $r) {
        $mins = (int) $r['mins'];
        $stage = $mins < 0 ? 'overdue' : ($mins <= 1440 ? '1d' : '3d');
        if (run('INSERT IGNORE INTO deadline_alerts (item_id, stage, due_at) VALUES (?, ?, ?)', [$r['item_id'], $stage, $r['due']]) !== 1) continue;
        $when = prettyDue($r['due']);
        if ($stage === 'overdue') {
            $title = "Overdue: {$r['office_name']}";
            $body = "The deadline was $when. You can still finish \"{$r['task']}\", so do it as soon as you can.";
        } elseif ($stage === '1d') {
            $title = "Due within a day: {$r['office_name']}";
            $body = "Finish \"{$r['task']}\" by $when.";
        } else {
            $title = "Due in 3 days: {$r['office_name']}";
            $body = "Finish \"{$r['task']}\" by $when.";
        }
        run('INSERT INTO notifications (user_id, item_id, tone, title, body) VALUES (?, ?, ?, ?, ?)',
            [$r['user_id'], $r['item_id'], $stage === '3d' ? 'pending' : 'needs_action', mb_substr($title, 0, 120), mb_substr($body, 0, 255)]);
    }
}

function routeDeadlines(): never
{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);
    $ct = currentTerm();
    if (!$ct) ok(['term' => null]);
    $own = staffOfficeId($user);
    $p = [$ct['academic_year_id'], $ct['term']];

    $ow = 'o.is_active = 1';
    $op = [];
    if ($own !== null) { $ow = 'o.office_id = ?'; $op = [$own]; }
    $offices = all(
        "SELECT o.office_id, o.code, o.name, o.icon, od.due_at, od.note, od.updated_at,
                COALESCE(st.full_name, u.full_name, u.email) AS set_by,
                COUNT(ci.office_id) AS students,
                COALESCE(SUM(ci.status <> 'approved'), 0) AS outstanding,
                COALESCE(SUM(ci.status <> 'approved' AND COALESCE(ci.due_at, od.due_at) < NOW()), 0) AS overdue,
                COALESCE(SUM(ci.due_at IS NOT NULL), 0) AS own_deadlines
           FROM offices o
           LEFT JOIN office_deadlines od ON od.office_id = o.office_id AND od.academic_year_id = ? AND od.term = ?
           LEFT JOIN users u ON u.user_id = od.set_by
           LEFT JOIN office_staff st ON st.user_id = od.set_by
           LEFT JOIN (SELECT ci.office_id, ci.status, ci.due_at FROM clearance_items ci
                        JOIN clearances c ON c.clearance_id = ci.clearance_id
                       WHERE c.academic_year_id = ? AND c.term = ?) ci ON ci.office_id = o.office_id
          WHERE $ow
          GROUP BY o.office_id, o.code, o.name, o.icon, od.due_at, od.note, od.updated_at, set_by
          ORDER BY o.sort_order",
        array_merge($p, $p, $op)
    );

    $iw = ['c.academic_year_id = ?', 'c.term = ?', 'o.is_active = 1'];
    $ip = $p;
    if ($own !== null) { $iw[] = 'ci.office_id = ?'; $ip[] = $own; }
    $items = all(
        "SELECT ci.item_id, s.student_number, CONCAT(s.first_name, ' ', s.last_name) AS student_name, o.code AS office_code,
                o.name AS office_name, ci.status, ci.task, ci.due_at AS own_due_at, od.due_at AS office_due_at
           FROM clearance_items ci
           JOIN clearances c ON c.clearance_id = ci.clearance_id
           JOIN students s ON s.student_id = c.student_id
           JOIN offices o ON o.office_id = ci.office_id
           LEFT JOIN office_deadlines od ON od.office_id = ci.office_id AND od.academic_year_id = c.academic_year_id AND od.term = c.term
          WHERE " . implode(' AND ', $iw) . "
          ORDER BY s.last_name, s.first_name, o.sort_order",
        $ip
    );

    $rw = ['1 = 1'];
    $rp = [];
    if ($own !== null) { $rw[] = '(r.office_id = ? OR r.office_id IS NULL)'; $rp[] = $own; }
    $reminders = all(
        "SELECT r.reminder_id, r.audience, r.message, r.send_at, r.sent_at, r.cancelled_at, r.recipients, r.created_at,
                o.code AS office_code, o.name AS office_name, r.created_by,
                COALESCE(st.full_name, u.full_name, u.email) AS created_by_name,
                CONCAT(s.first_name, ' ', s.last_name) AS student_name, s.student_number
           FROM reminders r
           LEFT JOIN offices o ON o.office_id = r.office_id
           LEFT JOIN users u ON u.user_id = r.created_by
           LEFT JOIN office_staff st ON st.user_id = r.created_by
           LEFT JOIN clearance_items ci ON ci.item_id = r.item_id
           LEFT JOIN clearances c ON c.clearance_id = ci.clearance_id
           LEFT JOIN students s ON s.student_id = c.student_id
          WHERE " . implode(' AND ', $rw) . "
          ORDER BY (r.sent_at IS NULL AND r.cancelled_at IS NULL) DESC, COALESCE(r.sent_at, r.send_at) DESC
          LIMIT 100",
        $rp
    );
    ok(['term' => $ct, 'now' => dbNow(), 'offices' => $offices, 'items' => $items, 'reminders' => $reminders]);
}

function routeSaveDeadline(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();
    $ct = currentTerm();
    if (!$ct) fail(400, 'no_term', 'No current academic year is set.');
    $offices = deadlineOffices($user, str($in, 'office', 20));
    $termText = "{$ct['term']}, A.Y {$ct['label']}";
    $names = count($offices) > 1 ? 'every office' : $offices[0]['name'];

    if (!empty($in['clear'])) {
        foreach ($offices as $o) {
            run('DELETE FROM office_deadlines WHERE office_id = ? AND academic_year_id = ? AND term = ?', [$o['office_id'], $ct['academic_year_id'], $ct['term']]);
        }
        logAdmin($user, 'deadline.clear', "Removed the $names deadline ($termText)");
        ok();
    }

    $due = parseLocalDateTime(str($in, 'due_at', 20));
    if (!$due) fail(400, 'invalid_date', 'Choose a date and time for the deadline.');
    if (strtotime($due) <= strtotime(dbNow())) fail(400, 'past_date', 'The deadline must be in the future.');
    $note = optionalStr($in, 'note', 255);
    $note = $note === '' ? null : $note;
    $notified = 0;
    foreach ($offices as $o) {
        run('INSERT INTO office_deadlines (office_id, academic_year_id, term, due_at, note, set_by) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE due_at = VALUES(due_at), note = VALUES(note), set_by = VALUES(set_by), passed_notified_at = NULL',
            [$o['office_id'], $ct['academic_year_id'], $ct['term'], $due, $note, $user['user_id']]);
        if (!empty($in['notify'])) {
            $notified += run(
                "INSERT INTO notifications (user_id, item_id, tone, title, body)
                 SELECT u.user_id, ci.item_id, 'info', ?, CONCAT('Finish \"', ci.task, '\" by ', ?, '.', IF(? IS NULL, '', CONCAT(' ', ?)))
                   FROM clearance_items ci
                   JOIN clearances c ON c.clearance_id = ci.clearance_id
                   JOIN students s ON s.student_id = c.student_id
                   JOIN users u ON u.user_id = s.user_id AND u.is_active = 1
                  WHERE ci.office_id = ? AND c.academic_year_id = ? AND c.term = ? AND ci.status <> 'approved' AND ci.due_at IS NULL",
                [mb_substr("New deadline: {$o['name']}", 0, 120), prettyDue($due), $note, $note, $o['office_id'], $ct['academic_year_id'], $ct['term']]);
        }
    }
    logAdmin($user, 'deadline.set', "Set the $names deadline to " . prettyDue($due) . " ($termText)" . ($notified ? ", notified $notified student" . ($notified === 1 ? '' : 's') : ''));
    ok(['due_at' => $due, 'notified' => $notified]);
}

/** Gives one student their own deadline for one office (or removes it). */
function routeItemDeadline(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();
    $itemId = filter_var($in['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $item = $itemId ? one("SELECT ci.item_id, ci.office_id, ci.task, ci.status, o.name AS office_name, u.user_id, CONCAT(s.first_name, ' ', s.last_name) AS student,
                                  s.student_number
                             FROM clearance_items ci JOIN offices o ON o.office_id = ci.office_id
                             JOIN clearances c ON c.clearance_id = ci.clearance_id JOIN students s ON s.student_id = c.student_id
                             JOIN users u ON u.user_id = s.user_id WHERE ci.item_id = ?", [$itemId]) : null;
    if (!$item) fail(404, 'not_found', 'Requirement not found.');
    $own = staffOfficeId($user);
    if ($own !== null && $own !== (int) $item['office_id']) fail(403, 'forbidden', 'You can only set deadlines for your own office.');

    $raw = $in['due_at'] ?? '';
    if ($raw === null || $raw === '') {
        run('UPDATE clearance_items SET due_at = NULL, updated_at = updated_at WHERE item_id = ?', [$itemId]);
        logAdmin($user, 'deadline.student_clear', "Removed the own {$item['office_name']} deadline of {$item['student']} ({$item['student_number']})");
        ok(['due_at' => null]);
    }
    $due = parseLocalDateTime(is_string($raw) ? $raw : '');
    if (!$due) fail(400, 'invalid_date', 'Choose a date and time for the deadline.');
    if (strtotime($due) <= strtotime(dbNow())) fail(400, 'past_date', 'The deadline must be in the future.');
    run('UPDATE clearance_items SET due_at = ?, updated_at = updated_at WHERE item_id = ?', [$due, $itemId]);
    if (!empty($in['notify']) && $item['status'] !== 'approved') {
        run("INSERT INTO notifications (user_id, item_id, tone, title, body) VALUES (?, ?, 'info', ?, ?)",
            [$item['user_id'], $itemId, mb_substr("New deadline: {$item['office_name']}", 0, 120),
             mb_substr("Finish \"{$item['task']}\" by " . prettyDue($due) . '.', 0, 255)]);
    }
    logAdmin($user, 'deadline.student', "Gave {$item['student']} ({$item['student_number']}) a {$item['office_name']} deadline of " . prettyDue($due));
    ok(['due_at' => $due]);
}

function routeSendReminder(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();
    $ct = currentTerm();
    if (!$ct) fail(400, 'no_term', 'No current academic year is set.');
    $audience = $in['audience'] ?? '';
    if (!in_array($audience, ['outstanding', 'overdue', 'student'], true)) fail(400, 'invalid_audience', 'Choose who gets the reminder.');
    $message = str($in, 'message', 255);
    if ($message === '') fail(400, 'missing_fields', 'Write the reminder message.');

    $officeId = null;
    $itemId = null;
    $officeName = 'every office';
    if ($audience === 'student') {
        $itemId = filter_var($in['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $item = $itemId ? one("SELECT ci.office_id, o.name, CONCAT(s.first_name, ' ', s.last_name) AS student FROM clearance_items ci
                                 JOIN offices o ON o.office_id = ci.office_id JOIN clearances c ON c.clearance_id = ci.clearance_id
                                 JOIN students s ON s.student_id = c.student_id WHERE ci.item_id = ?", [$itemId]) : null;
        if (!$item) fail(400, 'invalid_student', 'Choose the student to remind.');
        $own = staffOfficeId($user);
        if ($own !== null && $own !== (int) $item['office_id']) fail(403, 'forbidden', 'You can only remind students about your own office.');
        $officeId = (int) $item['office_id'];
        $officeName = $item['name'];
        $who = $item['student'];
    } else {
        $code = str($in, 'office', 20);
        $offices = deadlineOffices($user, $code);
        if ($code !== 'all' || staffOfficeId($user) !== null) {
            $officeId = (int) $offices[0]['office_id'];
            $officeName = $offices[0]['name'];
        }
        $who = $audience === 'overdue' ? 'overdue students' : 'students not yet cleared';
    }

    $now = dbNow();
    $sendAt = $now;
    $rawAt = $in['send_at'] ?? '';
    if (is_string($rawAt) && $rawAt !== '') {
        $sendAt = parseLocalDateTime($rawAt);
        if (!$sendAt) fail(400, 'invalid_date', 'Choose a valid date and time.');
        if (strtotime($sendAt) < strtotime($now) - 60) fail(400, 'past_date', 'Pick a time in the future, or send it now.');
    }
    run('INSERT INTO reminders (office_id, item_id, academic_year_id, term, audience, message, send_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$officeId, $itemId, $ct['academic_year_id'], $ct['term'], $audience, $message, $sendAt, $user['user_id']]);
    $id = (int) db()->lastInsertId();
    $sent = null;
    if (strtotime($sendAt) <= strtotime($now)) {
        $sent = deliverReminder($id);
        logAdmin($user, 'reminder.send', "Sent a reminder from $officeName to $who ($sent): $message");
    } else {
        logAdmin($user, 'reminder.schedule', "Scheduled a reminder from $officeName to $who for " . prettyDue($sendAt) . ": $message");
    }
    ok(['reminder_id' => $id, 'sent_to' => $sent, 'send_at' => $sendAt]);
}

function routeCancelReminder(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();
    $id = filter_var($in['reminder_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $r = $id ? one('SELECT r.office_id, r.message, r.send_at, o.name FROM reminders r LEFT JOIN offices o ON o.office_id = r.office_id WHERE r.reminder_id = ?', [$id]) : null;
    if (!$r) fail(404, 'not_found', 'Reminder not found.');
    $own = staffOfficeId($user);
    if ($own !== null && $own !== (int) $r['office_id']) fail(403, 'forbidden', 'You can only cancel your own office\'s reminders.');
    if (run('UPDATE reminders SET cancelled_at = NOW() WHERE reminder_id = ? AND sent_at IS NULL AND cancelled_at IS NULL', [$id]) !== 1) {
        fail(409, 'already_sent', 'That reminder has already gone out or was cancelled.');
    }
    logAdmin($user, 'reminder.cancel', 'Cancelled the ' . ($r['name'] ?: 'every-office') . ' reminder set for ' . prettyDue($r['send_at']) . ": {$r['message']}");
    ok();
}

/* ---- My Profile: editing details and the avatar */

function avatarDir(): string
{
    $dir = uploadDir() . DIRECTORY_SEPARATOR . 'avatars';
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        fail(500, 'upload_dir', 'The server cannot store profile pictures. Check that api/uploads is writable.');
    }
    return $dir;
}

/** Contact details a student keeps up to date, falling back to what they wrote on their application. */
function studentContact(int $userId): array
{
    $r = one('SELECT u.phone, u.personal_email, s.current_address, s.emergency_name, s.emergency_contact, a.contact_number,
                     a.street, a.barangay, a.city, a.province, a.region, a.postal_code,
                     a.guardian_first, a.guardian_middle, a.guardian_last, a.guardian_contact, a.personal_email AS app_email
                FROM users u JOIN students s ON s.user_id = u.user_id
                LEFT JOIN applications a ON a.application_id = s.application_id
               WHERE u.user_id = ?', [$userId]);
    if (!$r) return [];
    $appAddress = implode(', ', array_filter([$r['street'], $r['barangay'], $r['city'], $r['province'], $r['region'], $r['postal_code']]));
    $guardian = trim(preg_replace('/\s+/', ' ', ($r['guardian_first'] ?? '') . ' ' . ($r['guardian_middle'] ?? '') . ' ' . ($r['guardian_last'] ?? '')));
    return [
        'personal_email'    => $r['personal_email'] ?? $r['app_email'],
        'phone'             => $r['phone'] ?? $r['contact_number'],
        'current_address'   => $r['current_address'] ?? ($appAddress ?: null),
        'emergency_name'    => $r['emergency_name'] ?? ($guardian ?: null),
        'emergency_contact' => $r['emergency_contact'] ?? $r['guardian_contact'],
    ];
}

function phoneOrNull(array $in, string $key, string $label): ?string
{
    $v = optionalStr($in, $key, 20);
    if ($v === null || $v === '') return null;
    if (!preg_match('/^\+?[0-9][0-9 ()-]{6,18}$/', $v)) fail(400, 'invalid_phone', "$label should be a phone number, e.g. 0917 123 4567.");
    return $v;
}

function routeUpdateProfile(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser();
    $in = body();
    $phone = phoneOrNull($in, 'phone', 'Mobile number');

    if ($user['role'] === 'student') {
        $email = mb_strtolower(str($in, 'personal_email', 190));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_email', 'Enter a valid personal email.');
        if ($email !== '' && str_ends_with($email, '@cgateway.edu.ph')) fail(400, 'invalid_email', 'Use your own email here, not your ClearGate school email.');
        if ($email !== '' && one('SELECT 1 AS x FROM users WHERE (email = ? OR personal_email = ?) AND user_id <> ?', [$email, $email, $user['user_id']])) {
            fail(409, 'email_taken', 'Another account already uses that email.');
        }
        $address = optionalStr($in, 'current_address', 255);
        $ename = optionalStr($in, 'emergency_name', 120);
        $econtact = phoneOrNull($in, 'emergency_contact', 'Emergency contact number');
        run('UPDATE users SET personal_email = ?, phone = ? WHERE user_id = ?', [$email ?: null, $phone, $user['user_id']]);
        run('UPDATE students SET current_address = ?, emergency_name = ?, emergency_contact = ? WHERE user_id = ?',
            [$address ?: null, $ename ?: null, $econtact, $user['user_id']]);
        ok(profilePayload($user));
    }

    $name = str($in, 'full_name', 120);
    if (mb_strlen($name) < 2) fail(400, 'missing_fields', 'Enter your full name.');
    run('UPDATE users SET phone = ? WHERE user_id = ?', [$phone, $user['user_id']]);
    $staff = one('SELECT user_id FROM office_staff WHERE user_id = ?', [$user['user_id']]);
    if ($staff) {
        $position = optionalStr($in, 'position', 80);
        run('UPDATE office_staff SET full_name = ?, position = ? WHERE user_id = ?', [$name, $position ?: null, $user['user_id']]);
    }
    if ($user['role'] === 'admin') run('UPDATE users SET full_name = ? WHERE user_id = ?', [$name, $user['user_id']]);
    ok(profilePayload($user));
}

function routeUploadAvatar(): never
{
    requireMethod('POST');
    checkOrigin();
    if (($_SERVER['HTTP_X_CLEARGATE'] ?? '') !== '1') fail(400, 'bad_request', 'Upload from the ClearGate website.');
    $user = requireUser();
    $file = $_FILES['avatar'] ?? null;
    if (!$file || !is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) fail(400, 'no_file', 'Choose a picture to upload.');
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > 2 * 1024 * 1024) {
        fail(413, 'file_too_large', 'That picture is too large. The limit is 2 MB.');
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) fail(400, 'upload_failed', 'The upload did not finish. Please try again.');
    $type = sniffType($file['tmp_name']);
    if (!$type || $type[0] === 'application/pdf') fail(415, 'file_type', 'Upload a JPG, PNG or WEBP picture.');

    $stored = 'u' . $user['user_id'] . '-' . bin2hex(random_bytes(8)) . '.' . $type[1];
    if (!move_uploaded_file($file['tmp_name'], avatarDir() . DIRECTORY_SEPARATOR . $stored)) fail(500, 'upload_failed', 'The server could not save the picture.');
    $old = one('SELECT avatar_name FROM users WHERE user_id = ?', [$user['user_id']])['avatar_name'] ?? null;
    run('UPDATE users SET avatar_name = ?, avatar_mime = ? WHERE user_id = ?', [$stored, $type[0], $user['user_id']]);
    if ($old) @unlink(avatarDir() . DIRECTORY_SEPARATOR . basename($old));
    ok(['avatar' => avatarUrl((int) $user['user_id'], $stored)]);
}

function routeRemoveAvatar(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser();
    $old = one('SELECT avatar_name FROM users WHERE user_id = ?', [$user['user_id']])['avatar_name'] ?? null;
    run('UPDATE users SET avatar_name = NULL, avatar_mime = NULL WHERE user_id = ?', [$user['user_id']]);
    if ($old) @unlink(avatarDir() . DIRECTORY_SEPARATOR . basename($old));
    ok();
}

function avatarUrl(int $userId, ?string $stored): ?string
{
    return $stored ? 'api/index.php?route=avatar&id=' . $userId . '&v=' . substr(md5($stored), 0, 8) : null;
}

/** Profile pictures: your own, or anyone's for staff and admins. */
function routeAvatar(): never
{
    requireMethod('GET');
    $user = requireUser();
    $id = filter_var($_GET['id'] ?? $user['user_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) fail(400, 'invalid_id', 'Missing id.');
    if ($user['role'] === 'student' && (int) $id !== (int) $user['user_id']) {
        // Students may also see the pictures of staff and admins (e.g. in messages).
        $target = one('SELECT role FROM users WHERE user_id = ?', [$id]);
        if (!$target || $target['role'] === 'student') fail(403, 'forbidden', 'You cannot see that picture.');
    }
    $a = one('SELECT avatar_name, avatar_mime FROM users WHERE user_id = ?', [$id]);
    $path = $a && $a['avatar_name'] ? avatarDir() . DIRECTORY_SEPARATOR . basename($a['avatar_name']) : null;
    if (!$path || !is_file($path)) fail(404, 'not_found', 'No profile picture.');
    header_remove('Content-Type');
    header('Content-Type: ' . $a['avatar_mime']);
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=86400');
    readfile($path);
    exit;
}

/* ---- Backups */

function backupDir(): string
{
    global $config;
    $dir = rtrim($config['backup_dir'] ?? (__DIR__ . '/backups'), '/\\');
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
        fail(500, 'backup_dir', 'The server cannot store backups. Check that the api folder is writable.');
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "# Backups are only served through api/index.php (admins only).\nRequire all denied\n");
    }
    return $dir;
}

/** The whole cleargate database as one .sql file that phpMyAdmin (Import) can load. */
function backupSql(): string
{
    $pdo = db();
    $q = fn (string $name) => '`' . str_replace('`', '``', $name) . '`';
    $db = $pdo->query('SELECT DATABASE()')->fetchColumn();
    $out = "-- ClearGate database backup\n-- Created " . dbNow() . " (database `$db`)\n" .
        "-- Restore: phpMyAdmin > Import this file (it recreates the cleargate database), or\n" .
        "--          mysql -u root < this-file.sql\n\n" .
        "SET NAMES utf8mb4;\nSET time_zone = '+08:00';\nSET FOREIGN_KEY_CHECKS = 0;\n" .
        "CREATE DATABASE IF NOT EXISTS {$q($db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nUSE {$q($db)};\n\n";

    $objects = $pdo->query('SHOW FULL TABLES')->fetchAll(PDO::FETCH_NUM);
    $tables = array_values(array_map(fn ($r) => $r[0], array_filter($objects, fn ($r) => $r[1] === 'BASE TABLE')));
    $views = array_values(array_map(fn ($r) => $r[0], array_filter($objects, fn ($r) => $r[1] === 'VIEW')));

    foreach ($views as $v) $out .= "DROP VIEW IF EXISTS {$q($v)};\n";
    foreach ($tables as $t) $out .= "DROP TABLE IF EXISTS {$q($t)};\n";
    $out .= "\n";

    foreach ($tables as $t) {
        $create = $pdo->query("SHOW CREATE TABLE {$q($t)}")->fetch(PDO::FETCH_NUM)[1];
        $out .= "-- Table $t\n" . preg_replace('/ AUTO_INCREMENT=\d+/', '', $create) . ";\n";
        $stmt = $pdo->query("SELECT * FROM {$q($t)}");
        $batch = [];
        $cols = null;
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $cols ??= implode(', ', array_map($q, array_keys($row)));
            $batch[] = '(' . implode(', ', array_map(fn ($v) => $v === null ? 'NULL' : $pdo->quote((string) $v), $row)) . ')';
            if (count($batch) === 100) { $out .= "INSERT INTO {$q($t)} ($cols) VALUES\n" . implode(",\n", $batch) . ";\n"; $batch = []; }
        }
        if ($batch) $out .= "INSERT INTO {$q($t)} ($cols) VALUES\n" . implode(",\n", $batch) . ";\n";
        $out .= "\n";
    }

    // Views can depend on each other, so create them with a retry order.
    $pending = $views;
    $made = [];
    for ($pass = 0; $pending && $pass < 5; $pass++) {
        foreach ($pending as $i => $v) {
            $sql = $pdo->query("SHOW CREATE VIEW {$q($v)}")->fetch(PDO::FETCH_NUM)[1];
            $sql = preg_replace('/^CREATE .*? VIEW/s', 'CREATE VIEW', $sql);
            $deps = array_filter($pending, fn ($o) => $o !== $v && str_contains($sql, '`' . $o . '`'));
            if (!$deps || $pass === 4) { $made[] = "-- View $v\n$sql;\n"; unset($pending[$i]); }
        }
    }
    $out .= implode("\n", $made) . "\n";

    $out .= "DELIMITER $$\n";
    foreach ($pdo->query("SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()")->fetchAll(PDO::FETCH_NUM) as [$name, $type]) {
        $row = $pdo->query("SHOW CREATE $type {$q($name)}")->fetch(PDO::FETCH_ASSOC);
        $sql = $row['Create Procedure'] ?? $row['Create Function'] ?? null;
        if (!$sql) continue;
        $sql = preg_replace('/^CREATE DEFINER=\S+ /', 'CREATE ', $sql);
        $out .= "DROP $type IF EXISTS {$q($name)}$$\n-- $type $name\n$sql$$\n\n";
    }
    foreach ($pdo->query('SHOW TRIGGERS')->fetchAll(PDO::FETCH_ASSOC) as $tr) {
        $sql = $pdo->query("SHOW CREATE TRIGGER {$q($tr['Trigger'])}")->fetch(PDO::FETCH_ASSOC)['SQL Original Statement'];
        $sql = preg_replace('/^CREATE DEFINER=\S+ /', 'CREATE ', $sql);
        $out .= "DROP TRIGGER IF EXISTS {$q($tr['Trigger'])}$$\n-- Trigger {$tr['Trigger']}\n$sql$$\n\n";
    }
    $out .= "DELIMITER ;\n\nSET FOREIGN_KEY_CHECKS = 1;\n-- End of backup\n";
    return $out;
}

/** Writes a backup to api/backups and keeps the newest $keep automatic ones. */
function saveBackup(string $kind, int $keep = 14): array
{
    $dir = backupDir();
    $name = 'cleargate-' . date('Y-m-d-His', strtotime(dbNow())) . '-' . $kind . '.sql';
    $sql = backupSql();
    if (file_put_contents($dir . DIRECTORY_SEPARATOR . $name, $sql) === false) {
        fail(500, 'backup_failed', 'The backup could not be written to the server.');
    }
    if ($kind === 'auto') {
        $autos = glob($dir . DIRECTORY_SEPARATOR . 'cleargate-*-auto.sql') ?: [];
        rsort($autos);
        foreach (array_slice($autos, $keep) as $old) @unlink($old);
    }
    return ['file' => $name, 'size' => strlen($sql)];
}

function backupList(): array
{
    $files = glob(backupDir() . DIRECTORY_SEPARATOR . 'cleargate-*.sql') ?: [];
    rsort($files);
    return array_map(fn ($f) => [
        'file'    => basename($f),
        'size'    => filesize($f),
        'kind'    => str_ends_with($f, '-auto.sql') ? 'auto' : 'manual',
        'created' => preg_match('/cleargate-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})/', basename($f), $m)
            ? "{$m[1]} {$m[2]}:{$m[3]}:{$m[4]}" : date('Y-m-d H:i:s', filemtime($f)),
    ], $files);
}

/** Daily automatic backup, run by the scheduler. */
function autoBackup(): void
{
    $dir = backupDir();
    $latest = 0;
    foreach (glob($dir . DIRECTORY_SEPARATOR . 'cleargate-*.sql') ?: [] as $f) $latest = max($latest, (int) filemtime($f));
    if (time() - $latest >= 86400) saveBackup('auto');
}

function routeBackups(): never
{
    requireMethod('GET');
    requireAdmin();
    ok(['backups' => backupList(), 'folder' => backupDir()]);
}

function routeCreateBackup(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireAdmin();
    $b = saveBackup('manual');
    logAdmin($user, 'backup.create', "Created backup {$b['file']}");
    ok($b);
}

function routeDownloadBackup(): never
{
    requireMethod('GET');
    $user = requireAdmin();
    $name = basename((string) ($_GET['file'] ?? ''));
    if (!preg_match('/^cleargate-[\w-]+\.sql$/', $name)) {
        // No file named: make a fresh one and download it.
        $b = saveBackup('manual');
        $name = $b['file'];
    }
    $path = backupDir() . DIRECTORY_SEPARATOR . $name;
    if (!is_file($path)) fail(404, 'not_found', 'That backup no longer exists.');
    logAdmin($user, 'backup.download', "Downloaded backup $name");
    header_remove('Content-Type');
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: no-store');
    readfile($path);
    exit;
}

function routeOfficeQueue(): never

{
    requireMethod('GET');
    $user = requireUser(['staff', 'admin']);

    $params = [];
    $where = ['1 = 1'];
    if ($user['role'] === 'staff') {
        $where[] = 'v.office_id = (SELECT office_id FROM office_staff WHERE user_id = ?)';
        $params[] = $user['user_id'];
    } elseif (!empty($_GET['office'])) {
        $where[] = 'v.office_code = ?';
        $params[] = (string) $_GET['office'];
    }
    if (!empty($_GET['status'])) {
        if (!in_array($_GET['status'], ['needs_action', 'pending', 'approved'], true)) {
            fail(400, 'invalid_status', 'status must be needs_action, pending or approved.');
        }
        $where[] = 'v.status = ?';
        $params[] = $_GET['status'];
    }

    $rows = all(
        'SELECT v.item_id, v.student_number, v.student_name, v.office_code, v.office_name,
                v.status, v.task, v.remarks, v.description, v.next_step, v.updated_at, v.due_at, v.own_due_at, v.office_due_at, ay.label AS academic_year, c.term
           FROM v_clearance_items v
           JOIN clearances c      ON c.clearance_id = v.clearance_id
           JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
          WHERE ay.is_current = 1 AND c.term = ? AND ' . implode(' AND ', $where) . '
          ORDER BY FIELD(v.status, \'needs_action\', \'pending\', \'approved\'), v.student_name',
        array_merge([currentTerm()['term'] ?? '1st Semester'], $params)
    );
    ok($rows);
}

function routeItemUpdate(): never
{
    requireMethod('POST');
    checkOrigin();
    $user = requireUser(['staff', 'admin']);
    $in = body();

    $itemId = filter_var($in['item_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $status = $in['status'] ?? '';
    if (!$itemId) {
        fail(400, 'invalid_item', 'item_id must be a positive number.');
    }
    if (!in_array($status, ['needs_action', 'pending', 'approved'], true)) {
        fail(400, 'invalid_status', 'status must be needs_action, pending or approved.');
    }

    try {
        run('CALL sp_update_clearance_item(?, ?, ?, ?, ?, ?, ?, ?)', [
            $itemId,
            $status,
            optionalStr($in, 'task', 160),
            optionalStr($in, 'remarks', 120),
            optionalStr($in, 'description', 255),
            optionalStr($in, 'next_step', 255),
            optionalStr($in, 'note', 255),
            $user['user_id'],
        ]);
    } catch (PDOException $e) {
        if (($e->errorInfo[0] ?? '') === '45000') {
            $message = $e->errorInfo[2] ?? 'Update rejected.';
            fail(str_contains($message, 'not found') ? 404 : 403, 'update_rejected', $message);
        }
        throw $e;
    }

    ok(one('SELECT item_id, office_code, student_name, status, task, remarks, next_step, updated_at, approved_at
              FROM v_clearance_items WHERE item_id = ?', [$itemId]));
}

/* ------------------------------------------------------------- Dispatch */

$routes = [
    'health'             => 'routeHealth',
    'login'              => 'routeLogin',
    'programs'           => 'routePrograms',
    'apply'              => 'routeApply',
    'application-status' => 'routeApplicationStatus',
    'change-password'    => 'routeChangePassword',
    'applications'       => 'routeApplications',
    'application'        => 'routeApplication',
    'application-photo'  => 'routeApplicationPhoto',
    'review-application' => 'routeReviewApplication',
    'reset-temp-password' => 'routeResetTempPassword',
    'logout'             => 'routeLogout',
    'me'                 => 'routeMe',
    'notifications-read' => 'routeNotificationsRead',
    'forgot'             => 'routeForgot',
    'reset'              => 'routeReset',
    'submit-evidence'    => 'routeSubmitEvidence',
    'submission-file'    => 'routeSubmissionFile',
    'pending-list'       => 'routePendingList',
    'submission'         => 'routeSubmission',
    'review-submission'  => 'routeReviewSubmission',
    'review-history'     => 'routeReviewHistory',
    'messages'           => 'routeMessages',
    'send-message'       => 'routeSendMessage',
    'message-threads'    => 'routeMessageThreads',
    'reports'            => 'routeReports',
    'report-export'      => 'routeReportExport',
    'settings'           => 'routeSettings',
    'save-office'        => 'routeSaveOffice',
    'save-program'       => 'routeSaveProgram',
    'delete-program'     => 'routeDeleteProgram',
    'save-year'          => 'routeSaveYear',
    'set-current-year'   => 'routeSetCurrentYear',
    'open-term'          => 'routeOpenTerm',
    'staff-accounts'     => 'routeStaffAccounts',
    'save-staff'         => 'routeSaveStaff',
    'staff-status'       => 'routeStaffStatus',
    'staff-reset-password' => 'routeStaffResetPassword',
    'audit-log'          => 'routeAuditLog',
    'office-queue'       => 'routeOfficeQueue',
    'item-update'        => 'routeItemUpdate',
    'update-profile'     => 'routeUpdateProfile',
    'upload-avatar'      => 'routeUploadAvatar',
    'remove-avatar'      => 'routeRemoveAvatar',
    'avatar'             => 'routeAvatar',
    'backups'            => 'routeBackups',
    'create-backup'      => 'routeCreateBackup',
    'download-backup'    => 'routeDownloadBackup',
    'deadlines'          => 'routeDeadlines',
    'save-deadline'      => 'routeSaveDeadline',
    'item-deadline'      => 'routeItemDeadline',
    'send-reminder'      => 'routeSendReminder',
    'cancel-reminder'    => 'routeCancelReminder',
];

try {
    $route = (string) ($_GET['route'] ?? '');
    if (!isset($routes[$route])) {
        fail(404, 'unknown_route', 'Unknown route. Try ?route=health');
    }
    startSession();
    if ($route !== 'health') {
        try {
            runScheduler();
        } catch (Throwable $e) {
            error_log('ClearGate reminders: ' . $e->getMessage());
        }
    }
    $routes[$route]();
} catch (ApiError $e) {
    respond($e->status, ['ok' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]]);
} catch (PDOException $e) {
    error_log('ClearGate DB error: ' . $e->getMessage());
    $driverCode = (int) ($e->errorInfo[1] ?? 0);
    if (in_array($driverCode, [1045, 1049, 2002, 2005, 2006, 2013], true) || str_contains($e->getMessage(), 'SQLSTATE[HY000] [')) {
        respond(503, ['ok' => false, 'error' => [
            'code'    => 'database_unavailable',
            'message' => 'The database is not reachable. Is MySQL running and cleargate_db.sql imported?',
        ]]);
    }
    respond(500, ['ok' => false, 'error' => [
        'code'    => 'database_error',
        'message' => 'The database could not complete this (MySQL error ' . $driverCode . '). Details are in XAMPP\'s Apache error log.',
    ]]);
} catch (Throwable $e) {
    error_log('ClearGate error: ' . $e->getMessage());
    respond(500, ['ok' => false, 'error' => ['code' => 'server_error', 'message' => 'Something went wrong.']]);
}
