<?php
/*
 * ClearGate API settings.
 * The defaults match a fresh XAMPP install (user "root", no password).
 * Each value can also be overridden with an environment variable.
 */
return [
    'db_host'     => getenv('CLEARGATE_DB_HOST') ?: '127.0.0.1',
    'db_port'     => (int) (getenv('CLEARGATE_DB_PORT') ?: 3306),
    'db_name'     => getenv('CLEARGATE_DB_NAME') ?: 'cleargate',
    'db_user'     => getenv('CLEARGATE_DB_USER') ?: 'root',
    'db_pass'     => getenv('CLEARGATE_DB_PASS') ?: '',

    // Demo mode: "forgot password" returns the reset token in the response
    // instead of emailing it (XAMPP has no mail server). Set to false before
    // putting this anywhere real, and send the token by email instead.
    'demo_mode'   => (getenv('CLEARGATE_DEMO_MODE') ?: '1') === '1',

    // Where uploaded evidence files are kept, and the largest file accepted.
    // api/uploads has an .htaccess that blocks direct downloads.
    'upload_dir'      => getenv('CLEARGATE_UPLOAD_DIR') ?: __DIR__ . '/uploads',
    'max_upload_mb'   => 5,

    // Sign-in lockout: this many failures within the window blocks further tries.
    'max_failures_per_login' => 5,
    'max_failures_per_ip'    => 20,
    'lockout_minutes'        => 15,

    // Sessions without "Remember me" end after this much inactivity.
    'idle_timeout_minutes'   => 120,
    'remember_days'          => 30,
];
