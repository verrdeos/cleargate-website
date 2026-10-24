/* ClearGate website: interface behaviour + live data from the PHP API (api/index.php). */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  /* ---------- Off-canvas sidebar (< 1024px) ---------- */
  var body = document.body;
  var sidebar = document.getElementById("sidebar");
  var toggle = document.querySelector("[data-nav-toggle]");
  var closers = document.querySelectorAll("[data-nav-close]");
  var desktop = window.matchMedia("(min-width: 1024px)");

  function setNav(open) {
    if (!sidebar || !toggle) return;
    body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      var first = sidebar.querySelector("[data-nav-close], a, button");
      if (first) first.focus();
    }
  }

  if (sidebar && toggle) {
    toggle.addEventListener("click", function () {
      setNav(!body.classList.contains("nav-open"));
    });
    closers.forEach(function (el) {
      el.addEventListener("click", function () {
        setNav(false);
        toggle.focus();
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && body.classList.contains("nav-open")) {
        setNav(false);
        toggle.focus();
      }
    });
    var onChange = function (e) {
      if (e.matches) setNav(false);
    };
    if (desktop.addEventListener) desktop.addEventListener("change", onChange);
    else desktop.addListener(onChange);
  }

  /* ---------- Dropdown menus (<details>): close on outside click / Escape ---------- */
  document.querySelectorAll(".user-menu").forEach(function (menu) {
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    menu.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  });

  /* ---------- Show / hide password ---------- */
  document.querySelectorAll("[data-password-toggle]").forEach(function (btn) {
    var input = document.getElementById(btn.getAttribute("aria-controls"));
    if (!input) return;
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  /* ---------- Confirm-password matching ---------- */
  document.querySelectorAll("[data-match]").forEach(function (input) {
    var other = document.getElementById(input.getAttribute("data-match"));
    if (!other) return;
    var check = function () {
      input.setCustomValidity(
        input.value && input.value !== other.value ? "Passwords do not match." : ""
      );
    };
    input.addEventListener("input", check);
    other.addEventListener("input", check);
  });

  /* ---------- Copy office email ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-copy-email]");
    if (!btn) return;
    var email = btn.getAttribute("data-copy-email");
    var label = btn.querySelector("[data-copy-label]") || btn.lastChild;
    function done(ok) {
      label.textContent = ok ? " Copied " + email : " " + email;
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(email).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  });
})();

/* =========================================================================
   Live data
   ========================================================================= */
(function () {
  "use strict";

  var API = "api/index.php";
  var page = document.body.getAttribute("data-page") || "";
  var main = document.getElementById("main");

  /* ---------- Helpers ---------- */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function ApiError(status, code, message) {
    this.status = status;
    this.code = code;
    this.message = message;
  }

  function api(route, data, query) {
    var url = API + "?route=" + encodeURIComponent(route) + (query || "");
    var opts = { credentials: "same-origin", headers: { Accept: "application/json" } };
    if (data !== undefined) {
      opts.method = "POST";
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(data);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () {
        throw new ApiError(res.status, "bad_response", "The server sent an unexpected reply.");
      }).then(function (json) {
        if (!json.ok) {
          var err = json.error || {};
          throw new ApiError(res.status, err.code || "error", err.message || "Something went wrong.");
        }
        return json.data;
      });
    }, function () {
      throw new ApiError(0, "offline", "Can't reach the ClearGate server.");
    });
  }

  function serverHelp() {
    if (location.protocol === "file:") {
      return "This page was opened as a file. Run install-to-xampp.ps1, start Apache and MySQL in XAMPP, then open http://localhost/cleargate/.";
    }
    return "Make sure Apache and MySQL are running in XAMPP and that database/cleargate_db.sql has been imported.";
  }

  function errorText(err) {
    if (err && (err.code === "offline" || err.code === "bad_response" || err.code === "database_unavailable")) {
      return err.message + " " + serverHelp();
    }
    return (err && err.message) || "Something went wrong.";
  }

  function showPageError(err) {
    if (!main) return;
    main.innerHTML =
      '<div class="card load-error" role="alert">' +
      '<h1 class="card__title">We couldn’t load your clearance</h1>' +
      '<p class="card__text">' + esc(errorText(err)) + "</p>" +
      '<button class="btn btn--primary" type="button" onclick="location.reload()">Try again</button>' +
      "</div>";
  }

  function formError(form, message) {
    var box = $("[data-form-error]", form);
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  function busy(button, on, text) {
    if (!button) return;
    if (on) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.textContent = text || "Please wait…";
    } else if (button.dataset.label) {
      button.disabled = false;
      button.innerHTML = button.dataset.label;
    }
  }

  function fmtDate(value) {
    if (!value) return "";
    var d = new Date(String(value).replace(" ", "T"));
    if (isNaN(d)) return value;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------- Icons ---------- */
  var ICONS = {
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    file: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/><path d="m18 15-2-2"/><path d="m15 18-2-2"/>',
    cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    box: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    external: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    expand: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
  };

  function icon(name, cls) {
    return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.file) + "</svg>";
  }

  var STATUS = {
    needs_action: { label: "Needs action", badge: "badge--orange", dash: "badge--action", dashLabel: "Need Action", tile: "tile--orange", btn: "btn--primary", icon: "alert", order: 0 },
    pending:      { label: "Pending",      badge: "badge--pending", dash: "badge--amber", dashLabel: "Pending",     tile: "tile--amber",  btn: "btn--outline", icon: "clock", order: 1 },
    approved:     { label: "Approved",     badge: "badge--green",  dash: "badge--indigo", dashLabel: "Approved",    tile: "tile--green",  btn: "btn--neutral", icon: "check", order: 2 }
  };

  function statusBadge(status) {
    var s = STATUS[status] || STATUS.pending;
    return '<span class="badge ' + s.badge + '">' + icon(s.icon, "icon--xs") + s.label + "</span>";
  }

  function progress(label, value, max, text) {
    var pct = max ? Math.round((value / max) * 10000) / 100 : 0;
    return '<div class="progress" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="' + max +
      '" aria-valuenow="' + value + '"' + (text ? ' aria-valuetext="' + esc(text) + '"' : "") + '>' +
      '<div class="progress__bar" style="--value: ' + pct + '%"></div></div>';
  }

  /* ---------- Shared shell: user chip, bell, sign out ---------- */
  function fillShell(profile) {
    var name, role;
    if (profile.student) {
      name = profile.student.first_name + " " + profile.student.last_name;
      role = "Student · " + profile.student.student_number;
    } else if (profile.staff) {
      name = profile.staff.full_name;
      role = profile.user.role === "admin" ? "Administrator" : profile.staff.office_name + " staff";
    } else {
      name = profile.user.full_name || (profile.user.role === "admin" ? "System Administrator" : profile.user.email);
      role = profile.user.role === "admin" ? "Administrator" : "Staff";
    }
    var initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
    $all("[data-user-name]").forEach(function (el) { el.textContent = name; });
    $all("[data-user-role]").forEach(function (el) { el.textContent = role; });
    $all("[data-user-initials]").forEach(function (el) {
      if (profile.user.avatar) el.innerHTML = '<img src="' + esc(profile.user.avatar) + '" alt="">';
      else el.textContent = initials;
      el.classList.toggle("has-photo", !!profile.user.avatar);
    });
    $all("[data-user-chip]").forEach(function (el) { el.setAttribute("aria-label", "Account menu for " + name); });
    if (profile.server_now) setServerNow(profile.server_now);
    renderNotifications(profile.notifications || []);
    showAppsNav(profile);
    setMsgBadge(profile.unread_messages || 0);
  }

  function renderNotifications(list) {
    var menu = $("[data-notif]");
    if (!menu) return;
    var unread = list.filter(function (n) { return n.unread; }).length;
    var count = $("[data-notif-count]", menu);
    count.textContent = unread > 9 ? "9+" : String(unread);
    count.hidden = unread === 0;
    $("summary", menu).setAttribute("aria-label", "Notifications" + (unread ? ", " + unread + " unread" : ""));
    var markBtn = $("[data-notif-read]", menu);
    if (markBtn) markBtn.hidden = unread === 0;
    var listEl = $("[data-notif-list]", menu);
    if (!list.length) {
      listEl.innerHTML = '<li class="notif-empty">No notifications yet.</li>';
      return;
    }
    listEl.innerHTML = list.map(function (n) {
      var s = STATUS[n.tone];
      var inner = '<span class="tile tile--sm ' + (s ? s.tile : "tile--indigo") + '">' + icon(notifIcon(n), "icon--sm") + "</span>" +
        '<div><p class="notif__title">' + esc(n.title) + "</p>" +
        '<p class="notif__body">' + esc(n.body) + "</p>" +
        '<p class="notif__time">' + esc(fmtDate(n.created_at)) + "</p></div>";
      var cls = "notif" + (n.unread ? " notif--unread" : "");
      return n.link && /^[a-z-]+\.html(\?[\w=&-]*)?$/.test(n.link)
        ? '<li><a class="' + cls + ' notif--link" href="' + esc(n.link) + '" data-notif-id="' + n.id + '">' + inner + "</a></li>"
        : '<li class="' + cls + '">' + inner + "</li>";
    }).join("");
  }

  function notifIcon(n) {
    var l = n.link || "";
    if (l.indexOf("review.html") === 0) return "upload";
    if (l.indexOf("messages.html") === 0) return "message";
    if (l.indexOf("applications.html") === 0) return "user";
    if (l.indexOf("deadlines.html") === 0) return "clock";
    return n.office_icon || (/deadline|due|overdue/i.test(n.title) ? "clock" : "shield");
  }

  /* Keep the bell (and the Messages count) fresh while the page is open. */
  setInterval(function () {
    if (!currentRole || document.hidden || !$("[data-notif]") || ($("[data-notif]").open)) return;
    api("me").then(function (p) {
      renderNotifications(p.notifications || []);
      setMsgBadge(p.unread_messages || 0);
    }).catch(function () {});
  }, 60000);

  document.addEventListener("click", function (e) {
    var link = e.target.closest && e.target.closest("[data-notif-id]");
    if (link) {
      e.preventDefault();
      var go = function () { location.href = link.getAttribute("href"); };
      api("notifications-read", { id: Number(link.getAttribute("data-notif-id")) }).then(go, go);
      return;
    }
    var read = e.target.closest && e.target.closest("[data-notif-read]");
    if (read) {
      e.preventDefault();
      api("notifications-read", {}).then(function () {
        $all(".notif--unread").forEach(function (el) { el.classList.remove("notif--unread"); });
        var count = $("[data-notif-count]");
        if (count) count.hidden = true;
        read.hidden = true;
      }).catch(function () {});
      return;
    }
    var out = e.target.closest && e.target.closest("[data-logout]");
    if (out) {
      e.preventDefault();
      var target = signInPage();
      api("logout", {}).catch(function () {}).then(function () {
        location.href = target;
      });
    }
  });

  function canManageApps(p) {
    return p.user.role === "admin" || (p.user.role === "staff" && p.staff && p.staff.office_code === "registrar");
  }
  function showAppsNav(p) {
    $all("[data-nav-apps]").forEach(function (li) { li.hidden = !canManageApps(p); });
    showAdminNav(p);
  }

  /* Staff and admins sign in on staff-login.html, students on index.html. */
  var STAFF_PAGES = ["staff", "review", "history", "office-status", "messages", "applications", "reports", "audit", "settings", "staff-accounts", "deadlines"];
  var currentRole = null;
  function signInPage() {
    if (currentRole) return currentRole === "student" ? "index.html" : "staff-login.html";
    return STAFF_PAGES.indexOf(page) !== -1 ? "staff-login.html" : "index.html";
  }

  /* Loads the signed-in profile, or sends the visitor to the sign-in page. */
  function loadProfile(roles) {
    return api("me").then(function (profile) {
      var role = profile.user.role;
      currentRole = role;
      if (profile.user.must_change_password) {
        location.replace("change-password.html");
        return new Promise(function () {});
      }
      if (roles.indexOf(role) === -1) {
        location.replace(role === "student" ? "dashboard.html" : "staff.html");
        return new Promise(function () {});
      }
      fillShell(profile);
      return profile;
    }, function (err) {
      if (err.status === 401) {
        location.replace(signInPage());
        return new Promise(function () {});
      }
      throw err;
    });
  }

  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      return (STATUS[a.status].order - STATUS[b.status].order);
    });
  }

  function studentLine(p, sep) {
    var s = p.student, c = p.clearance;
    var parts = [s.first_name + " " + s.last_name, ordinal(s.year_level) + " Year " + s.program];
    if (c) parts.push("A.Y " + c.academic_year + ", " + c.term);
    return parts.join(sep);
  }

  function noClearance() {
    return '<div class="card load-error"><h2 class="card__title">No clearance opened yet</h2>' +
      '<p class="card__text">Your school hasn’t opened a clearance for you this term. Check back later or contact the Registrar.</p></div>';
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard(p) {
    var c = p.clearance, items = sortItems(p.items);
    var html = '<div class="page-head"><h1 class="page-title page-title--light">Good day, ' + esc(p.student.first_name) + "</h1>" +
      '<span class="pill">' + esc(c ? "A.Y " + c.academic_year + " · " + c.term : "Student clearance portal") + "</span></div>";
    if (!c) { main.innerHTML = html + noClearance(); return; }

    var focus = items.filter(function (i) { return i.status !== "approved"; })[0];
    var alertCard;
    if (c.is_eligible) {
      alertCard = '<section class="card alert-card alert-card--done" aria-labelledby="alert-title">' +
        '<h2 class="alert-card__title" id="alert-title"><span class="alert-dot alert-dot--done" aria-hidden="true">' + icon("check", "icon--sm") + "</span>" +
        "You’re fully cleared</h2>" +
        '<p class="card__text">Every office has signed off. You are eligible to enroll next semester.</p>' +
        '<div class="alert-card__actions"><a class="btn btn--primary btn--lg" href="clearance-status.html">View clearance</a></div></section>';
    } else {
      var verb = focus.status === "needs_action" ? "Action needed" : "Waiting on";
      alertCard = '<section class="card alert-card" aria-labelledby="alert-title">' +
        '<h2 class="alert-card__title" id="alert-title"><span class="alert-dot" aria-hidden="true">' +
        '<svg class="icon icon--sm" viewBox="0 0 24 24" style="stroke-width: 3"><path d="M12 6v7"/><path d="M12 18h.01"/></svg></span>' +
        esc(verb + ": " + focus.office_name) + "</h2>" +
        '<p class="card__text alert-card__task">' + esc(focus.task) + "</p>" +
        '<div class="alert-card__actions">' +
        '<a class="btn btn--primary btn--lg" href="clearance-status.html#office-' + esc(focus.office_code) + '">View Details<span class="visually-hidden"> for ' + esc(focus.office_name) + "</span></a>" +
        '<button class="btn btn--plain" type="button" data-copy-email="' + esc(focus.email) + '">' + icon("phone") +
        "<span data-copy-label>Copy office email</span></button></div></section>";
    }

    html += '<div class="dash-top">' +
      '<section class="card overall" aria-labelledby="overall-title"><div class="card__head">' +
      '<h2 class="card__eyebrow" id="overall-title">Overall Clearance</h2>' +
      '<span class="badge badge--indigo">' + c.approved_count + " of " + c.total_offices + " offices</span></div>" +
      '<p class="overall__value">You’re<br>' + c.percent_complete + "% Done</p>" +
      progress("Overall clearance progress", c.percent_complete, 100) +
      '<p class="overall__meta">' + c.approved_count + " of " + c.total_offices + " offices done</p></section>" +
      alertCard + "</div>";

    var dueItems = items.filter(function (i) { return i.status !== "approved" && i.due_at; })
      .sort(function (a, b) { return parseDt(a.due_at) - parseDt(b.due_at); });
    if (dueItems.length) {
      var first = dueItems[0], late = parseDt(first.due_at) < nowMs();
      html += '<section class="card deadline-card' + (late ? " deadline-card--late" : "") + '" aria-labelledby="deadline-title"><div class="deadline-card__main">' +
        '<p class="card__eyebrow" id="deadline-title">' + icon("clock", "icon--sm") + (late ? "Overdue · " : "Next deadline · ") + esc(first.office_name) + "</p>" +
        '<h2 class="deadline-card__task">' + esc(first.task) + "</h2>" +
        (late ? '<p class="deadline-card__late">' + dueBadge(first.due_at, first.status) + " You can still finish it, so do it as soon as you can.</p>" : countdownHtml(first.due_at)) +
        '<p class="card__text">Due ' + esc(dueDate(first.due_at)) + (first.due_note && !first.due_own ? " · " + esc(first.due_note) : "") + "</p></div>" +
        (dueItems.length > 1 ? '<ul class="deadline-list" role="list">' + dueItems.slice(1).map(function (i) {
          return '<li><a href="clearance-status.html#office-' + esc(i.office_code) + '"><span><strong>' + esc(i.office_name) + "</strong>" + esc(dueDate(i.due_at)) + "</span>" + dueBadge(i.due_at, i.status) + "</a></li>";
        }).join("") + "</ul>" : "") + "</section>";
    }

    html += '<section aria-labelledby="offices-title"><div class="section-head">' +
      '<h2 class="section-title" id="offices-title">Clearance by office</h2>' +
      '<a class="link-accent" href="requirements.html">View all Requirements</a></div>' +
      '<ul class="office-grid" role="list">' +
      items.map(function (i) {
        var s = STATUS[i.status];
        return '<li><a class="card office-card office-card--link" href="clearance-status.html#office-' + esc(i.office_code) + '">' +
          '<span class="badge ' + s.dash + '">' + s.dashLabel + "</span>" +
          '<h3 class="office-card__name">' + esc(i.office_name) + "</h3>" +
          '<p class="office-card__detail">' + esc(i.remarks) + "</p>" +
          (i.due_at && i.status !== "approved" ? '<p class="office-card__due">' + dueBadge(i.due_at, i.status) + "</p>" : "") + "</a></li>";
      }).join("") + "</ul></section>";
    main.innerHTML = html;
  }

  /* ---------- My Requirements ---------- */
  function renderRequirements(p) {
    var c = p.clearance;
    var head = '<div class="page-head"><div><h1 class="page-title">My Requirements</h1>' +
      '<p class="page-subtitle">' + esc(studentLine(p, " - ")) + "</p></div>" +
      '<span class="pill">Student clearance portal</span></div>';
    if (!c) { main.innerHTML = head + noClearance(); return; }

    var q = (new URLSearchParams(location.search).get("q") || "").trim();
    var search = $("#search");
    if (search && q) search.value = q;
    var items = sortItems(p.items);
    if (q) {
      var needle = q.toLowerCase();
      items = items.filter(function (i) {
        return [i.office_name, i.task, i.remarks, i.description, STATUS[i.status].label].join(" ").toLowerCase().indexOf(needle) !== -1;
      });
    }
    var remaining = c.pending_count + c.needs_action_count;

    var list = items.length ? items.map(function (i) {
      var s = STATUS[i.status];
      return '<li class="req-item' + (i.status !== "approved" ? " req-item--attention" : "") + '">' +
        '<span class="tile ' + s.tile + '">' + icon(i.office_icon) + "</span>" +
        '<h3 class="req-item__title">' + esc(i.task) + "</h3>" +
        statusBadge(i.status) +
        '<p class="req-item__desc"><strong>' + esc(i.office_name) + ":</strong> " + esc(i.status === "approved" ? i.description : (i.next_step || i.description)) + evidenceLine(i) +
        (i.status !== "approved" ? dueLine(i.due_at, i.status, i.due_own ? "" : i.due_note) : "") + "</p>" +
        '<div class="req-item__actions">' + uploadButton(i, i.status === "needs_action" ? "btn--primary" : "btn--outline") +
        '<a class="btn ' + (i.status === "approved" ? "btn--neutral" : "btn--plain") + '" href="clearance-status.html#office-' + esc(i.office_code) + '">View Details<span class="visually-hidden"> for ' + esc(i.office_name) + "</span>" + icon("arrow", "icon--sm") + "</a>" + chatButton(i, "btn--plain btn--small-text") + "</div></li>";
    }).join("") : '<li class="req-empty">No requirements match “' + esc(q) + '”. <a class="link-accent" href="requirements.html">Show all</a></li>';

    main.innerHTML = head +
      '<div class="section-head"><div><h2 class="section-title">Requirements to complete</h2>' +
      '<p class="section-text">' + (q ? "Showing results for “" + esc(q) + '”. <a class="link-quiet" href="requirements.html">Clear search</a>' :
        "Focus on the tasks you still need to finish before enrollment opens.") + "</p></div>" +
      '<span class="pill pill--muted">' + (remaining ? plural(remaining, "task", "tasks") + " remaining" : "All tasks done") + "</span></div>" +
      '<div class="split split--req">' +
      '<section class="card card--flush" aria-labelledby="checklist-title"><div class="card__head card__head--padded"><div>' +
      '<h2 class="card__title" id="checklist-title">Requirement checklist</h2>' +
      '<p class="card__text">Outstanding items first, then the offices that have cleared you.</p></div>' +
      '<span class="badge badge--indigo">' + plural(remaining, "task", "tasks") + "</span></div>" +
      '<ul class="checklist" role="list">' + list + "</ul></section>" +
      '<aside aria-label="Completion snapshot"><section class="card snapshot" aria-labelledby="snapshot-title"><div class="card__head">' +
      '<h2 class="card__eyebrow" id="snapshot-title">Completion Snapshot</h2>' +
      '<span class="badge badge--indigo">' + c.approved_count + " of " + c.total_offices + " offices</span></div>" +
      '<p class="snapshot__value">' + c.approved_count + " of " + c.total_offices + "<br>offices cleared</p>" +
      progress("Offices cleared", c.approved_count, c.total_offices, c.approved_count + " of " + c.total_offices + " offices") +
      '<dl class="stat-list">' +
      '<div class="stat-list__row"><dt>Cleared</dt><dd>' + c.approved_count + " of " + c.total_offices + "</dd></div>" +
      '<div class="stat-list__row"><dt>Pending</dt><dd>' + icon("clock", "icon--sm") + c.pending_count + "</dd></div>" +
      '<div class="stat-list__row"><dt>Needs action</dt><dd>' + icon("alert", "icon--sm") + c.needs_action_count + "</dd></div></dl>" +
      '<div class="note"><p class="note__title">' + (c.is_eligible ? "Eligible to enroll" : "Future eligibility") + "</p>" +
      '<p class="note__text">' + (c.is_eligible ? "You’re fully cleared and can enroll next semester." : "Once fully cleared, you can enroll next semester") + "</p></div>" +
      "</section></aside></div>";
  }

  /* ---------- Clearance Status ---------- */
  function renderStatus(p) {
    var c = p.clearance;
    var head = '<div class="page-head"><div><h1 class="page-title">Clearance Status</h1>' +
      '<p class="page-subtitle">' + esc(studentLine(p, " · ")) + "</p></div>" +
      '<span class="pill">Student clearance portal</span></div>';
    if (!c) { main.innerHTML = head + noClearance(); return; }

    var items = sortItems(p.items);
    var outstanding = items.filter(function (i) { return i.status !== "approved"; });
    var n = outstanding.length;

    var rows = items.map(function (i) {
      return '<tr id="office-' + esc(i.office_code) + '"' + (i.status !== "approved" ? ' class="is-attention"' : "") + ">" +
        '<td><span class="office-cell"><span class="tile tile--neutral tile--sm">' + icon(i.office_icon, "icon--sm") + "</span>" + esc(i.office_name) + "</span></td>" +
        "<td>" + statusBadge(i.status) + "</td>" +
        "<td>" + esc(i.remarks) +
        '<span class="cell-sub">' + esc(i.email) + " · " + esc(i.hours) + "</span>" +
        '<span class="cell-sub">' + (i.status === "approved" && i.approved_at ? "Cleared " + esc(fmtDate(i.approved_at)) : "Updated " + esc(fmtDate(i.updated_at))) + "</span>" + evidenceLine(i) +
        (i.status !== "approved" ? dueLine(i.due_at, i.status) : "") +
        '<button class="link-btn" type="button" data-chat="' + i.item_id + '">' + icon("message", "icon--xs") + "Message " + esc(i.office_name) + ((i.messages && i.messages.unread) ? ' <span class="count-pill">' + i.messages.unread + " new</span>" : "") + "</button></td></tr>";
    }).join("");

    var steps = n ? '<ol class="steps" role="list">' + outstanding.map(function (i) {
      var s = STATUS[i.status];
      return '<li class="step"><div class="step__meta"><span>' + esc(i.office_name) + "</span>" + statusBadge(i.status) + "</div>" +
        '<h3 class="step__title">' + esc(i.task) + "</h3>" +
        '<p class="step__text">' + esc(i.next_step || i.description) + "</p>" + evidenceLine(i) + dueLine(i.due_at, i.status, i.due_own ? "" : i.due_note) +
        '<div class="step__actions">' + uploadButton(i, s.btn) +
        chatButton(i) + "</div></li>";
    }).join("") + "</ol>" : '<p class="steps-empty">Nothing left to do. Every office has cleared you.</p>';

    main.innerHTML = head +
      '<section class="card summary" aria-labelledby="summary-title"><div class="summary__main">' +
      '<span class="tile tile--indigo tile--lg">' + icon("shield", "icon--lg") + "</span><div>" +
      '<h2 class="summary__title" id="summary-title">' + c.approved_count + " of " + c.total_offices + " offices approved</h2>" +
      '<p class="card__text">' + (n ? plural(n, "office still needs", "offices still need") + " to clear your account." : "All offices have cleared your account.") + "</p></div></div>" +
      '<ul class="summary__stats" role="list">' +
      '<li><p class="summary__num summary__num--green">' + c.approved_count + '</p><p class="summary__label">Approved ' + (c.approved_count === 1 ? "office" : "offices") + "</p></li>" +
      '<li><p class="summary__num summary__num--amber">' + c.pending_count + '</p><p class="summary__label">Pending ' + (c.pending_count === 1 ? "office" : "offices") + "</p></li>" +
      '<li><p class="summary__num summary__num--orange">' + c.needs_action_count + '</p><p class="summary__label">Needs action</p></li></ul></section>' +
      '<div class="split"><section class="card card--flush" aria-labelledby="overview-title"><div class="card__head card__head--padded"><div>' +
      '<h2 class="card__title" id="overview-title">Office status overview</h2>' +
      '<p class="card__text">All ' + c.total_offices + " offices, with outstanding items first.</p></div>" +
      '<span class="badge badge--muted">' + plural(c.total_offices, "office", "offices") + "</span></div>" +
      '<div class="table-wrap"><table class="status-table" aria-labelledby="overview-title"><thead><tr>' +
      '<th scope="col">Office</th><th scope="col">Status</th><th scope="col">Clearance details</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="card__foot"><span>' + c.approved_count + " approved &middot; " + n + " outstanding</span>" +
      '<a class="link-accent" href="requirements.html">View My Requirements ' + icon("external", "icon--sm") + "</a></div></section>" +
      '<aside class="stack" aria-label="Next steps and eligibility"><section class="card card--flush" aria-labelledby="steps-title">' +
      '<div class="card__head card__head--padded"><div><h2 class="card__title" id="steps-title">Your next steps</h2>' +
      '<p class="card__text">Resolve these to complete clearance.</p></div>' +
      '<span class="badge badge--indigo badge--count" aria-label="' + plural(n, "step", "steps") + '">' + n + "</span></div>" + steps + "</section>" +
      '<section class="card eligibility' + (c.is_eligible ? " eligibility--ok" : "") + '" aria-labelledby="eligibility-title">' +
      '<p class="eligibility__eyebrow">' + icon(c.is_eligible ? "unlock" : "lock", "icon--sm") + "Enrollment eligibility</p>" +
      '<h2 class="eligibility__title" id="eligibility-title">' + (c.is_eligible ? "Eligible to enroll" : "Not yet eligible") + "</h2>" +
      '<p class="eligibility__text">' + (c.is_eligible ? "All " + c.total_offices + " offices have cleared you. You can enroll next semester." :
        "You can enroll next semester only once all " + c.total_offices + " offices have cleared you.") + "</p></section></aside></div>";

    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) {
        target.classList.add("is-target");
        target.scrollIntoView({ block: "center" });
      }
    }
  }

  /* ---------- Staff: office queue ---------- */
  var staffState = { profile: null, rows: [], status: "", office: "", q: "" };

  function renderStaffShell(p) {
    var isAdmin = p.user.role === "admin";
    var sub = p.staff ? p.staff.full_name + (p.staff.position ? " · " + p.staff.position : "") + " · " + p.staff.office_name :
      "Administrator · all offices";
    var officeFilter = isAdmin ? '<label class="filter"><span class="filter__label">Office</span><select class="filter__control" data-filter-office>' +
      '<option value="">All offices</option>' + (p.offices || []).map(function (o) {
        return '<option value="' + esc(o.code) + '">' + esc(o.name) + "</option>";
      }).join("") + "</select></label>" : "";

    main.innerHTML = '<div class="page-head"><div><h1 class="page-title">Clearance Status</h1>' +
      '<p class="page-subtitle">' + esc(sub) + "</p></div>" +
      '<span class="pill">' + (isAdmin ? "Admin portal" : "Office staff portal") + "</span></div>" +
      '<section class="card summary" aria-label="Queue summary" data-queue-summary></section>' +
      '<section class="card card--flush" aria-labelledby="queue-title"><div class="card__head card__head--padded queue-head"><div>' +
      '<h2 class="card__title" id="queue-title">Student clearances this term</h2>' +
      '<p class="card__text">' + (isAdmin ? "Every office’s sign-offs. Pick an office to narrow the list." : "Sign-offs for your office. Update a student when their requirement changes.") + "</p></div>" +
      '<div class="filters">' + officeFilter +
      '<label class="filter"><span class="filter__label">Status</span><select class="filter__control" data-filter-status>' +
      '<option value="">All statuses</option><option value="needs_action">Needs action</option><option value="pending">Pending</option><option value="approved">Approved</option>' +
      "</select></label></div></div>" +
      '<div class="table-wrap"><table class="status-table queue-table" aria-labelledby="queue-title"><thead><tr>' +
      '<th scope="col">Student</th>' + (isAdmin ? '<th scope="col">Office</th>' : "") +
      '<th scope="col">Status</th><th scope="col">Requirement</th><th scope="col">Updated</th><th scope="col"><span class="visually-hidden">Actions</span></th>' +
      "</tr></thead><tbody data-queue-rows></tbody></table></div>" +
      '<div class="card__foot"><span data-queue-count></span></div></section>';

    var st = $("[data-filter-status]"), of = $("[data-filter-office]");
    st.addEventListener("change", function () { staffState.status = st.value; drawQueue(); });
    if (of) of.addEventListener("change", function () { staffState.office = of.value; loadQueue(); });
  }

  function loadQueue() {
    var tbody = $("[data-queue-rows]");
    var cols = staffState.profile.user.role === "admin" ? 6 : 5;
    tbody.innerHTML = '<tr><td colspan="' + cols + '">Loading…</td></tr>';
    var query = (staffState.office ? "&office=" + encodeURIComponent(staffState.office) : "");
    // Load every status so the summary counts stay complete, then filter here.
    api("office-queue", undefined, query).then(function (rows) {
      staffState.rows = rows;
      drawQueue();
    }, function (err) {
      tbody.innerHTML = '<tr><td colspan="' + cols + '">' + esc(errorText(err)) + "</td></tr>";
    });
  }

  function drawQueue() {
    var isAdmin = staffState.profile.user.role === "admin";
    var rows = staffState.rows;
    var counts = { needs_action: 0, pending: 0, approved: 0 };
    rows.forEach(function (r) { counts[r.status]++; });

    $("[data-queue-summary]").innerHTML = '<div class="summary__main"><span class="tile tile--indigo tile--lg">' + icon("shield", "icon--lg") + "</span><div>" +
      '<h2 class="summary__title">' + counts.approved + " of " + rows.length + " sign-offs approved</h2>" +
      '<p class="card__text">' + (rows[0] ? "A.Y " + esc(rows[0].academic_year) + " · " + esc(rows[0].term) : "No clearances opened this term yet.") + "</p></div></div>" +
      '<ul class="summary__stats" role="list">' +
      '<li><p class="summary__num summary__num--green">' + counts.approved + '</p><p class="summary__label">Approved</p></li>' +
      '<li><p class="summary__num summary__num--amber">' + counts.pending + '</p><p class="summary__label">Pending</p></li>' +
      '<li><p class="summary__num summary__num--orange">' + counts.needs_action + '</p><p class="summary__label">Needs action</p></li></ul>';

    var q = staffState.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (staffState.status && r.status !== staffState.status) return false;
      if (q && [r.student_name, r.student_number, r.office_name, r.task, r.remarks].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    var cols = isAdmin ? 6 : 5;
    $("[data-queue-rows]").innerHTML = shown.length ? shown.map(function (r) {
      return "<tr" + (r.status !== "approved" ? ' class="is-attention"' : "") + ">" +
        '<td><span class="student-cell"><strong>' + esc(r.student_name) + "</strong><span>" + esc(r.student_number) + "</span></span></td>" +
        (isAdmin ? "<td>" + esc(r.office_name) + "</td>" : "") +
        "<td>" + statusBadge(r.status) + "</td>" +
        "<td>" + esc(r.task) + '<span class="cell-sub">' + esc(r.remarks) + "</span>" +
        (r.due_at && r.status !== "approved" ? dueLine(r.due_at, r.status, r.own_due_at ? "Own deadline" : "") : "") + "</td>" +
        '<td class="nowrap">' + esc(fmtDate(r.updated_at)) + "</td>" +
        '<td class="nowrap"><button class="btn btn--outline btn--sm" type="button" data-edit-item="' + r.item_id + '">Update<span class="visually-hidden"> ' + esc(r.student_name) + "</span></button> " +
        '<button class="btn btn--plain btn--sm" type="button" data-chat="' + r.item_id + '" aria-label="Message ' + esc(r.student_name) + '" title="Message">' + icon("message", "icon--sm") + "</button>" +
        '<button class="btn btn--plain btn--sm" type="button" data-q-deadline="' + r.item_id + '" aria-label="Deadline for ' + esc(r.student_name) + '" title="Deadline">' + icon("clock", "icon--sm") + "</button>" +
        (r.status !== "approved" ? '<button class="btn btn--plain btn--sm" type="button" data-q-remind="' + r.item_id + '" aria-label="Remind ' + esc(r.student_name) + '" title="Send a reminder">' + icon("bell", "icon--sm") + "</button>" : "") + "</td></tr>";
    }).join("") : '<tr><td colspan="' + cols + '">No students match these filters.</td></tr>';

    $("[data-queue-count]").textContent = "Showing " + shown.length + " of " + plural(rows.length, "sign-off", "sign-offs");
    function rowById(id) { return rows.filter(function (r) { return String(r.item_id) === String(id); })[0]; }
    $all("[data-q-deadline]").forEach(function (b) { b.addEventListener("click", function () { studentDeadlineDialog(rowById(b.getAttribute("data-q-deadline")), loadQueue); }); });
    $all("[data-q-remind]").forEach(function (b) { b.addEventListener("click", function () { reminderDialog({ profile: staffState.profile, item: rowById(b.getAttribute("data-q-remind")) }, loadQueue); }); });
  }

  function openEditor(itemId) {
    var row = staffState.rows.filter(function (r) { return String(r.item_id) === String(itemId); })[0];
    var dialog = $("[data-item-dialog]");
    if (!row || !dialog) return;
    var form = $("form", dialog);
    form.reset();
    formError(form, "");
    $("[data-dialog-title]", dialog).textContent = row.student_name + " · " + row.office_name;
    $("[data-dialog-sub]", dialog).textContent = row.student_number + " · A.Y " + row.academic_year + ", " + row.term;
    form.elements.item_id.value = row.item_id;
    form.elements.status.value = row.status;
    form.elements.task.value = row.task || "";
    form.elements.remarks.value = row.remarks || "";
    form.elements.description.value = row.description || "";
    form.elements.next_step.value = row.next_step || "";
    syncNextStep(form);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    form.elements.status.focus();
  }

  function syncNextStep(form) {
    var approved = form.elements.status.value === "approved";
    form.elements.next_step.disabled = approved;
    form.elements.next_step.placeholder = approved ? "Not needed once approved" : "What the student should do next";
  }

  function setupEditor() {
    var dialog = $("[data-item-dialog]");
    if (!dialog) return;
    var form = $("form", dialog);
    function close() { if (dialog.close) dialog.close(); else dialog.removeAttribute("open"); }

    document.addEventListener("click", function (e) {
      var edit = e.target.closest && e.target.closest("[data-edit-item]");
      if (edit) openEditor(edit.getAttribute("data-edit-item"));
    });
    $all("[data-dialog-close]", dialog).forEach(function (b) { b.addEventListener("click", close); });
    form.elements.status.addEventListener("change", function () { syncNextStep(form); });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var el = form.elements;
      var submit = $("[type=submit]", form);
      var payload = {
        item_id: Number(el.item_id.value),
        status: el.status.value,
        task: el.task.value.trim(),
        remarks: el.remarks.value.trim(),
        description: el.description.value.trim(),
        next_step: el.status.value === "approved" ? null : (el.next_step.value.trim() || null),
        note: el.note.value.trim() || null
      };
      busy(submit, true, "Saving…");
      formError(form, "");
      api("item-update", payload).then(function (updated) {
        busy(submit, false);
        close();
        toast(updated.student_name + " updated to " + STATUS[updated.status].label.toLowerCase() + ". The student has been notified.");
        loadQueue();
      }, function (err) {
        busy(submit, false);
        formError(form, errorText(err));
      });
    });
  }

  function toast(message) {
    var el = $("[data-toast]");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.hidden = true; }, 5000);
  }

  /* ---------- Sign-in & password pages ---------- */
  function setupLogin() {
    var form = $("[data-login-form]");
    if (location.protocol === "file:") formError(form, serverHelp());
    try { sessionStorage.setItem("cg_portal", form.getAttribute("data-portal") || "student"); } catch (err) {}
    var params = new URLSearchParams(location.search);
    var info = $("[data-form-info]", form);
    if (info && params.get("reset") === "1") {
      info.textContent = "Your password has been reset. Sign in with your new password.";
      info.hidden = false;
    }
    if (params.get("login")) form.elements.student_id.value = params.get("login");
    if (params.has("reset") || params.has("login")) history.replaceState(null, "", location.pathname);
    // Already signed in? Skip the form.
    api("me").then(function (p) {
      location.replace(p.user.role === "student" ? "dashboard.html" : "staff.html");
    }, function () {});

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var submit = $("[type=submit]", form);
      busy(submit, true, "Signing in…");
      formError(form, "");
      api("login", {
        login: form.elements.student_id.value.trim(),
        password: form.elements.password.value,
        remember: form.elements.remember.checked,
        portal: form.getAttribute("data-portal") || ""
      }).then(function (p) {
        if (p.user.must_change_password) { location.href = "change-password.html"; return; }
        location.href = p.user.role === "student" ? "dashboard.html" : "staff.html";
      }, function (err) {
        busy(submit, false);
        formError(form, errorText(err));
        form.elements.password.value = "";
        form.elements.password.focus();
      });
    });
  }

  function portalSignIn() {
    var portal = new URLSearchParams(location.search).get("portal");
    try {
      if (portal) sessionStorage.setItem("cg_portal", portal);
      else portal = sessionStorage.getItem("cg_portal");
    } catch (err) {}
    var href = portal === "staff" ? "staff-login.html" : "index.html";
    $all("[data-signin-link]").forEach(function (a) { a.setAttribute("href", href); });
    return href;
  }

  function setupForgot() {
    portalSignIn();
    var form = $("[data-forgot-form]");
    var send = $("[data-send-code]", form);
    var info = $("[data-form-info]", form);

    send.addEventListener("click", function () {
      var email = form.elements.email;
      if (!email.checkValidity()) { email.reportValidity(); return; }
      busy(send, true, "Sending…");
      formError(form, "");
      api("forgot", { email: email.value.trim() }).then(function (data) {
        busy(send, false);
        send.textContent = "Send a new code";
        info.hidden = false;
        if (data.demo_token) {
          form.elements.code.value = data.demo_token;
          info.textContent = "Demo mode: the school has no mail server, so your code was filled in for you. It works once and expires in 30 minutes.";
        } else {
          info.textContent = data.message + " The code works once and expires in 30 minutes.";
        }
        form.elements.code.focus();
      }, function (err) {
        busy(send, false);
        formError(form, errorText(err));
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      try { sessionStorage.setItem("cg_reset_token", form.elements.code.value.trim()); } catch (err) {}
      location.href = "reset-password.html#token=" + encodeURIComponent(form.elements.code.value.trim());
    });
  }

  function setupReset() {
    portalSignIn();
    var form = $("[data-reset-form]");
    var token = "";
    var m = location.hash.match(/token=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]);
    if (!token) { try { token = sessionStorage.getItem("cg_reset_token") || ""; } catch (err) {} }
    if (m) history.replaceState(null, "", location.pathname);
    if (!token) formError(form, "Your reset code is missing. Go back and request a new code.");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!token) return;
      var submit = $("[type=submit]", form);
      busy(submit, true, "Saving…");
      formError(form, "");
      api("reset", { token: token, password: form.elements.new_password.value }).then(function () {
        try { sessionStorage.removeItem("cg_reset_token"); } catch (err) {}
        location.replace(portalSignIn() + "?reset=1");
      }, function (err) {
        busy(submit, false);
        formError(form, errorText(err));
      });
    });
  }



  /* ---------- My Profile (students, staff and admins) ---------- */
  function details(rows) {
    return '<dl class="detail-list">' + rows.filter(function (r) { return r[1] !== null && r[1] !== undefined && r[1] !== ""; }).map(function (r) {
      return '<div class="detail-list__row"><dt>' + esc(r[0]) + "</dt><dd>" + (r[2] ? r[1] : esc(r[1])) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function renderProfile(p) {
    var role = p.user.role;
    var isStudent = role === "student";
    $all("[data-role]").forEach(function (el) {
      var want = el.getAttribute("data-role");
      el.hidden = want === "student" ? !isStudent : isStudent;
    });
    showAppsNav(p);
    var portal = $("[data-portal-name]");
    if (portal) portal.textContent = isStudent ? "Student Portal" : "Staff Portal";
    var home = $("[data-home-link]");
    if (home) home.setAttribute("href", isStudent ? "dashboard.html" : "staff.html");

    var name, roleLabel;
    if (isStudent) {
      name = p.student.first_name + " " + p.student.last_name;
      roleLabel = "Student";
    } else if (p.staff) {
      name = p.staff.full_name;
      roleLabel = role === "admin" ? "Administrator" : "Office staff";
    } else {
      name = p.user.full_name || (role === "admin" ? "System Administrator" : p.user.email);
      roleLabel = role === "admin" ? "Administrator" : "Office staff";
    }
    var initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("");

    var head = '<div class="page-head"><div><h1 class="page-title">My Profile</h1>' +
      '<p class="page-subtitle">Your account and ' + (isStudent ? "student" : "office") + " details</p></div>" +
      '<span class="pill">' + esc(roleLabel) + "</span></div>";

    var hasPhoto = isStudent && p.student && p.student.details && p.student.details.has_photo;
    var avatarSrc = p.user.avatar || (hasPhoto ? API + "?route=application-photo&mine=1" : "");
    var identity = '<section class="card profile-card" aria-label="Profile summary">' +
      '<div class="avatar-edit">' +
      (avatarSrc ? '<img class="profile-avatar profile-avatar--photo" src="' + esc(avatarSrc) + '" alt="Your profile picture" data-avatar-img>' :
        '<span class="profile-avatar" aria-hidden="true" data-avatar-img>' + esc(initials) + "</span>") +
      '<label class="avatar-edit__btn" title="Change picture"><span class="visually-hidden">Change profile picture</span>' + icon("camera", "icon--sm") +
      '<input type="file" accept="image/jpeg,image/png,image/webp" data-avatar-input hidden></label></div>' +
      '<div class="profile-card__text"><h2 class="profile-card__name">' + esc(name) + "</h2>" +
      '<p class="card__text">' + esc(p.user.email) + "</p>" +
      '<p class="avatar-actions"><button class="link-accent" type="button" data-avatar-pick>' + (p.user.avatar ? "Change picture" : "Upload a picture") + "</button>" +
      (p.user.avatar ? '<button class="link-quiet link-quiet--dark" type="button" data-avatar-remove>Remove</button>' : "") +
      '<span class="avatar-hint">JPG, PNG or WEBP, up to 2 MB. It’s cropped to a square.</span></p></div>' +
      '<span class="badge badge--indigo">' + esc(roleLabel) + "</span></section>";

    var left, right;
    if (isStudent) {
      var st = p.student, c = p.clearance;
      var dt = st.details || {};
      var ct = st.contact || {};
      left = '<section class="card" aria-labelledby="info-title"><div class="card__head"><h2 class="card__title" id="info-title">Student information</h2>' +
        '<button class="btn btn--outline btn--sm" type="button" data-edit-profile>Edit details</button></div>' +
        details([
          ["Full name", name],
          ["Student ID", st.student_number],
          ["School email", p.user.email],
          ["Program", st.program + " \u2013 " + st.program_name],
          ["Year level", ordinal(st.year_level) + " Year"],
          ["Admission", dt.admission_type],
          ["Personal email", ct.personal_email || p.user.personal_email || dt.personal_email || "Not set"],
          ["Mobile number", ct.phone || "Not set"],
          ["Birthday", dt.birthday],
          ["Sex", dt.sex],
          ["Civil status", dt.civil_status],
          ["Current address", ct.current_address || "Not set"],
          ["Emergency contact", ct.emergency_name ? ct.emergency_name + (ct.emergency_contact ? " · " + ct.emergency_contact : "") : "Not set"],
          ["Application", dt.reference]
        ]) + "</section>";
      right = '<section class="card" aria-labelledby="clr-title"><h2 class="card__title" id="clr-title">Clearance this term</h2>' +
        (c ? details([
          ["Academic year", c.academic_year],
          ["Term", c.term],
          ["Offices cleared", c.approved_count + " of " + c.total_offices + " (" + c.percent_complete + "%)"],
          ["Pending", String(c.pending_count)],
          ["Needs action", String(c.needs_action_count)],
          ["Enrollment", c.is_eligible ? '<span class="badge badge--green">' + icon("check", "icon--xs") + "Eligible</span>" :
            '<span class="badge badge--pending">' + icon("clock", "icon--xs") + "Not yet eligible</span>", true]
        ]) + '<a class="btn btn--outline profile-link" href="clearance-status.html">View clearance status ' + icon("arrow", "icon--sm") + "</a>" :
          '<p class="card__text">No clearance has been opened for you this term yet.</p>') + "</section>";
    } else {
      var sf = p.staff;
      left = '<section class="card" aria-labelledby="info-title"><div class="card__head"><h2 class="card__title" id="info-title">' + (role === "admin" ? "Administrator" : "Staff") + " information</h2>" +
        '<button class="btn btn--outline btn--sm" type="button" data-edit-profile>Edit details</button></div>' +
        details([
          ["Full name", sf ? sf.full_name : (p.user.full_name || "System Administrator")],
          ["Position", sf ? (sf.position || "Not set") : "System administrator"],
          ["Mobile number", p.user.phone || "Not set"],
          ["Role", roleLabel],
          ["Access", role === "admin" ? "Can view and update every office" : "Can view and update " + (sf ? sf.office_name : "their office") + " only"]
        ]) + "</section>";
      right = '<section class="card" aria-labelledby="office-title"><h2 class="card__title" id="office-title">Office</h2>' +
        (sf ? details([
          ["Office", sf.office_name],
          ["Office email", sf.office_email],
          ["Office hours", sf.office_hours]
        ]) : details([["Offices", "All offices"]])) +
        '<a class="btn btn--outline profile-link" href="staff.html">Open pending list ' + icon("arrow", "icon--sm") + "</a></section>";
    }

    var account = '<section class="card" aria-labelledby="acct-title"><h2 class="card__title" id="acct-title">Account</h2>' +
      details([
        ["Sign-in email", p.user.email],
        ["Account type", roleLabel],
        ["Member since", fmtDate(p.user.created_at)],
        ["Last sign-in", fmtDate(p.user.last_login_at)]
      ]) +
      '<a class="btn btn--outline profile-link" href="change-password.html">' + icon("lock", "icon--sm") + "Change password</a>" +
      '<p class="card__text profile-note">Your sign-in email can only be changed by ' + (isStudent ? "the Registrar" : "an administrator") + ".</p></section>";

    main.innerHTML = head + identity + '<div class="profile-grid">' + left + right + account + "</div>";
    setupProfileEditing(p, name);
  }

  /* Center-crops a picture to a square and shrinks it, so uploads stay small. */
  function squareImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var side = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(512, side);
        var c = document.createElement("canvas");
        c.width = c.height = out;
        c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error("crop")); }, "image/jpeg", 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("read")); };
      img.src = url;
    });
  }

  function setupProfileEditing(p, name) {
    ensureToast();
    var isStudent = p.user.role === "student";
    var fileInput = $("[data-avatar-input]");
    function reload() { return api("me").then(function (np) { fillShell(np); renderProfile(np); }); }
    $all("[data-avatar-pick]").forEach(function (b) { b.addEventListener("click", function () { fileInput.click(); }); });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("Choose a JPG, PNG or WEBP picture."); return; }
      if (file.size > 15 * 1024 * 1024) { toast("That picture is too large."); return; }
      toast("Uploading your picture…");
      squareImage(file).catch(function () { return file; }).then(function (blob) {
        var fd = new FormData();
        fd.append("avatar", blob, "avatar.jpg");
        return fetch(API + "?route=upload-avatar", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-ClearGate": "1", Accept: "application/json" } })
          .then(function (res) { return res.json(); });
      }).then(function (json) {
        if (!json.ok) throw new ApiError(400, json.error.code, json.error.message);
        toast("Profile picture updated.");
        return reload();
      }).catch(function (err) { toast(errorText(err)); });
    });
    var remove = $("[data-avatar-remove]");
    if (remove) remove.addEventListener("click", function () {
      formDialog({ title: "Remove your profile picture?", sub: "Your initials will show instead.", fields: "", submit: "Remove picture", danger: true,
        onSubmit: function () { return api("remove-avatar", {}).then(function () { toast("Picture removed."); return reload(); }); } });
    });

    $("[data-edit-profile]").addEventListener("click", function () {
      var fields;
      if (isStudent) {
        var ct = p.student.contact || {};
        fields = '<p class="form-info-note">Your name, student ID, program and year level come from the Registrar. Ask them if any of those are wrong.</p>' +
          '<div class="form-grid">' + field("Personal email", inputHtml("personal_email", ct.personal_email || "", 'type="email" maxlength="190" placeholder="you@gmail.com"'), "Used for Forgot password.") +
          field("Mobile number", inputHtml("phone", ct.phone || "", 'type="tel" maxlength="20" placeholder="0917 123 4567"')) + "</div>" +
          field("Current address", inputHtml("current_address", ct.current_address || "", 'maxlength="255" placeholder="House no., street, barangay, city"')) +
          '<div class="form-grid">' + field("Emergency contact person", inputHtml("emergency_name", ct.emergency_name || "", 'maxlength="120"')) +
          field("Their number", inputHtml("emergency_contact", ct.emergency_contact || "", 'type="tel" maxlength="20"')) + "</div>";
      } else {
        fields = field("Full name", inputHtml("full_name", name, 'required maxlength="120"')) +
          (p.staff ? field("Position", inputHtml("position", p.staff.position || "", 'maxlength="80" placeholder="e.g. Head Librarian"')) : "") +
          field("Mobile number", inputHtml("phone", p.user.phone || "", 'type="tel" maxlength="20" placeholder="0917 123 4567"'));
      }
      formDialog({
        title: "Edit your details", sub: isStudent ? "Keep your contact details up to date so offices can reach you." : "Your name shows in reviews, messages and the audit log.",
        fields: fields, submit: "Save changes",
        onSubmit: function (f) {
          var el = f.elements, data;
          if (isStudent) {
            data = { personal_email: el.personal_email.value.trim(), phone: el.phone.value.trim(), current_address: el.current_address.value.trim(),
              emergency_name: el.emergency_name.value.trim(), emergency_contact: el.emergency_contact.value.trim() };
          } else {
            data = { full_name: el.full_name.value.trim(), phone: el.phone.value.trim() };
            if (el.position) data.position = el.position.value.trim();
          }
          return api("update-profile", data).then(function (np) { fillShell(np); renderProfile(np); toast("Your details were saved."); });
        }
      });
    });
  }

  /* =======================================================================
     Evidence: shared helpers
     ======================================================================= */
  var CHECKLISTS = {
    library: ["Student ID matches the submission", "All borrowed books are returned", "No unpaid library fines", "Return slip is verified in the ledger"],
    accounting: ["Student ID matches the submission", "Receipt amount matches the balance", "OR number is verified in cashier records", "No remaining balance"],
    registrar: ["Student ID matches the submission", "Required forms are complete", "Documents are signed and readable", "Details match the registrar file"],
    guidance: ["Student ID matches the submission", "Exit interview form is complete", "No open guidance referral", "Counselor signature is present"],
    dean: ["Student ID matches the submission", "No incomplete grades", "No pending disciplinary case", "Dean's office signature is present"],
    property: ["Student ID matches the submission", "All borrowed equipment is returned", "No damage or liability recorded", "Custodian acknowledgment is attached"]
  };
  var RETURN_REASONS = [
    "Incomplete or unverified evidence",
    "Wrong document uploaded",
    "File is unreadable or cut off",
    "Details don't match office records",
    "Outstanding balance or liability",
    "Other"
  ];

  function fileUrl(id, download) {
    return API + "?route=submission-file&id=" + encodeURIComponent(id) + (download ? "&download=1" : "");
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function fileKind(mime) {
    return mime === "application/pdf" ? "PDF" : (mime || "").replace("image/", "").toUpperCase();
  }

  function shortDate(value) {
    if (!value) return "";
    var d = new Date(String(value).replace(" ", "T"));
    if (isNaN(d)) return value;
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + " · " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function initialsOf(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  }

  var SUB_BADGE = {
    submitted: '<span class="badge badge--pending">Pending review</span>',
    resubmitted: '<span class="badge badge--violet">Resubmitted</span>',
    approved: '<span class="badge badge--green">' + "Approved</span>",
    returned: '<span class="badge badge--orange">Returned</span>',
    replaced: '<span class="badge badge--muted">Replaced</span>'
  };

  function subBadge(status, resubmitted) {
    if (status === "submitted" && resubmitted) return SUB_BADGE.resubmitted;
    return SUB_BADGE[status] || "";
  }

  function staffContext(p) {
    var admin = p.user.role === "admin";
    return {
      admin: admin,
      officeName: admin ? "All offices" : (p.staff ? p.staff.office_name : "Office"),
      officeCode: admin ? "" : (p.staff ? p.staff.office_code : ""),
      crumb: (admin ? "Admin workspace / All offices" : "Staff workspace / " + (p.staff ? p.staff.office_name : "") + " Office"),
      pill: admin ? "Admin clearance portal" : "Staff clearance portal",
      reviewer: p.staff ? p.staff.full_name : (p.user.full_name || "System Administrator")
    };
  }

  function staffHead(ctx, title, sub) {
    return '<p class="crumb">' + esc(ctx.crumb.replace("Office Office", "Office")) + "</p>" +
      '<div class="page-head page-head--tight"><div><h1 class="page-title">' + esc(title) + "</h1>" +
      (sub ? '<p class="page-subtitle">' + esc(sub) + "</p>" : "") + "</div>" +
      '<span class="pill">' + esc(ctx.pill) + "</span></div>";
  }

  function staffFoot(termText) {
    return '<footer class="staff-foot"><span>' + esc(termText || "") + "</span><span>ClearGate staff workspace · Confidential student records</span></footer>";
  }

  function topSearch(onInput) {
    var form = $("form.search");
    if (!form) return;
    var input = $("input", form);
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    input.addEventListener("input", function () { onInput(input.value.trim()); });
  }

  function officeSelect(p, current) {
    if (p.user.role !== "admin") return "";
    return '<label class="filter filter--inline"><span class="visually-hidden">Office</span><select class="filter__control" data-office-select>' +
      '<option value="">All offices</option>' + (p.offices || []).map(function (o) {
        return '<option value="' + esc(o.code) + '"' + (o.code === current ? " selected" : "") + ">" + esc(o.name) + "</option>";
      }).join("") + "</select></label>";
  }

  /* =======================================================================
     Staff: Pending List
     ======================================================================= */
  var pending = { profile: null, data: null, q: "", only: "all", sort: "newest", page: 1, office: "" };
  var PAGE_SIZE = 8;

  function loadPending() {
    var q = pending.office ? "&office=" + encodeURIComponent(pending.office) : "";
    return api("pending-list", undefined, q).then(function (data) {
      pending.data = data;
      drawPending();
    }).catch(showPageError);
  }

  function drawPending() {
    var p = pending.profile, d = pending.data, ctx = staffContext(p);
    var rows = d.rows.slice();
    var resub = rows.filter(function (r) { return r.resubmitted; }).length;
    var officeLabel = pending.office ? (p.offices || []).filter(function (o) { return o.code === pending.office; }).map(function (o) { return o.name; })[0] : ctx.officeName;
    var termText = (d.term ? d.term : "") + (d.academic_year ? ", AY " + d.academic_year : "");

    var q = pending.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (pending.only === "resubmitted" && !r.resubmitted) return false;
      if (q && [r.student_name, r.student_number, r.file_name, r.reference, r.office_name, r.task].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    shown.sort(function (a, b) { return pending.sort === "oldest" ? (a.submitted_at > b.submitted_at ? 1 : -1) : (a.submitted_at < b.submitted_at ? 1 : -1); });
    var pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    if (pending.page > pages) pending.page = pages;
    var start = (pending.page - 1) * PAGE_SIZE;
    var pageRows = shown.slice(start, start + PAGE_SIZE);

    var body = pageRows.length ? pageRows.map(function (r) {
      return "<tr>" +
        '<td><span class="student-cell"><strong>' + esc(r.student_name) + "</strong><span>" + esc(r.student_number + " · " + r.program + " · " + ordinal(r.year_level) + " year") + "</span></span></td>" +
        "<td>" + esc(r.file_name) + '<span class="cell-sub">' + esc((ctx.admin ? r.office_name + " · " : "") + r.reference) + "</span></td>" +
        '<td class="nowrap">' + esc(shortDate(r.submitted_at)) + "</td>" +
        "<td>" + subBadge("submitted", r.resubmitted) + "</td>" +
        '<td><a class="link-accent link-arrow" href="review.html?id=' + r.id + '">Review item ' + icon("arrow", "icon--sm") + "</a></td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-cell">' +
      (rows.length ? "No submissions match your search." : "Nothing to review right now. New uploads from students will appear here.") + "</td></tr>";

    var pager = "";
    if (shown.length) {
      pager = '<div class="pager"><span>Showing ' + (start + 1) + "–" + (start + pageRows.length) + " of " + plural(shown.length, "pending submission", "pending submissions") + "</span>" +
        '<div class="pager__nav"><button type="button" class="pager__btn" data-page-go="' + (pending.page - 1) + '"' + (pending.page === 1 ? " disabled" : "") + ">Previous</button>";
      for (var i = 1; i <= pages; i++) {
        pager += '<button type="button" class="pager__btn pager__num' + (i === pending.page ? " is-current" : "") + '" data-page-go="' + i + '"' + (i === pending.page ? ' aria-current="page"' : "") + ">" + i + "</button>";
      }
      pager += '<button type="button" class="pager__btn" data-page-go="' + (pending.page + 1) + '"' + (pending.page === pages ? " disabled" : "") + ">Next " + icon("arrow", "icon--xs") + "</button></div></div>";
    }

    main.innerHTML = staffHead(ctx, "Pending List") +
      '<div class="stat-cards">' +
      '<section class="card stat-card stat-card--wide"><p class="stat-card__label">Pending review</p><p class="stat-card__num">' + rows.length + '</p><p class="stat-card__meta">' + d.submitted_today + " submitted today</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Approved today</p><p class="stat-card__num">' + d.approved_today + '</p><p class="stat-card__meta">' + esc(officeLabel === "All offices" ? "Requirements cleared, all offices" : officeLabel + " requirements cleared") + "</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Returned today</p><p class="stat-card__num">' + d.returned_today + '</p><p class="stat-card__meta">Awaiting student corrections</p></section></div>' +
      '<section class="card card--flush" aria-labelledby="subs-title"><div class="card__head card__head--padded"><div>' +
      '<h2 class="card__title" id="subs-title">Submissions to review</h2>' +
      '<p class="card__text">' + esc(officeLabel + " clearance" + (termText ? " · " + termText : "")) + "</p></div></div>" +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Find a student or submission</span>' +
      '<input type="search" placeholder="Find a student or submission" value="' + esc(pending.q) + '" data-table-search></label>' +
      '<button type="button" class="chip' + (pending.only === "all" ? " is-on" : "") + '" data-only="all">All pending · ' + rows.length + "</button>" +
      '<button type="button" class="chip' + (pending.only === "resubmitted" ? " is-on" : "") + '" data-only="resubmitted">Resubmitted · ' + resub + "</button>" +
      officeSelect(p, pending.office) +
      '<label class="sort"><span class="visually-hidden">Sort</span><select data-sort><option value="newest"' + (pending.sort === "newest" ? " selected" : "") + '>Newest first</option><option value="oldest"' + (pending.sort === "oldest" ? " selected" : "") + ">Oldest first</option></select></label></div>" +
      '<div class="table-wrap"><table class="status-table staff-table"><thead><tr><th scope="col">Student</th><th scope="col">Evidence</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>' + body + "</tbody></table></div>" +
      pager + "</section>" + staffFoot(termText);

    var search = $("[data-table-search]");
    search.addEventListener("input", function () { pending.q = search.value.trim(); pending.page = 1; drawPendingKeepFocus(); });
    $all("[data-only]").forEach(function (b) { b.addEventListener("click", function () { pending.only = b.getAttribute("data-only"); pending.page = 1; drawPending(); }); });
    $("[data-sort]").addEventListener("change", function (e) { pending.sort = e.target.value; drawPending(); });
    $all("[data-page-go]").forEach(function (b) { b.addEventListener("click", function () { pending.page = Number(b.getAttribute("data-page-go")); drawPending(); }); });
    var os = $("[data-office-select]");
    if (os) os.addEventListener("change", function () { pending.office = os.value; pending.page = 1; loadPending(); });
  }

  function drawPendingKeepFocus() {
    drawPending();
    var s = $("[data-table-search]");
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  /* =======================================================================
     Staff: Review Item (review -> approve / return -> student updated)
     ======================================================================= */
  var review = { profile: null, sub: null, checked: [], mode: "review", result: null, category: RETURN_REASONS[0], reason: "" };

  function reviewHeaderCard(s, badge, backLink) {
    return '<section class="card review-head">' +
      '<div class="review-head__top">' + (backLink || '<a class="link-accent link-back" href="staff.html">← Back to pending list</a>') + badge + "</div>" +
      '<div class="person"><span class="person__avatar" aria-hidden="true">' + esc(initialsOf(s.student.name)) + "</span><div>" +
      '<p class="person__name">' + esc(s.student.name) + "</p>" +
      '<p class="person__meta">' + esc(s.student.number + " · " + s.student.program_name + " · " + ordinal(s.student.year_level) + " year") + "</p></div></div>" +
      '<dl class="meta-row"><div><dt>Requirement</dt><dd>' + esc(s.office.name) + " clearance</dd></div>" +
      "<div><dt>Reference</dt><dd>" + esc(s.reference) + "</dd></div>" +
      "<div><dt>Submitted</dt><dd>" + esc(fmtDate(s.submitted_at)) + "</dd></div></dl></section>";
  }

  function evidencePreview(s) {
    var url = fileUrl(s.id);
    var preview = s.mime_type === "application/pdf"
      ? '<iframe class="evidence__frame" src="' + url + '#toolbar=0&view=FitH" title="Preview of ' + esc(s.file_name) + '"></iframe>'
      : '<img class="evidence__img" src="' + url + '" alt="Evidence uploaded by ' + esc(s.student.name) + '">';
    return '<section class="card evidence" aria-labelledby="ev-title"><h2 class="card__title" id="ev-title">Submitted evidence</h2>' +
      '<div class="file-row"><span class="file-row__icon" aria-hidden="true">' + icon("file", "icon--sm") + "</span>" +
      '<div class="file-row__text"><p class="file-row__name">' + esc(s.file_name) + "</p>" +
      '<p class="file-row__meta">' + esc(fileKind(s.mime_type) + " · " + fmtSize(s.file_size) + " · Uploaded " + fmtDate(s.submitted_at)) + "</p></div>" +
      '<a class="icon-btn icon-btn--sm" href="' + fileUrl(s.id, true) + '" aria-label="Download ' + esc(s.file_name) + '">' + icon("download", "icon--sm") + "</a>" +
      '<a class="icon-btn icon-btn--sm" href="' + url + '" target="_blank" rel="noopener" aria-label="Open ' + esc(s.file_name) + ' in a new tab">' + icon("expand", "icon--sm") + "</a></div>" +
      (s.note ? '<p class="student-note"><strong>Student note:</strong> ' + esc(s.note) + "</p>" : "") +
      '<div class="evidence__preview">' + preview + "</div>" +
      (s.history.length ? '<div class="prev-subs"><h3 class="prev-subs__title">Earlier submissions for this requirement</h3><ul role="list">' +
        s.history.map(function (h) {
          return '<li><span>' + esc(h.reference + " · " + h.file_name) + '</span><span class="cell-sub">' + esc(fmtDate(h.submitted_at)) +
            (h.reviewer ? " · " + esc(h.reviewer) : "") + "</span>" + subBadge(h.status) +
            (h.review_note ? '<p class="prev-subs__note">' + esc(h.return_category + ": " + h.review_note) + "</p>" : "") +
            ' <a class="link-accent" href="review.html?id=' + h.id + '">View</a></li>';
        }).join("") + "</ul></div>" : "") +
      "</section>";
  }

  function drawReview() {
    var s = review.sub, ctx = staffContext(review.profile);
    var list = CHECKLISTS[s.office.code] || CHECKLISTS.registrar;
    var termText = s.term + ", AY " + s.academic_year;
    var head = staffHead(ctx, "Review Item", "Verify the evidence before approving or returning this " + s.office.name.toLowerCase() + " requirement.");
    var decided = s.status !== "submitted";
    var right;
    if (!decided) {
      var all = list.every(function (c) { return review.checked.indexOf(c) !== -1; });
      right = '<section class="card checklist-card" aria-labelledby="cl-title"><h2 class="card__title" id="cl-title">Review checklist</h2>' +
        '<p class="card__text">' + esc(s.office.name) + " requirements</p>" +
        '<ul class="check-list" role="list">' + list.map(function (c, i) {
          return '<li><label class="check-line"><input type="checkbox" data-check="' + i + '"' + (review.checked.indexOf(c) !== -1 ? " checked" : "") + "> " + esc(c) + "</label></li>";
        }).join("") + "</ul>" +
        '<div class="office-record"><p class="office-record__title">Office record</p>' +
        "<p>" + esc(s.item.task) + "</p><p>" + esc(s.item.remarks) + "</p>" +
        '<p class="cell-sub">Last updated ' + esc(fmtDate(s.item.updated_at)) + "</p></div>" +
        '<button class="btn btn--violet btn--block-center" type="button" data-go="approve"' + (all ? "" : " disabled") + ">" + icon("check", "icon--sm") + "Approve Item</button>" +
        (all ? "" : '<p class="hint">Tick every check to approve.</p>') +
        '<button class="btn btn--ghost-violet btn--block-center" type="button" data-go="return">' + icon("undo", "icon--sm") + "Return for correction</button>" +
        '<p class="fine">Approval confirms this office’s requirement only. Returns require a student-visible reason.</p></section>';
    } else {
      right = '<section class="card checklist-card"><h2 class="card__title">Decision</h2>' +
        details([
          ["Status", subBadge(s.status), true],
          ["Reviewed by", s.reviewer],
          ["Reviewed", fmtDate(s.reviewed_at)],
          ["Reason", s.return_category ? s.return_category + ": " + s.review_note : ""],
          ["Checks ticked", (s.checklist || []).join(", ")]
        ]) +
        (s.status === "replaced" ? '<p class="card__text">The student uploaded a newer file, so this one was not reviewed.</p>' : "") +
        '<a class="btn btn--outline btn--block-center" href="history.html">View review history</a></section>';
    }
    var msgBtn = '<button class="btn btn--outline btn--sm" type="button" data-chat="' + s.item.id + '">' + icon("message", "icon--sm") + "Message student</button>";
    main.innerHTML = head + reviewHeaderCard(s, '<span class="review-head__actions">' + msgBtn + subBadge(s.status, s.resubmitted) + "</span>") +
      '<div class="review-grid">' + evidencePreview(s) + right + "</div>" + staffFoot(termText);

    $all("[data-check]").forEach(function (box) {
      box.addEventListener("change", function () {
        var label = list[Number(box.getAttribute("data-check"))];
        review.checked = review.checked.filter(function (c) { return c !== label; });
        if (box.checked) review.checked.push(label);
        drawReview();
        var again = $('[data-check="' + box.getAttribute("data-check") + '"]');
        if (again) again.focus();
      });
    });
    $all("[data-go]").forEach(function (b) { b.addEventListener("click", function () { review.mode = b.getAttribute("data-go"); drawReviewMode(); }); });
  }

  function notifPreview(kind, s) {
    var office = s.office.name;
    var hello = "Hello " + s.student.first_name + ", ";
    if (kind === "approve") {
      return '<aside class="card notif-preview"><h2 class="card__title">Student notification preview</h2><p class="card__text">Sent after you confirm approval</p>' +
        '<span class="badge badge--green">Approval notification</span>' +
        '<div class="notif-preview__box"><p class="notif-preview__title">' + esc(office) + " cleared you</p>" +
        "<p>" + esc(hello + "your " + office + " clearance requirement has been approved.") + "</p>" +
        "<p>" + esc("Your " + s.file_name + " was verified. No further action is needed for the " + office + ".") + "</p>" +
        '<p class="cell-sub">Reference: ' + esc(s.reference) + "</p></div>" +
        '<p class="notif-preview__label">Delivery</p><p class="notif-preview__line">' + icon("bell", "icon--sm") + "ClearGate notification (the bell on the student’s pages)</p>" +
        '<p class="fine">Your name, office and decision time are saved in review history.</p></aside>';
    }
    return '<aside class="card notif-preview"><h2 class="card__title">Student notification preview</h2><p class="card__text">Sent after you confirm the return</p>' +
      '<span class="badge badge--orange">Correction required</span>' +
      '<div class="notif-preview__box"><p class="notif-preview__title">' + esc(office) + " needs action</p>" +
      "<p>" + esc(hello + "your " + office + " clearance submission needs a correction.") + "</p>" +
      '<p class="notif-preview__label">What to fix</p><p data-preview-reason>' + esc(review.reason || "Your reason will appear here.") + "</p>" +
      '<p class="notif-preview__label">Your next step</p><p>Fix the issue, then upload a corrected file from your clearance page.</p>' +
      '<p class="cell-sub">Reference: ' + esc(s.reference) + "</p></div>" +
      '<p class="fine">The new upload will come back to your pending list when the student resubmits.</p></aside>';
  }

  function drawReviewMode() {
    var s = review.sub, ctx = staffContext(review.profile);
    var termText = s.term + ", AY " + s.academic_year;
    window.scrollTo(0, 0);
    if (review.mode === "review") { drawReview(); return; }
    if (review.mode === "done") { drawDone(); return; }

    var person = '<div class="person person--sm"><span class="person__avatar" aria-hidden="true">' + esc(initialsOf(s.student.name)) + "</span><div>" +
      '<p class="person__name">' + esc(s.student.name) + '</p><p class="person__meta">' + esc(s.student.number + " · " + s.student.program_name + " · " + ordinal(s.student.year_level) + " year") + "</p></div></div>" +
      '<dl class="meta-row meta-row--plain"><div><dt>Requirement</dt><dd>' + esc(s.office.name) + " clearance</dd></div><div><dt>Reference</dt><dd>" + esc(s.reference) +
      "</dd></div><div><dt>Submitted</dt><dd>" + esc(fmtDate(s.submitted_at)) + "</dd></div></dl>";

    if (review.mode === "approve") {
      main.innerHTML = staffHead(ctx, "Approve this item?", "Confirm your review before updating the student’s " + s.office.name.toLowerCase() + " clearance record.") +
        '<div class="decision-grid"><section class="card decision-card">' +
        '<div class="decision-card__title"><span class="tile tile--green">' + icon("file") + "</span><div><h2 class=\"card__title\">Confirm " + esc(s.office.name) + " approval</h2>" +
        '<p class="card__text">This submission has passed your office review.</p></div></div>' + person +
        '<ul class="ticked" role="list">' + review.checked.map(function (c) { return "<li>" + icon("check", "icon--sm") + esc(c) + "</li>"; }).join("") + "</ul>" +
        '<div class="callout callout--green">' + icon("check", "icon--sm") + "<div><p class=\"callout__title\">" + esc(s.office.name) + " status will change to Approved</p>" +
        "<p>The student gets a ClearGate notification. Other offices’ clearance decisions will not change.</p></div></div>" +
        '<dl class="meta-row meta-row--plain meta-row--two"><div><dt>Reviewed by</dt><dd>' + esc(ctx.reviewer) + "</dd></div><div><dt>Assigned office</dt><dd>" + esc(s.office.name) + "</dd></div></dl>" +
        '<p class="form-error form-error--light" data-review-error role="alert" hidden></p>' +
        '<div class="decision-card__actions"><button class="btn btn--neutral" type="button" data-go="review">Back to review</button>' +
        '<button class="btn btn--violet" type="button" data-confirm="approve">' + icon("check", "icon--sm") + "Confirm approval</button></div></section>" +
        notifPreview("approve", s) + "</div>" + staffFoot(termText);
    } else {
      main.innerHTML = staffHead(ctx, "Return Item", "Tell the student what needs to be corrected before this item can be approved.") +
        '<div class="decision-grid"><section class="card decision-card">' +
        '<div class="decision-card__top"><h2 class="card__title">Return for correction</h2><span class="badge badge--pending">Decision not yet sent</span></div>' + person +
        '<label class="form-field"><span class="form-field__label">Reason category *</span><select class="form-field__control" data-reason-cat>' +
        RETURN_REASONS.map(function (r) { return "<option" + (r === review.category ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label class="form-field"><span class="form-field__label">Reason for return *</span><textarea class="form-field__control" rows="4" maxlength="500" data-reason placeholder="e.g. Please upload a book return slip signed by the library circulation desk.">' + esc(review.reason) + "</textarea></label>" +
        '<p class="fine">Required. Be specific and respectful: the student sees this reason.</p>' +
        '<div class="callout callout--amber">' + icon("alert", "icon--sm") + "<div><p class=\"callout__title\">The student will be asked to resubmit</p>" +
        "<p>" + esc(s.office.name) + " clearance changes to Needs action. The reason and next step are sent as a ClearGate notification.</p></div></div>" +
        '<p class="fine">' + icon("user", "icon--xs") + " Returning as " + esc(ctx.reviewer + " · " + s.office.name) + "</p>" +
        '<p class="form-error form-error--light" data-review-error role="alert" hidden></p>' +
        '<div class="decision-card__actions"><button class="btn btn--neutral" type="button" data-go="review">Cancel</button>' +
        '<button class="btn btn--violet" type="button" data-confirm="return">' + icon("send", "icon--sm") + "Return &amp; notify student</button></div></section>" +
        notifPreview("return", s) + "</div>" + staffFoot(termText);

      var reasonEl = $("[data-reason]"), catEl = $("[data-reason-cat]");
      reasonEl.addEventListener("input", function () {
        review.reason = reasonEl.value;
        var pr = $("[data-preview-reason]");
        if (pr) pr.textContent = review.reason.trim() || "Your reason will appear here.";
      });
      catEl.addEventListener("change", function () { review.category = catEl.value; });
    }

    $all("[data-go]").forEach(function (b) { b.addEventListener("click", function () { review.mode = b.getAttribute("data-go"); drawReviewMode(); }); });
    var confirmBtn = $("[data-confirm]");
    confirmBtn.addEventListener("click", function () {
      var decision = confirmBtn.getAttribute("data-confirm");
      var err = $("[data-review-error]");
      var payload = { submission_id: s.id, decision: decision, checklist: review.checked };
      if (decision === "return") {
        if (review.reason.trim().length < 10) {
          err.textContent = "Explain what the student needs to fix (at least 10 characters).";
          err.hidden = false;
          $("[data-reason]").focus();
          return;
        }
        payload.return_category = review.category;
        payload.reason = review.reason.trim();
      }
      busy(confirmBtn, true, "Saving…");
      err.hidden = true;
      api("review-submission", payload).then(function (result) {
        review.result = result;
        review.mode = "done";
        drawReviewMode();
      }, function (e) {
        busy(confirmBtn, false);
        err.textContent = errorText(e);
        err.hidden = false;
      });
    });
  }

  var LABEL = { needs_action: "Needs action", pending: "Pending review", approved: "Approved" };

  function drawDone() {
    var r = review.result, ctx = staffContext(review.profile);
    var approved = r.status === "approved";
    var termText = r.term + ", AY " + r.academic_year;
    var n = r.notification;
    main.innerHTML = '<p class="crumb">' + esc(ctx.crumb) + "</p>" +
      '<span class="badge badge--violet">Staff confirmation</span>' +
      '<div class="page-head page-head--tight"><div><h1 class="page-title">Student Updated</h1><p class="page-subtitle">Your office decision is saved and the student has been notified.</p></div></div>' +
      '<section class="card done-banner"><span class="tile ' + (approved ? "tile--green" : "tile--orange") + '">' + icon(approved ? "check" : "undo") + "</span>" +
      '<div><h2 class="card__title">' + esc(r.office.name + " clearance " + (approved ? "approved" : "returned")) + "</h2>" +
      '<p class="card__text">' + esc(r.student.name + "’s record was updated on " + fmtDate(r.reviewed_at)) + "</p></div>" +
      '<span class="badge badge--green">Decision saved</span></section>' +
      '<div class="decision-grid"><section class="card decision-card"><h2 class="card__title">Decision record</h2>' +
      '<div class="person person--sm"><span class="person__avatar" aria-hidden="true">' + esc(initialsOf(r.student.name)) + "</span><div><p class=\"person__name\">" + esc(r.student.name) +
      '</p><p class="person__meta">' + esc(r.student.number + " · " + r.student.program_name + " · " + ordinal(r.student.year_level) + " year") + "</p></div></div>" +
      '<dl class="meta-row meta-row--plain meta-row--three"><div><dt>Requirement</dt><dd>' + esc(r.office.name) + " clearance</dd></div><div><dt>Reference</dt><dd>" + esc(r.reference) +
      "</dd></div><div><dt>Submitted</dt><dd>" + esc(fmtDate(r.submitted_at)) + "</dd></div>" +
      "<div><dt>Previous status</dt><dd>" + esc(LABEL[r.previous_item_status] || r.previous_item_status) + "</dd></div><div><dt>New status</dt><dd>" + esc(LABEL[r.item.status] || r.item.status) +
      "</dd></div><div><dt>Reviewed by</dt><dd>" + esc(r.reviewer) + "</dd></div></dl>" +
      '<h3 class="activity__title">Activity</h3><ul class="activity" role="list">' +
      '<li><span class="activity__icon">' + icon("file", "icon--sm") + "</span><div><p>" + (approved ? "Approval" : "Return") + " saved to the student record</p><p class=\"cell-sub\">" + esc(r.office.name + " · " + r.reviewer + " · " + fmtDate(r.reviewed_at)) + "</p></div>" + icon("check", "icon--sm activity__ok") + "</li>" +
      (n ? '<li><span class="activity__icon">' + icon("bell", "icon--sm") + "</span><div><p>ClearGate notification delivered</p><p class=\"cell-sub\">“" + esc(n.title) + "” · " + esc(fmtDate(n.created_at)) + "</p></div>" + icon("check", "icon--sm activity__ok") + "</li>" : "") +
      '<li><span class="activity__icon">' + icon("clock", "icon--sm") + "</span><div><p>Added to review history</p><p class=\"cell-sub\">With your checklist" + (approved ? "" : " and return reason") + "</p></div>" + icon("check", "icon--sm activity__ok") + "</li></ul>" +
      '<div class="callout callout--green">' + icon("check", "icon--sm") + "<div><p class=\"callout__title\">" + (approved ? "No further action for the " + esc(r.office.name) : "Waiting for the student") + "</p>" +
      "<p>" + (approved ? "This item has left your pending list. The full record is in review history." : "When the student uploads a corrected file it will come back to your pending list, marked Resubmitted.") + "</p></div></div></section>" +
      '<aside class="card notif-preview"><h2 class="card__title">What the student sees</h2><p class="card__text">On their clearance pages and under the bell</p>' +
      '<div class="notif-preview__box' + (approved ? "" : " notif-preview__box--warn") + '"><p class="notif-preview__title">' + esc(n ? n.title : r.office.name) + "</p>" +
      (approved ? "<p>" + esc(r.office.name + " has cleared your account.") + "</p>" :
        '<p class="notif-preview__label">What to fix</p><p>' + esc(r.return_category + ": " + r.review_note) + '</p><p class="notif-preview__label">Your next step</p><p>Fix the issue, then upload a corrected file from your clearance page.</p>') +
      '<p class="cell-sub">' + esc(r.office.name + " · " + r.reference) + "</p></div></aside></div>" +
      '<div class="done-actions"><span>Continue reviewing your office’s remaining submissions.</span><div>' +
      '<a class="btn btn--neutral" href="history.html">View review history</a><a class="btn btn--violet" href="staff.html">' + icon("arrow", "icon--sm") + "Back to pending list</a></div></div>" +
      staffFoot(termText);
  }

  /* =======================================================================
     Staff: Review History
     ======================================================================= */
  var hist = { profile: null, rows: [], q: "", decision: "", office: "" };

  function loadHistory() {
    var q = (hist.office ? "&office=" + encodeURIComponent(hist.office) : "");
    return api("review-history", undefined, q).then(function (rows) { hist.rows = rows; drawHistory(); }).catch(showPageError);
  }

  function drawHistory(keepFocus) {
    var p = hist.profile, ctx = staffContext(p);
    var rows = hist.rows;
    var approved = rows.filter(function (r) { return r.status === "approved"; }).length;
    var q = hist.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (hist.decision && r.status !== hist.decision) return false;
      if (q && [r.student_name, r.student_number, r.reference, r.file_name, r.reviewer, r.office_name, r.return_category].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var body = shown.length ? shown.map(function (r) {
      return "<tr>" +
        '<td><span class="student-cell"><strong>' + esc(r.student_name) + "</strong><span>" + esc(r.student_number + " · " + r.program + " · " + ordinal(r.year_level) + " year") + "</span></span></td>" +
        "<td>" + esc(r.file_name) + '<span class="cell-sub">' + esc((ctx.admin ? r.office_name + " · " : "") + r.reference) + "</span></td>" +
        "<td>" + subBadge(r.status) + (r.return_category ? '<span class="cell-sub">' + esc(r.return_category) + "</span>" : "") + "</td>" +
        "<td>" + esc(r.reviewer || "") + "</td>" +
        '<td class="nowrap">' + esc(shortDate(r.reviewed_at)) + "</td>" +
        '<td><a class="link-accent link-arrow" href="review.html?id=' + r.id + '">View ' + icon("arrow", "icon--sm") + "</a></td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty-cell">' + (rows.length ? "No decisions match your filters." : "No decisions yet. Approvals and returns will be listed here.") + "</td></tr>";

    main.innerHTML = staffHead(ctx, "Review History", "Every approval and return your " + (ctx.admin ? "offices have" : "office has") + " made, newest first.") +
      '<div class="stat-cards">' +
      '<section class="card stat-card stat-card--wide"><p class="stat-card__label">Decisions</p><p class="stat-card__num">' + rows.length + '</p><p class="stat-card__meta">Most recent 300 shown</p></section>' +
      '<section class="card stat-card"><p class="stat-card__label">Approved</p><p class="stat-card__num">' + approved + '</p><p class="stat-card__meta">Requirements cleared</p></section>' +
      '<section class="card stat-card"><p class="stat-card__label">Returned</p><p class="stat-card__num">' + (rows.length - approved) + '</p><p class="stat-card__meta">Sent back for correction</p></section></div>' +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Decisions</h2><p class="card__text">' + esc(ctx.officeName) + "</p></div></div>" +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Find a student or reference</span>' +
      '<input type="search" placeholder="Find a student or reference" value="' + esc(hist.q) + '" data-table-search></label>' +
      '<button type="button" class="chip' + (hist.decision === "" ? " is-on" : "") + '" data-decision="">All · ' + rows.length + "</button>" +
      '<button type="button" class="chip' + (hist.decision === "approved" ? " is-on" : "") + '" data-decision="approved">Approved · ' + approved + "</button>" +
      '<button type="button" class="chip' + (hist.decision === "returned" ? " is-on" : "") + '" data-decision="returned">Returned · ' + (rows.length - approved) + "</button>" +
      officeSelect(p, hist.office) + "</div>" +
      '<div class="table-wrap"><table class="status-table staff-table"><thead><tr><th scope="col">Student</th><th scope="col">Evidence</th><th scope="col">Decision</th><th scope="col">Reviewed by</th><th scope="col">Reviewed</th><th scope="col"><span class="visually-hidden">Open</span></th></tr></thead><tbody>' +
      body + '</tbody></table></div><div class="pager"><span>Showing ' + shown.length + " of " + plural(rows.length, "decision", "decisions") + "</span></div></section>" + staffFoot("");

    var search = $("[data-table-search]");
    search.addEventListener("input", function () { hist.q = search.value.trim(); drawHistory(true); });
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    $all("[data-decision]").forEach(function (b) { b.addEventListener("click", function () { hist.decision = b.getAttribute("data-decision"); drawHistory(); }); });
    var os = $("[data-office-select]");
    if (os) os.addEventListener("change", function () { hist.office = os.value; loadHistory(); });
  }

  /* =======================================================================
     Students: upload evidence
     ======================================================================= */
  var studentProfile = null;

  function evidenceLine(i) {
    var s = i.submission;
    if (!s) return "";
    if (s.status === "submitted") {
      return '<span class="evidence-line">' + icon("file", "icon--xs") + 'Evidence <a class="link-accent" href="' + fileUrl(s.id) + '" target="_blank" rel="noopener">' + esc(s.file_name) + "</a> sent " + esc(fmtDate(s.submitted_at)) + " · waiting for review</span>";
    }
    if (s.status === "returned") {
      return '<span class="evidence-line evidence-line--warn">' + icon("alert", "icon--xs") + "Returned " + esc(fmtDate(s.reviewed_at)) + ": " + esc(s.return_category + ". " + s.review_note) + "</span>";
    }
    if (s.status === "approved") {
      return '<span class="evidence-line evidence-line--ok">' + icon("check", "icon--xs") + 'Evidence <a class="link-accent" href="' + fileUrl(s.id) + '" target="_blank" rel="noopener">' + esc(s.file_name) + "</a> approved " + esc(fmtDate(s.reviewed_at)) + "</span>";
    }
    return "";
  }

  function uploadButton(i, cls) {
    if (i.status === "approved") return "";
    var again = i.submission && i.submission.status === "submitted";
    return '<button class="btn ' + (cls || "btn--outline") + '" type="button" data-upload="' + i.item_id + '">' + icon("upload", "icon--sm") +
      (again ? "Replace file" : (i.submission && i.submission.status === "returned" ? "Resubmit evidence" : "Upload evidence")) + "</button>";
  }

  function ensureUploadDialog() {
    var dlg = $("[data-upload-dialog]");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "item-dialog";
    dlg.setAttribute("data-upload-dialog", "");
    dlg.setAttribute("aria-labelledby", "upload-title");
    dlg.innerHTML = '<form class="item-form" novalidate>' +
      '<div class="item-form__head"><div><h2 class="card__title" id="upload-title" data-up-title>Upload evidence</h2><p class="card__text" data-up-sub></p></div>' +
      '<button class="icon-btn" type="button" data-up-close aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="callout callout--amber" data-up-returned hidden></div>' +
      '<label class="form-field"><span class="form-field__label">File (PDF, JPG, PNG or WEBP, up to 5 MB)</span>' +
      '<input class="form-field__control" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required></label>' +
      '<label class="form-field"><span class="form-field__label">Note for the office (optional)</span>' +
      '<textarea class="form-field__control" name="note" rows="2" maxlength="255" placeholder="e.g. Paid at the cashier on Oct 3"></textarea></label>' +
      '<p class="form-error form-error--light" data-form-error role="alert" hidden></p>' +
      '<div class="item-form__actions"><button class="btn btn--neutral" type="button" data-up-close>Cancel</button>' +
      '<button class="btn btn--primary" type="submit">' + icon("upload", "icon--sm") + "Upload</button></div></form>";
    document.body.appendChild(dlg);
    if (!$("[data-toast]")) {
      var t = document.createElement("div");
      t.className = "toast"; t.setAttribute("data-toast", ""); t.setAttribute("role", "status"); t.hidden = true;
      document.body.appendChild(t);
    }
    var form = $("form", dlg);
    function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
    $all("[data-up-close]", dlg).forEach(function (b) { b.addEventListener("click", close); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var file = form.elements.file.files[0];
      if (!file) { formError(form, "Choose a file to upload."); return; }
      if (file.size > 5 * 1024 * 1024) { formError(form, "That file is larger than 5 MB. Try a smaller scan or photo."); return; }
      var fd = new FormData();
      fd.append("item_id", form.dataset.itemId);
      fd.append("note", form.elements.note.value.trim());
      fd.append("file", file);
      var submit = $("[type=submit]", form);
      busy(submit, true, "Uploading…");
      formError(form, "");
      fetch(API + "?route=submit-evidence", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-ClearGate": "1", Accept: "application/json" } })
        .then(function (res) { return res.json().catch(function () { throw new ApiError(res.status, "bad_response", "The server sent an unexpected reply."); }); },
              function () { throw new ApiError(0, "offline", "Can’t reach the ClearGate server."); })
        .then(function (json) {
          busy(submit, false);
          if (!json.ok) { formError(form, (json.error && json.error.message) || "Upload failed."); return; }
          close();
          toast("Uploaded. " + json.data.office_name + " will review it (reference " + json.data.reference + ").");
          refreshStudent();
        }, function (err) { busy(submit, false); formError(form, errorText(err)); });
    });
    return dlg;
  }

  function openUpload(itemId) {
    var item = (studentProfile.items || []).filter(function (i) { return String(i.item_id) === String(itemId); })[0];
    if (!item) return;
    var dlg = ensureUploadDialog(), form = $("form", dlg);
    form.reset();
    formError(form, "");
    form.dataset.itemId = item.item_id;
    $("[data-up-title]", dlg).textContent = "Upload evidence for " + item.office_name;
    $("[data-up-sub]", dlg).textContent = item.task;
    var ret = $("[data-up-returned]", dlg);
    if (item.submission && item.submission.status === "returned") {
      ret.innerHTML = icon("alert", "icon--sm") + "<div><p class=\"callout__title\">Your last file was returned</p><p>" + esc(item.submission.return_category + ". " + item.submission.review_note) + "</p></div>";
      ret.hidden = false;
    } else if (item.submission && item.submission.status === "submitted") {
      ret.innerHTML = icon("alert", "icon--sm") + "<div><p class=\"callout__title\">This replaces " + esc(item.submission.file_name) + "</p><p>The office will review the new file instead.</p></div>";
      ret.hidden = false;
    } else {
      ret.hidden = true;
    }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  document.addEventListener("click", function (e) {
    var up = e.target.closest && e.target.closest("[data-upload]");
    if (up && studentProfile) openUpload(up.getAttribute("data-upload"));
  });

  function refreshStudent() {
    api("me").then(function (p) {
      studentProfile = p;
      fillShell(p);
      if (renderers[page]) renderers[page](p);
    }).catch(function () {});
  }

  /* =======================================================================
     Student application (sign-up), status page, change password
     ======================================================================= */
  function setFieldError(form, message, el) {
    formError(form, message);
    var box = $("[data-form-error]", form);
    if (box && message) box.scrollIntoView({ block: "center", behavior: "smooth" });
    if (el && el.focus) setTimeout(function () { el.focus(); }, 300);
  }

  var PH = { regions: null, provinces: null, cities: null, barangays: null };
  function phData(name) {
    if (PH[name]) return Promise.resolve(PH[name]);
    return fetch("assets/data/ph-" + name + ".json").then(function (r) {
      if (!r.ok) throw new Error("Address list unavailable");
      return r.json();
    }).then(function (d) { PH[name] = d; return d; });
  }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '<option value=""></option>' + items.map(function (it) {
      return '<option value="' + esc(it.n) + '" data-code="' + esc(it.c) + '">' + esc(it.n) + "</option>";
    }).join("");
    sel.disabled = !items.length;
    var hint = sel.parentNode.querySelector(".af__hint");
    if (hint) hint.hidden = items.length > 0;
  }

  function codeOf(sel) {
    var opt = sel.options[sel.selectedIndex];
    return opt ? opt.getAttribute("data-code") : "";
  }

  function setupAddress(form) {
    var region = $("[data-addr=region]", form), province = $("[data-addr=province]", form),
        city = $("[data-addr=city]", form), brgy = $("[data-addr=barangay]", form);
    function reset(list) { list.forEach(function (s) { fillSelect(s, []); }); }
    phData("regions").then(function (r) { fillSelect(region, r); }).catch(function () {
      formError(form, "The address lists could not load. Refresh the page to try again.");
    });
    region.addEventListener("change", function () {
      reset([province, city, brgy]);
      if (!region.value) return;
      phData("provinces").then(function (p) { fillSelect(province, p[codeOf(region)] || []); });
    });
    province.addEventListener("change", function () {
      reset([city, brgy]);
      if (!province.value) return;
      phData("cities").then(function (c) { fillSelect(city, c[codeOf(region) + codeOf(province)] || []); });
    });
    city.addEventListener("change", function () {
      reset([brgy]);
      if (!city.value) return;
      phData("barangays").then(function (b) {
        fillSelect(brgy, (b[codeOf(city)] || []).map(function (n) { return { c: n, n: n }; }));
      });
    });
  }

  function setupApply() {
    var form = $("[data-apply-form]");
    if (location.protocol === "file:") formError(form, serverHelp());
    api("programs").then(function (list) {
      var sel = $("[data-program-select]", form);
      sel.innerHTML = '<option value=""></option>' + list.map(function (p) {
        return '<option value="' + esc(p.code) + '">' + esc(p.code + " – " + p.name) + "</option>";
      }).join("");
    }).catch(function (err) { formError(form, errorText(err)); });
    setupAddress(form);

    var input = $("[data-photo-input]", form), preview = $("[data-photo-preview]", form),
        hint = $("[data-photo-hint]", form), btnText = $("[data-photo-btn]", form);
    input.addEventListener("change", function () {
      var file = input.files[0];
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        input.value = "";
        setFieldError(form, "The photo must be a JPG, PNG or WEBP image.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        input.value = "";
        setFieldError(form, "Your photo is larger than 5 MB. Choose a smaller image.");
        return;
      }
      formError(form, "");
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      hint.textContent = file.name;
      btnText.textContent = "Change Photo";
    });

    $all("[data-copy-parent]", form).forEach(function (b) {
      b.addEventListener("click", function () {
        var who = b.getAttribute("data-copy-parent"), el = form.elements;
        el.guardian_first.value = el[who + "_first"].value;
        el.guardian_middle.value = el[who + "_middle"].value;
        el.guardian_last.value = el[who + "_last"].value;
        el.guardian_relationship.value = who === "father" ? "Father" : "Mother";
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var bad = $all("input, select, textarea", form).filter(function (c) { return !c.disabled && !c.checkValidity(); })[0];
      if (bad) {
        var label = bad.closest(".af") ? bad.closest(".af").querySelector(".af__label") : null;
        var name = label ? label.textContent.replace(" *", "") : (bad.name === "certify" ? "The certification box" : "A field");
        setFieldError(form, name + ": " + (bad.validationMessage || "check this field."), bad);
        bad.classList.add("is-invalid");
        return;
      }
      var fd = new FormData(form);
      fd.delete("certify");
      if (!input.files[0]) fd.delete("photo");
      var submit = $("[type=submit]", form);
      busy(submit, true, "Submitting…");
      formError(form, "");
      fetch(API + "?route=apply", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-ClearGate": "1", Accept: "application/json" } })
        .then(function (res) { return res.json().catch(function () { throw new ApiError(res.status, "bad_response", "The server sent an unexpected reply."); }); },
              function () { throw new ApiError(0, "offline", "Can’t reach the ClearGate server."); })
        .then(function (json) {
          if (!json.ok) { busy(submit, false); setFieldError(form, (json.error && json.error.message) || "Something went wrong."); return; }
          try { localStorage.setItem("cg_application", JSON.stringify({ reference: json.data.reference, token: json.data.token })); } catch (err) {}
          location.href = "application-status.html?ref=" + encodeURIComponent(json.data.reference) + "#new";
        }, function (err) { busy(submit, false); setFieldError(form, errorText(err)); });
    });
    $all(".af__control", form).forEach(function (c) {
      c.addEventListener("input", function () { c.classList.remove("is-invalid"); });
      c.addEventListener("change", function () { c.classList.remove("is-invalid"); });
    });
  }

  function setupAppStatus() {
    var box = $("[data-status-box]"), card = $("[data-status-card]"), lead = $("[data-status-lead]"), lookup = $("[data-status-lookup]");
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("cg_application") || "null"); } catch (err) {}
    var ref = new URLSearchParams(location.search).get("ref");
    var isNew = location.hash === "#new";
    var timer = null;

    function showLookup(msg) {
      box.hidden = !msg;
      if (msg) { lead.textContent = msg; card.hidden = true; }
      lookup.hidden = false;
    }

    function draw(d, viaToken) {
      lookup.hidden = true;
      box.hidden = false;
      card.hidden = false;
      clearTimeout(timer);
      var head = '<p class="status-card__ref">' + esc(d.reference) + " · " + esc(d.name) + "</p>";
      if (d.status === "pending") {
        lead.textContent = isNew ? "Application submitted. Keep this page open, or come back to it later." : "Your application is with the Registrar.";
        card.innerHTML = head + '<div class="status-card__state status-card__state--pending"><span class="spinner" aria-hidden="true"></span><div>' +
          "<p><strong>Waiting for the Registrar</strong></p><p>Submitted " + esc(fmtDate(d.submitted_at)) + ". This page updates by itself when your account is ready.</p></div></div>" +
          '<p class="status-card__note">Save your reference number <strong>' + esc(d.reference) + "</strong>. With it, your personal email and birthday you can check this page from any device.</p>";
        if (viaToken) timer = setTimeout(check, 15000);
      } else if (d.status === "approved") {
        lead.textContent = "Your account is ready.";
        card.innerHTML = head + '<div class="status-card__state status-card__state--ok">' + icon("check") + "<div><p><strong>Approved</strong></p><p>Approved " + esc(fmtDate(d.reviewed_at)) + ".</p></div></div>" +
          '<dl class="creds"><div><dt>Student ID</dt><dd>' + esc(d.student_number) + "</dd></div>" +
          "<div><dt>School email</dt><dd>" + esc(d.student_email) + "</dd></div>" +
          (d.temp_password ? "<div><dt>Temporary password</dt><dd><code>" + esc(d.temp_password) + "</code></dd></div>" : "") + "</dl>" +
          (d.temp_password ? '<p class="status-card__note">Write these down. Sign in with your student ID and the temporary password; you&rsquo;ll be asked to set your own password right away.</p>' :
            '<p class="status-card__note">You have already set your own password. Forgot it? Use Forgot password on the sign-in page, or ask the Registrar.</p>') +
          '<a class="btn-glass" href="index.html?login=' + encodeURIComponent(d.student_number) + '">Go to sign in</a>';
      } else {
        lead.textContent = "Your application was not approved.";
        card.innerHTML = head + '<div class="status-card__state status-card__state--bad">' + icon("alert") + "<div><p><strong>Not approved</strong></p><p>" +
          esc(d.reject_reason || "Contact the Registrar for details.") + "</p></div></div>" +
          '<a class="btn-glass" href="signup.html">Start a new application</a>';
        try { localStorage.removeItem("cg_application"); } catch (err) {}
      }
    }

    function check() {
      api("application-status", { reference: saved.reference, token: saved.token }).then(function (d) { draw(d, true); }, function (err) {
        if (err.status === 404) { try { localStorage.removeItem("cg_application"); } catch (e) {} showLookup(""); }
        else { lead.textContent = errorText(err); timer = setTimeout(check, 30000); }
      });
    }

    if (saved && saved.reference && saved.token && (!ref || ref.toUpperCase() === saved.reference)) {
      check();
    } else {
      showLookup("");
      if (ref) lookup.elements.reference.value = ref;
    }

    lookup.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!lookup.checkValidity()) { lookup.reportValidity(); return; }
      var submit = $("[type=submit]", lookup);
      busy(submit, true, "Checking…");
      formError(lookup, "");
      api("application-status", {
        reference: lookup.elements.reference.value.trim(),
        personal_email: lookup.elements.personal_email.value.trim(),
        birthday: lookup.elements.birthday.value
      }).then(function (d) { busy(submit, false); draw(d, false); }, function (err) { busy(submit, false); formError(lookup, errorText(err)); });
    });
  }

  function setupChangePassword() {
    var form = $("[data-change-form]");
    api("me").then(function (p) {
      currentRole = p.user.role;
      if (p.user.must_change_password) {
        $("[data-change-lead]", form).textContent = "Welcome! You signed in with a temporary password. Set your own password to continue.";
      }
    }, function (err) {
      if (err.status === 401) location.replace("index.html");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var submit = $("[type=submit]", form);
      busy(submit, true, "Saving…");
      formError(form, "");
      api("change-password", { current_password: form.elements.current_password.value, new_password: form.elements.new_password.value }).then(function () {
        location.href = currentRole === "student" || !currentRole ? "dashboard.html" : "staff.html";
      }, function (err) { busy(submit, false); formError(form, errorText(err)); });
    });
  }

  /* =======================================================================
     Registrar: Applications
     ======================================================================= */
  var appsState = { profile: null, data: null, status: "pending", q: "" };

  function loadApps() {
    var id = new URLSearchParams(location.search).get("id");
    if (id) {
      return api("application", undefined, "&id=" + encodeURIComponent(id)).then(drawApp).catch(showPageError);
    }
    return api("applications", undefined, appsState.status ? "&status=" + appsState.status : "").then(function (d) { appsState.data = d; drawApps(); }).catch(showPageError);
  }

  function appBadge(status) {
    return { pending: '<span class="badge badge--pending">Pending</span>', approved: '<span class="badge badge--green">Approved</span>', rejected: '<span class="badge badge--orange">Rejected</span>' }[status] || "";
  }

  function drawApps(keepFocus) {
    var p = appsState.profile, ctx = staffContext(p), d = appsState.data, c = d.counts || {};
    var q = appsState.q.toLowerCase();
    var rows = d.rows.filter(function (r) {
      return !q || [r.name, r.reference, r.personal_email, r.program].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    var body = rows.length ? rows.map(function (r) {
      return "<tr>" +
        '<td><span class="person person--row">' + (r.has_photo ? '<img class="person__photo" src="' + API + "?route=application-photo&id=" + r.id + '" alt="" loading="lazy">' : '<span class="person__avatar" aria-hidden="true">' + esc(initialsOf(r.first_name + " " + r.last_name)) + "</span>") + '<span class="student-cell"><strong>' + esc(r.name) + "</strong><span>" + esc(r.personal_email) + "</span></span></span></td>" +
        "<td>" + esc(r.program + " · " + ordinal(r.year_level) + " year") + '<span class="cell-sub">' + esc(r.admission_type) + "</span></td>" +
        "<td>" + esc(r.reference) + "</td>" +
        '<td class="nowrap">' + esc(shortDate(r.submitted_at)) + "</td>" +
        "<td>" + appBadge(r.status) + "</td>" +
        '<td><a class="link-accent link-arrow" href="applications.html?id=' + r.id + '">' + (r.status === "pending" ? "Review" : "View") + " " + icon("arrow", "icon--sm") + "</a></td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty-cell">' + (d.rows.length ? "No applications match your search." : (appsState.status === "pending" ? "No applications waiting. New sign-ups will appear here." : "No applications here yet.")) + "</td></tr>";

    main.innerHTML = staffHead(ctx, "Applications", "Review student sign-ups. Approving creates the student ID, school email and a temporary password.") +
      '<div class="stat-cards">' +
      '<section class="card stat-card stat-card--wide"><p class="stat-card__label">Waiting for review</p><p class="stat-card__num">' + (c.pending || 0) + '</p><p class="stat-card__meta">' + (c.today || 0) + " submitted today</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Approved</p><p class="stat-card__num">' + (c.approved || 0) + '</p><p class="stat-card__meta">Accounts created</p></section>' +
      '<section class="card stat-card"><p class="stat-card__label">Rejected</p><p class="stat-card__num">' + (c.rejected || 0) + '</p><p class="stat-card__meta">With a reason sent</p></section></div>' +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Student applications</h2><p class="card__text">Newest first</p></div></div>' +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Find an applicant</span>' +
      '<input type="search" placeholder="Find a name, email or reference" value="' + esc(appsState.q) + '" data-table-search></label>' +
      ["pending", "approved", "rejected", ""].map(function (s) {
        var label = { pending: "Pending", approved: "Approved", rejected: "Rejected", "": "All" }[s];
        var n = s ? (c[s] || 0) : (c.pending || 0) + (c.approved || 0) + (c.rejected || 0);
        return '<button type="button" class="chip' + (appsState.status === s ? " is-on" : "") + '" data-app-status="' + s + '">' + label + " · " + n + "</button>";
      }).join("") + "</div>" +
      '<div class="table-wrap"><table class="status-table staff-table"><thead><tr><th scope="col">Applicant</th><th scope="col">Applying for</th><th scope="col">Reference</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Open</span></th></tr></thead><tbody>' +
      body + "</tbody></table></div></section>" + staffFoot("");

    var search = $("[data-table-search]");
    search.addEventListener("input", function () { appsState.q = search.value.trim(); drawApps(true); });
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    $all("[data-app-status]").forEach(function (b) { b.addEventListener("click", function () { appsState.status = b.getAttribute("data-app-status"); loadApps(); }); });
  }

  function joinName(a, b, c) { return [a, b, c].filter(Boolean).join(" "); }

  function drawApp(a) {
    var ctx = staffContext(appsState.profile);
    var info = [
      ["Admission type", a.admission_type], ["Program", a.program + " – " + a.program_name], ["Academic level", ordinal(a.year_level) + " year"],
      ["Sex", a.sex], ["Civil status", a.civil_status], ["Birthday", a.birthday], ["Place of birth", a.place_of_birth],
      ["Personal email", a.personal_email], ["Contact number", a.contact_number], ["Religion", a.religion], ["Permanent address", a.permanent_address]
    ];
    var addr = [["Region", a.region], ["Province", a.province], ["City / Municipality", a.city], ["Barangay", a.barangay], ["House no. / Street", a.street], ["Postal code", a.postal_code]];
    var fam = [
      ["Father", joinName(a.father_first, a.father_middle, a.father_last) + " · " + a.father_occupation],
      ["Mother", joinName(a.mother_first, a.mother_middle, a.mother_last) + " · " + a.mother_occupation],
      ["Guardian", joinName(a.guardian_first, a.guardian_middle, a.guardian_last) + " · " + a.guardian_relationship],
      ["Guardian contact", a.guardian_contact]
    ];
    var right;
    if (a.status === "pending") {
      right = '<section class="card checklist-card"><h2 class="card__title">Decision</h2>' +
        '<p class="card__text">Approving creates the account right away:</p>' +
        '<ul class="ticked" role="list"><li>' + icon("check", "icon--sm") + "A new student ID</li><li>" + icon("check", "icon--sm") + "School email: " + esc(a.last_name + a.first_name).toLowerCase().replace(/[^a-zñ]/g, "").replace(/ñ/g, "n") + "@cgateway.edu.ph</li><li>" +
        icon("check", "icon--sm") + "A temporary password</li><li>" + icon("check", "icon--sm") + "This term’s clearance, every office pending</li></ul>" +
        '<p class="form-error form-error--light" data-review-error role="alert" hidden></p>' +
        '<button class="btn btn--violet btn--block-center" type="button" data-app-approve>' + icon("check", "icon--sm") + "Approve &amp; create account</button>" +
        '<label class="form-field"><span class="form-field__label">Reason, if rejecting</span><textarea class="form-field__control" rows="3" maxlength="255" data-reject-reason placeholder="e.g. The photo is not a 2x2 ID photo. Please apply again with a clear photo."></textarea></label>' +
        '<button class="btn btn--ghost-violet btn--block-center" type="button" data-app-reject>' + icon("x", "icon--sm") + "Reject application</button>" +
        '<p class="fine">The applicant sees the result on their application status page.</p></section>';
    } else if (a.status === "approved") {
      right = '<section class="card checklist-card"><h2 class="card__title">Account created</h2>' +
        details([["Student ID", a.student_number], ["School email", a.student_email],
          ["Temporary password", a.temp_password ? "<code>" + esc(a.temp_password) + "</code>" : "Already changed by the student", true],
          ["Approved by", a.reviewer], ["Approved", fmtDate(a.reviewed_at)]]) +
        '<p class="fine">The student also sees these on their status page. Give them in person if they ask.</p>' +
        '<p class="form-error form-error--light" data-review-error role="alert" hidden></p>' +
        '<button class="btn btn--outline btn--block-center" type="button" data-app-resetpw>' + icon("undo", "icon--sm") + "Issue a new temporary password</button></section>";
    } else {
      right = '<section class="card checklist-card"><h2 class="card__title">Rejected</h2>' +
        details([["Reason", a.reject_reason], ["Rejected by", a.reviewer], ["Rejected", fmtDate(a.reviewed_at)]]) + "</section>";
    }
    main.innerHTML = staffHead(ctx, "Application " + a.reference, "Check the details (and photo, if any) before deciding.") +
      '<section class="card review-head"><div class="review-head__top"><a class="link-accent link-back" href="applications.html">← Back to applications</a>' + appBadge(a.status) + "</div>" +
      '<div class="person">' + (a.has_photo ? '<img class="person__photo person__photo--lg" src="' + API + "?route=application-photo&id=" + a.id + '" alt="2x2 photo of ' + esc(a.first_name + " " + a.last_name) + '">' : '<span class="person__avatar person__photo--lg" aria-hidden="true">' + esc(initialsOf(a.first_name + " " + a.last_name)) + "</span>") + "<div>" +
      '<p class="person__name">' + esc(a.name) + '</p><p class="person__meta">' + esc(a.personal_email + " · " + a.contact_number) + '</p><p class="person__meta">Submitted ' + esc(fmtDate(a.submitted_at)) + "</p></div></div></section>" +
      '<div class="review-grid"><div class="stack-cards">' +
      '<section class="card"><h2 class="card__title">Student information</h2>' + details(info) + "</section>" +
      '<section class="card"><h2 class="card__title">Current address</h2>' + details(addr) + "</section>" +
      '<section class="card"><h2 class="card__title">Parent’s / guardian’s information</h2>' + details(fam) + "</section></div>" +
      right + "</div>" + staffFoot("");

    function act(route, payload, btn) {
      var err = $("[data-review-error]");
      busy(btn, true, "Saving…");
      err.hidden = true;
      api(route, payload).then(function (res) { drawApp(res); window.scrollTo(0, 0); }, function (e) { busy(btn, false); err.textContent = errorText(e); err.hidden = false; });
    }
    var ap = $("[data-app-approve]"), rj = $("[data-app-reject]"), rp = $("[data-app-resetpw]");
    if (ap) ap.addEventListener("click", function () { act("review-application", { id: a.id, decision: "approve" }, ap); });
    if (rj) rj.addEventListener("click", function () {
      var reason = $("[data-reject-reason]").value.trim();
      if (reason.length < 5) { var err = $("[data-review-error]"); err.textContent = "Write a reason for the applicant first (at least 5 characters)."; err.hidden = false; $("[data-reject-reason]").focus(); return; }
      act("review-application", { id: a.id, decision: "reject", reason: reason }, rj);
    });
    if (rp) rp.addEventListener("click", function () { act("reset-temp-password", { id: a.id }, rp); });
  }

  /* =======================================================================
     Office messages (student <-> office chat about one requirement)
     ======================================================================= */
  var chat = { itemId: null, timer: null, onClose: null, lastCount: -1 };

  function ensureChatDialog() {
    var dlg = $("[data-chat-dialog]");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "item-dialog chat-dialog";
    dlg.setAttribute("data-chat-dialog", "");
    dlg.setAttribute("aria-labelledby", "chat-title");
    dlg.innerHTML = '<div class="chat">' +
      '<div class="item-form__head chat__head"><div><h2 class="card__title" id="chat-title" data-chat-title>Messages</h2><p class="card__text" data-chat-sub></p></div>' +
      '<button class="icon-btn" type="button" data-chat-close aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="chat__log" data-chat-log role="log" aria-live="polite"></div>' +
      '<form class="chat__form" data-chat-form novalidate>' +
      '<p class="form-error form-error--light" data-form-error role="alert" hidden></p>' +
      '<label class="visually-hidden" for="chat-input">Your message</label>' +
      '<textarea class="form-field__control chat__input" id="chat-input" name="body" rows="2" maxlength="1000" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"></textarea>' +
      '<button class="btn btn--violet" type="submit">' + icon("send", "icon--sm") + "Send</button></form></div>";
    document.body.appendChild(dlg);
    var form = $("[data-chat-form]", dlg), input = $("textarea", form);
    $("[data-chat-close]", dlg).addEventListener("click", function () { closeChat(); });
    dlg.addEventListener("close", function () { stopChat(); });
    dlg.addEventListener("cancel", function () { stopChat(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true })); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      var btn = $("[type=submit]", form);
      busy(btn, true, "Sending…");
      formError(form, "");
      api("send-message", { item_id: chat.itemId, body: text }).then(function (d) {
        busy(btn, false);
        input.value = "";
        drawChat(d, true);
        input.focus();
      }, function (err) { busy(btn, false); formError(form, errorText(err)); });
    });
    return dlg;
  }

  function drawChat(d, scroll) {
    var dlg = ensureChatDialog(), log = $("[data-chat-log]", dlg);
    var me = currentRole === "student" ? "student" : "office";
    $("[data-chat-title]", dlg).textContent = me === "student" ? "Message " + d.item.office_name : d.item.student_name + " · " + d.item.office_name;
    $("[data-chat-sub]", dlg).textContent = (me === "student" ? "" : d.item.student_number + " · ") + d.item.task;
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (!d.messages.length) {
      log.innerHTML = '<p class="chat__empty">' + (me === "student" ?
        "No messages yet. Ask " + esc(d.item.office_name) + " a question about this requirement. Staff reply here, and you’ll see it under the bell." :
        "No messages yet. Write to " + esc(d.item.student_name) + "; they’ll get a notification under the bell.") + "</p>";
    } else {
      log.innerHTML = d.messages.map(function (m) {
        var mine = m.from === me;
        return '<div class="bubble' + (mine ? " bubble--mine" : "") + '"><p class="bubble__meta">' + esc(mine ? "You" : m.sender_name) + " · " + esc(shortDate(m.created_at)) + "</p>" +
          '<p class="bubble__body">' + esc(m.body) + "</p>" +
          (mine && m.read_at ? '<p class="bubble__seen">Seen</p>' : "") + "</div>";
      }).join("");
    }
    if (scroll || nearBottom || chat.lastCount !== d.messages.length) log.scrollTop = log.scrollHeight;
    chat.lastCount = d.messages.length;
  }

  function openChat(itemId, onClose) {
    var dlg = ensureChatDialog();
    chat.itemId = itemId;
    chat.onClose = onClose || null;
    chat.lastCount = -1;
    $("[data-chat-log]", dlg).innerHTML = '<p class="chat__empty">Loading…</p>';
    formError($("[data-chat-form]", dlg), "");
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
    function poll() {
      api("messages", undefined, "&item_id=" + encodeURIComponent(itemId)).then(function (d) {
        if (chat.itemId !== itemId) return;
        drawChat(d, false);
        chat.timer = setTimeout(poll, 10000);
      }, function (err) {
        $("[data-chat-log]", dlg).innerHTML = '<p class="chat__empty">' + esc(errorText(err)) + "</p>";
      });
    }
    clearTimeout(chat.timer);
    poll();
    setTimeout(function () { $("textarea", dlg).focus(); }, 50);
  }

  function stopChat() {
    clearTimeout(chat.timer);
    var cb = chat.onClose;
    chat.itemId = null;
    chat.onClose = null;
    if (cb) cb();
  }

  function closeChat() {
    var dlg = $("[data-chat-dialog]");
    if (!dlg) return;
    if (dlg.close && dlg.open) dlg.close(); else { dlg.removeAttribute("open"); stopChat(); }
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-chat]");
    if (!b) return;
    e.preventDefault();
    var id = b.getAttribute("data-chat");
    openChat(id, function () {
      if (currentRole === "student") refreshStudent();
      else if (page === "messages") loadThreads();
      else refreshMsgBadge();
    });
  });

  function chatButton(i, cls) {
    var m = i.messages || { total: 0, unread: 0 };
    return '<button class="btn ' + (cls || "btn--plain") + ' chat-btn" type="button" data-chat="' + i.item_id + '">' + icon("message", "icon--sm") +
      "Message " + esc(i.office_name) + (m.unread ? ' <span class="count-pill">' + m.unread + " new</span>" : "") + "</button>";
  }

  function setMsgBadge(n) {
    $all("[data-nav-msg-count]").forEach(function (b) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = !n; });
  }
  function refreshMsgBadge() {
    api("me").then(function (p) { setMsgBadge(p.unread_messages || 0); }).catch(function () {});
  }

  /* Staff: Messages page */
  var threads = { profile: null, rows: [], q: "", only: "", office: "" };

  function loadThreads() {
    var q = threads.office ? "&office=" + encodeURIComponent(threads.office) : "";
    refreshMsgBadge();
    return api("message-threads", undefined, q).then(function (rows) { threads.rows = rows; drawThreads(); }).catch(showPageError);
  }

  function drawThreads(keepFocus) {
    var p = threads.profile, ctx = staffContext(p), rows = threads.rows;
    var unread = rows.filter(function (r) { return r.unread; }).length;
    var q = threads.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (threads.only === "unread" && !r.unread) return false;
      return !q || [r.student_name, r.student_number, r.office_name, r.task, r.last_body].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    var list = shown.length ? '<ul class="threads" role="list">' + shown.map(function (r) {
      return '<li><button type="button" class="thread' + (r.unread ? " thread--unread" : "") + '" data-chat="' + r.item_id + '">' +
        '<span class="person__avatar" aria-hidden="true">' + esc(initialsOf(r.student_name)) + "</span>" +
        '<span class="thread__main"><span class="thread__top"><strong>' + esc(r.student_name) + '</strong><span class="thread__time">' + esc(shortDate(r.last_at)) + "</span></span>" +
        '<span class="thread__meta">' + esc(r.student_number + " · " + (ctx.admin ? r.office_name + " · " : "") + r.task) + "</span>" +
        '<span class="thread__last">' + esc((r.last_from === "office" ? "You: " : "") + r.last_body) + "</span></span>" +
        (r.unread ? '<span class="count-pill">' + r.unread + " new</span>" : "") + "</button></li>";
    }).join("") + "</ul>" : '<p class="empty-cell">' + (rows.length ? "No conversations match." :
      "No messages yet. Students can message your office from their clearance pages, and you can start one from Clearance Status or Review Item.") + "</p>";

    main.innerHTML = staffHead(ctx, "Messages", "Questions from students about your office’s requirements.") +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Conversations</h2>' +
      '<p class="card__text">' + esc(ctx.officeName) + " · " + plural(rows.length, "conversation", "conversations") + "</p></div></div>" +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Find a student or message</span>' +
      '<input type="search" placeholder="Find a student or message" value="' + esc(threads.q) + '" data-table-search></label>' +
      '<button type="button" class="chip' + (threads.only === "" ? " is-on" : "") + '" data-thr="">All · ' + rows.length + "</button>" +
      '<button type="button" class="chip' + (threads.only === "unread" ? " is-on" : "") + '" data-thr="unread">Unread · ' + unread + "</button>" +
      officeSelect(p, threads.office) + "</div>" + list + "</section>" + staffFoot("");

    var search = $("[data-table-search]");
    search.addEventListener("input", function () { threads.q = search.value.trim(); drawThreads(true); });
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    $all("[data-thr]").forEach(function (b) { b.addEventListener("click", function () { threads.only = b.getAttribute("data-thr"); drawThreads(); }); });
    var os = $("[data-office-select]");
    if (os) os.addEventListener("change", function () { threads.office = os.value; loadThreads(); });
  }

  /* =======================================================================
     Registrar and admin: Reports, Audit Log, Settings, Staff Accounts
     ======================================================================= */
  function isAdmin(p) { return p.user.role === "admin"; }

  function showAdminNav(p) {
    $all("[data-nav-admin]").forEach(function (li) { li.hidden = !isAdmin(p); });
  }

  function ensureToast() {
    if (!$("[data-toast]")) {
      var t = document.createElement("div");
      t.className = "toast"; t.setAttribute("data-toast", ""); t.setAttribute("role", "status"); t.hidden = true;
      document.body.appendChild(t);
    }
  }

  /* A reusable form dialog. fields is HTML of .form-field labels; onSubmit(form) returns a promise. */
  function formDialog(opts) {
    ensureToast();
    var dlg = document.createElement("dialog");
    dlg.className = "item-dialog";
    dlg.setAttribute("aria-labelledby", "fd-title");
    dlg.innerHTML = '<form class="item-form" novalidate>' +
      '<div class="item-form__head"><div><h2 class="card__title" id="fd-title">' + esc(opts.title) + "</h2>" +
      (opts.sub ? '<p class="card__text">' + esc(opts.sub) + "</p>" : "") + "</div>" +
      '<button class="icon-btn" type="button" data-fd-close aria-label="Close">' + icon("x") + "</button></div>" +
      opts.fields +
      '<p class="form-error form-error--light" data-form-error role="alert" hidden></p>' +
      '<div class="item-form__actions"><button class="btn btn--neutral" type="button" data-fd-close>Cancel</button>' +
      '<button class="btn ' + (opts.danger ? "btn--navy" : "btn--primary") + '" type="submit">' + esc(opts.submit || "Save") + "</button></div></form>";
    document.body.appendChild(dlg);
    var form = $("form", dlg);
    function close() { if (dlg.close) dlg.close(); dlg.remove(); }
    $all("[data-fd-close]", dlg).forEach(function (b) { b.addEventListener("click", close); });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var submit = $("[type=submit]", form);
      formError(form, "");
      busy(submit, true, "Saving…");
      new Promise(function (res) { res(opts.onSubmit(form)); }).then(function (keepOpen) {
        busy(submit, false);
        if (!keepOpen) close();
      }, function (err) {
        busy(submit, false);
        formError(form, errorText(err));
      });
    });
    if (opts.onOpen) opts.onOpen(form);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    var first = $("input:not([type=hidden]):not([readonly]), select, textarea", form);
    if (first) first.focus();
    return dlg;
  }

  function field(label, control, hint) {
    return '<label class="form-field"><span class="form-field__label">' + esc(label) + "</span>" + control +
      (hint ? '<span class="form-field__hint">' + esc(hint) + "</span>" : "") + "</label>";
  }
  function inputHtml(name, value, attrs) {
    return '<input class="form-field__control" name="' + name + '" value="' + esc(value == null ? "" : value) + '" ' + (attrs || "") + ">";
  }
  function select(name, options, current, attrs) {
    return '<select class="form-field__control" name="' + name + '" ' + (attrs || "") + ">" + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current == null ? "" : current) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }

  /* Shows a one-time temporary password the admin has to pass on. */
  function showTempPassword(name, email, temp) {
    formDialog({
      title: "Temporary password",
      sub: "Give this to " + name + ". It is shown only once, and they will be asked to choose a new password when they sign in.",
      fields: '<dl class="detail-list">' +
        '<div class="detail-list__row"><dt>Email</dt><dd>' + esc(email) + "</dd></div>" +
        '<div class="detail-list__row"><dt>Temporary password</dt><dd><code class="temp-pass" data-temp>' + esc(temp) + "</code></dd></div></dl>",
      submit: "Copy and close",
      onSubmit: function () {
        if (navigator.clipboard) navigator.clipboard.writeText(temp).then(function () { toast("Temporary password copied."); }, function () {});
      }
    });
  }

  function hoursText(h) {
    if (h == null) return "—";
    h = Number(h);
    if (h < 1) return Math.max(1, Math.round(h * 60)) + " min";
    if (h < 48) return (Math.round(h * 10) / 10) + " hrs";
    return Math.round(h / 24) + " days";
  }
  function ageText(value) {
    if (!value) return "—";
    var d = new Date(String(value).replace(" ", "T"));
    if (isNaN(d)) return value;
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    return days <= 0 ? "Today" : plural(days, "day", "days");
  }
  function pct(n) { return n == null ? 0 : Math.max(0, Math.min(100, Number(n))); }

  /* ---------- Reports ---------- */
  var rep = { profile: null, data: null };

  function loadReports() {
    return api("reports").then(function (d) { rep.data = d; drawReports(); }).catch(showPageError);
  }

  function barRows(rows, labelOf, subOf) {
    if (!rows.length) return '<p class="card__text">Nothing to show yet.</p>';
    return '<ul class="bars" role="list">' + rows.map(function (r) {
      var v = pct(r.avg_percent);
      return '<li class="bars__row"><div class="bars__label"><strong>' + esc(labelOf(r)) + "</strong><span>" + esc(subOf(r)) + "</span></div>" +
        '<div class="bars__track" role="img" aria-label="' + esc(labelOf(r) + ": " + (r.avg_percent == null ? "no clearances" : v + "% average progress")) + '">' +
        '<span class="bars__fill" style="width:' + v + '%"></span></div>' +
        '<span class="bars__value">' + (r.avg_percent == null ? "—" : v + "%") + "</span></li>";
    }).join("") + "</ul>";
  }

  function drawReports() {
    var p = rep.profile, ctx = staffContext(p), d = rep.data;
    if (!d.term) {
      main.innerHTML = staffHead(ctx, "Reports", "") + '<div class="card"><p class="card__text">No current academic year is set. ' +
        (isAdmin(p) ? 'Set one in <a class="link-accent" href="settings.html">Settings</a>.' : "Ask the administrator to set one.") + "</p></div>";
      return;
    }
    var termText = d.term.term + " · A.Y " + d.term.label;
    var cleared = Number(d.cleared || 0), total = Number(d.clearances || 0);
    var offices = d.by_office || [];
    var slowest = null, oldest = null;
    offices.forEach(function (o) {
      if (o.avg_review_hours != null && (!slowest || Number(o.avg_review_hours) > Number(slowest.avg_review_hours))) slowest = o;
      if (o.oldest_waiting && (!oldest || o.oldest_waiting < oldest.oldest_waiting)) oldest = o;
    });
    var maxOpen = Math.max.apply(null, offices.map(function (o) { return Number(o.pending) + Number(o.needs_action); }).concat([1]));

    var officeBody = offices.map(function (o) {
      var open = Number(o.pending) + Number(o.needs_action);
      var tags = (slowest && slowest.code === o.code ? ' <span class="badge badge--orange">Slowest reviews</span>' : "") +
        (oldest && oldest.code === o.code ? ' <span class="badge badge--amber">Longest wait</span>' : "");
      return '<tr><td><span class="student-cell"><strong>' + esc(o.name) + "</strong>" + (tags ? "<span>" + tags + "</span>" : "") + "</span></td>" +
        '<td class="nowrap"><span class="mini-bar"><span style="width:' + Math.round(open / maxOpen * 100) + '%"></span></span>' + open + " open</td>" +
        "<td>" + o.approved + "</td><td>" + o.pending + "</td><td>" + o.needs_action + "</td><td>" + o.waiting_evidence + "</td>" +
        '<td class="nowrap">' + esc(hoursText(o.avg_review_hours)) + '</td><td class="nowrap">' + esc(ageText(o.oldest_waiting)) + "</td></tr>";
    }).join("");

    main.innerHTML = staffHead(ctx, "Reports", "Clearance progress for " + termText + ".") +
      '<div class="report-actions"><a class="btn btn--primary" href="' + API + '?route=report-export" download>' + icon("download", "icon--sm") + "Export to Excel (CSV)</a>" +
      '<a class="btn btn--outline" href="audit.html">' + icon("clock", "icon--sm") + "Open the audit log</a></div>" +
      '<div class="stat-cards stat-cards--4">' +
      '<section class="card stat-card"><p class="stat-card__label">Active students</p><p class="stat-card__num">' + d.students + '</p><p class="stat-card__meta">' + plural(total, "clearance", "clearances") + " opened</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Fully cleared</p><p class="stat-card__num">' + cleared + '</p><p class="stat-card__meta">' + (total ? Math.round(cleared / total * 100) : 0) + "% of clearances</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Average progress</p><p class="stat-card__num">' + (d.avg_percent == null ? "—" : d.avg_percent + "%") + '</p><p class="stat-card__meta">Across all offices</p></section>' +
      '<section class="card stat-card"><p class="stat-card__label">Applications</p><p class="stat-card__num">' + d.applications.pending + '</p><p class="stat-card__meta">Waiting · ' + d.applications.approved + " approved · " + d.applications.rejected + " rejected</p></section></div>" +
      '<div class="report-grid">' +
      '<section class="card"><div class="card__head"><div><h2 class="card__title">By program</h2><p class="card__text">Average progress and students fully cleared</p></div></div>' +
      barRows(d.by_program || [], function (r) { return r.code; }, function (r) { return r.clearances ? r.cleared + " of " + r.clearances + " cleared" : "No clearances"; }) + "</section>" +
      '<section class="card"><div class="card__head"><div><h2 class="card__title">By year level</h2><p class="card__text">Average progress and students fully cleared</p></div></div>' +
      barRows(d.by_year || [], function (r) { return ordinal(r.year_level) + " year"; }, function (r) { return r.cleared + " of " + r.clearances + " cleared"; }) + "</section></div>" +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Office workload</h2><p class="card__text">Average review time counts evidence from upload to decision.</p></div></div>' +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Office</th><th scope="col">Open items</th><th scope="col">Approved</th><th scope="col">Pending</th><th scope="col">Needs action</th><th scope="col">Evidence waiting</th><th scope="col">Avg review time</th><th scope="col">Oldest wait</th></tr></thead><tbody>' +
      (officeBody || '<tr><td colspan="8" class="empty-cell">No offices yet.</td></tr>') + "</tbody></table></div></section>" + staffFoot(termText);
  }

  /* ---------- Audit log ---------- */
  var audit = { profile: null, data: null, q: "", kind: "", from: "", to: "" };

  function auditQuery() {
    return (audit.from ? "&from=" + encodeURIComponent(audit.from) : "") + (audit.to ? "&to=" + encodeURIComponent(audit.to) : "");
  }
  function loadAudit() {
    return api("audit-log", undefined, auditQuery()).then(function (d) {
      audit.data = d; audit.from = d.from; audit.to = d.to; drawAudit();
    }).catch(showPageError);
  }

  var KIND_BADGE = {
    "Status change": "badge--indigo", "Evidence uploaded": "badge--pending", "Evidence approved": "badge--green",
    "Evidence returned": "badge--orange", "Application submitted": "badge--pending", "Application approved": "badge--green",
    "Application rejected": "badge--orange", "Admin change": "badge--violet"
  };
  var STATUS_WORD = { needs_action: "Needs action", pending: "Pending", approved: "Approved", "new": "New" };
  function prettyDetails(t) {
    return String(t || "").replace(/\b(needs_action|pending|approved|new) → (needs_action|pending|approved)\b/, function (m, a, b) {
      return STATUS_WORD[a] + " → " + STATUS_WORD[b];
    });
  }

  function drawAudit(keepFocus) {
    var p = audit.profile, ctx = staffContext(p), rows = audit.data.rows;
    var kinds = {};
    rows.forEach(function (r) { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
    var q = audit.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (audit.kind && r.kind !== audit.kind) return false;
      if (q && [r.kind, r.actor, r.office, r.subject, r.details].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var body = shown.length ? shown.map(function (r) {
      return '<tr><td class="nowrap">' + esc(fmtDate(r.at)) + "</td>" +
        '<td><span class="badge ' + (KIND_BADGE[r.kind] || "badge--muted") + '">' + esc(r.kind) + "</span></td>" +
        "<td>" + esc(r.actor || "System") + (r.office ? '<span class="cell-sub">' + esc(r.office) + "</span>" : "") + "</td>" +
        "<td>" + esc(r.subject || "—") + "</td>" +
        '<td class="audit-details">' + esc(prettyDetails(r.details)) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty-cell">' + (rows.length ? "Nothing matches your filters." : "No activity in this date range.") + "</td></tr>";

    var chips = '<button type="button" class="chip' + (audit.kind === "" ? " is-on" : "") + '" data-kind="">All · ' + rows.length + "</button>" +
      Object.keys(kinds).sort().map(function (k) {
        return '<button type="button" class="chip' + (audit.kind === k ? " is-on" : "") + '" data-kind="' + esc(k) + '">' + esc(k) + " · " + kinds[k] + "</button>";
      }).join("");

    main.innerHTML = staffHead(ctx, "Audit Log", "Who changed what, and when. Newest first.") +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Activity</h2>' +
      '<p class="card__text">' + esc(fmtDate(audit.from + " 00:00").split(",")[0] + " to " + fmtDate(audit.to + " 00:00").split(",")[0]) + (rows.length >= 1000 ? " · newest 1,000 shown" : "") + "</p></div>" +
      '<form class="date-range" data-range><label class="filter"><span class="filter__label">From</span><input class="filter__control" type="date" name="from" value="' + esc(audit.from) + '"></label>' +
      '<label class="filter"><span class="filter__label">To</span><input class="filter__control" type="date" name="to" value="' + esc(audit.to) + '"></label>' +
      '<button class="btn btn--outline btn--sm" type="submit">Apply</button>' +
      '<a class="btn btn--primary btn--sm" href="' + API + "?route=audit-log&csv=1" + esc(auditQuery()) + '" download>' + icon("download", "icon--sm") + "Export CSV</a></form></div>" +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Search the log</span>' +
      '<input type="search" placeholder="Search names, references, details" value="' + esc(audit.q) + '" data-table-search></label>' + chips + "</div>" +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">By</th><th scope="col">About</th><th scope="col">Details</th></tr></thead><tbody>' +
      body + '</tbody></table></div><div class="pager"><span>Showing ' + shown.length + " of " + plural(rows.length, "entry", "entries") + "</span></div></section>" + staffFoot("");

    var search = $("[data-table-search]");
    search.addEventListener("input", function () { audit.q = search.value.trim(); drawAudit(true); });
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    $all("[data-kind]").forEach(function (b) { b.addEventListener("click", function () { audit.kind = b.getAttribute("data-kind"); drawAudit(); }); });
    var range = $("[data-range]");
    range.addEventListener("submit", function (e) {
      e.preventDefault();
      audit.from = range.elements.from.value; audit.to = range.elements.to.value;
      if (audit.from && audit.to && audit.from > audit.to) { toast("The start date must be before the end date."); return; }
      loadAudit();
    });
  }

  /* ---------- Settings ---------- */
  var sett = { profile: null, data: null, tab: "offices" };
  var ICON_NAMES = [["book", "Book"], ["wallet", "Wallet"], ["file", "Document"], ["heart", "Heart"], ["cap", "Graduation cap"], ["box", "Box"]];
  var TERMS = ["1st Semester", "2nd Semester", "Summer"];

  function loadSettings() {
    return Promise.all([api("settings"), api("backups").catch(function () { return { backups: [] }; })]).then(function (r) {
      sett.data = r[0];
      sett.data.backups = r[1].backups || [];
      drawSettings();
    }).catch(showPageError);
  }

  function officeForm(o) {
    var isNew = !o;
    o = o || { name: "", code: "", contact_email: "", office_hours: "Mon to Fri · 8:00 AM to 5:00 PM", icon: "file", sort_order: (sett.data.offices.length + 1), is_active: 1 };
    var ct = sett.data.current;
    formDialog({
      title: isNew ? "Add an office" : "Edit " + o.name,
      sub: isNew ? "Offices sign student clearances. Add a staff account for it afterwards." : "Code: " + o.code,
      fields: field("Office name", inputHtml("name", o.name, 'required maxlength="80"')) +
        (isNew ? field("Short code", inputHtml("code", o.code, 'required maxlength="20" pattern="[a-z][a-z0-9-]{1,19}" placeholder="e.g. clinic"'), "Lowercase letters, numbers or dashes. It can't be changed later.") : "") +
        field("Contact email", inputHtml("contact_email", o.contact_email, 'type="email" required maxlength="190" placeholder="office@cgateway.edu.ph"')) +
        field("Office hours", inputHtml("office_hours", o.office_hours, 'required maxlength="80"')) +
        '<div class="form-grid">' + field("Icon", select("icon", ICON_NAMES, o.icon)) + field("Order", inputHtml("sort_order", o.sort_order, 'type="number" min="0" max="99"')) + "</div>" +
        '<label class="check-line"><input type="checkbox" name="is_active"' + (Number(o.is_active) ? " checked" : "") + "> Active (students need this office's sign-off)</label>" +
        (isNew && ct ? '<label class="check-line"><input type="checkbox" name="add_to_open" checked> Add it to the open ' + esc(ct.term + ", A.Y " + ct.label) + " clearances</label>" : ""),
      submit: isNew ? "Add office" : "Save changes",
      onSubmit: function (f) {
        var data = {
          name: f.elements.name.value.trim(), contact_email: f.elements.contact_email.value.trim(), office_hours: f.elements.office_hours.value.trim(),
          icon: f.elements.icon.value, sort_order: Number(f.elements.sort_order.value || 0), is_active: f.elements.is_active.checked
        };
        if (isNew) { data.code = f.elements.code.value.trim().toLowerCase(); data.add_to_open = f.elements.add_to_open ? f.elements.add_to_open.checked : false; }
        else data.office_id = o.office_id;
        return api("save-office", data).then(function (r) {
          toast(isNew ? data.name + " added" + (r.added_to ? " to " + plural(r.added_to, "clearance", "clearances") : "") + "." : "Office saved.");
          return loadSettings();
        });
      }
    });
  }

  function programForm(pr) {
    var isNew = !pr;
    pr = pr || { code: "", name: "" };
    formDialog({
      title: isNew ? "Add a program" : "Edit " + pr.code,
      sub: "Programs appear on the student application form.",
      fields: field("Code", inputHtml("code", pr.code, 'required maxlength="10" placeholder="e.g. BSCE"')) +
        field("Program name", inputHtml("name", pr.name, 'required maxlength="120" placeholder="Bachelor of Science in ..."')),
      submit: isNew ? "Add program" : "Save changes",
      onSubmit: function (f) {
        var data = { code: f.elements.code.value.trim().toUpperCase(), name: f.elements.name.value.trim() };
        if (!isNew) data.program_id = pr.program_id;
        return api("save-program", data).then(function () { toast("Program saved."); return loadSettings(); });
      }
    });
  }

  function yearForm() {
    var last = sett.data.years[0];
    var y = last ? Number(String(last.label).slice(-4)) : new Date().getFullYear();
    formDialog({
      title: "Add an academic year",
      sub: "The label is made from the years, e.g. " + y + " - " + (y + 1) + ".",
      fields: '<div class="form-grid">' + field("Starts", inputHtml("start_date", y + "-08-01", 'type="date" required')) + field("Ends", inputHtml("end_date", (y + 1) + "-05-31", 'type="date" required')) + "</div>",
      submit: "Add year",
      onSubmit: function (f) {
        return api("save-year", { start_date: f.elements.start_date.value, end_date: f.elements.end_date.value }).then(function (r) {
          toast("Academic year " + r.label + " added."); return loadSettings();
        });
      }
    });
  }

  function openTermForm(y) {
    var opened = String(y.terms_opened || "").split(",").filter(Boolean);
    var next = TERMS.filter(function (t) { return opened.indexOf(t) === -1; })[0] || TERMS[0];
    formDialog({
      title: "Open a clearance term",
      sub: "Creates a clearance for each of the " + plural(sett.data.active_students, "active student", "active students") + " in A.Y " + y.label + ". Students who already have one are skipped.",
      fields: field("Term", select("term", TERMS.map(function (t) { return [t, t + (opened.indexOf(t) !== -1 ? " (already open)" : "")]; }), next)) +
        (Number(y.is_current) ? "" : '<p class="callout callout--amber">This isn’t the current academic year. Staff only see the current year’s newest term.</p>'),
      submit: "Open term",
      onSubmit: function (f) {
        return api("open-term", { academic_year_id: y.academic_year_id, term: f.elements.term.value }).then(function (r) {
          toast(r.opened ? plural(r.opened, "clearance", "clearances") + " opened." : "Every active student already had a clearance for that term.");
          return loadSettings();
        });
      }
    });
  }

  function drawSettings() {
    var p = sett.profile, ctx = staffContext(p), d = sett.data, html = "";
    var tabs = [["offices", "Offices", d.offices.length], ["programs", "Programs", d.programs.length], ["years", "Academic years & terms", d.years.length], ["backups", "Backups", d.backups.length]];

    if (sett.tab === "offices") {
      html = '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Offices</h2><p class="card__text">Turned-off offices are hidden from staff lists and new clearances.</p></div>' +
        '<button class="btn btn--primary btn--sm" type="button" data-add="office">+ Add office</button></div>' +
        '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Office</th><th scope="col">Contact</th><th scope="col">Hours</th><th scope="col">Staff</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead><tbody>' +
        d.offices.map(function (o, i) {
          return '<tr><td><span class="office-cell"><span class="tile tile--sm tile--indigo">' + icon(o.icon, "icon--sm") + '</span><span class="student-cell"><strong>' + esc(o.name) + "</strong><span>" + esc(o.code) + "</span></span></span></td>" +
            "<td>" + esc(o.contact_email) + "</td><td>" + esc(o.office_hours) + "</td><td>" + o.staff_count + "</td>" +
            "<td>" + (Number(o.is_active) ? '<span class="badge badge--green">Active</span>' : '<span class="badge badge--muted">Off</span>') + "</td>" +
            '<td><button class="btn btn--outline btn--sm" type="button" data-edit-office="' + i + '">Edit</button></td></tr>';
        }).join("") + "</tbody></table></div></section>";
    } else if (sett.tab === "programs") {
      html = '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Programs</h2><p class="card__text">A program can only be deleted when no student or application uses it.</p></div>' +
        '<button class="btn btn--primary btn--sm" type="button" data-add="program">+ Add program</button></div>' +
        '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Students</th><th scope="col">Applications</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
        d.programs.map(function (pr, i) {
          var used = Number(pr.student_count) + Number(pr.application_count);
          return "<tr><td><strong>" + esc(pr.code) + "</strong></td><td>" + esc(pr.name) + "</td><td>" + pr.student_count + "</td><td>" + pr.application_count + "</td>" +
            '<td><div class="row-actions"><button class="btn btn--outline btn--sm" type="button" data-edit-program="' + i + '">Edit</button>' +
            (used ? "" : '<button class="btn btn--plain btn--sm" type="button" data-del-program="' + i + '">Delete</button>') + "</div></td></tr>";
        }).join("") + "</tbody></table></div></section>";
    } else if (sett.tab === "backups") {
      var autos = d.backups.filter(function (b) { return b.kind === "auto"; });
      var sizeText = function (n) { return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; };
      html = '<div class="callout callout--green"><p class="callout__title">' +
        (autos.length ? "Automatic backups are on · last one " + esc(fmtDate(autos[0].created)) : "Automatic backups are on") + "</p>" +
        "<p>ClearGate saves a copy of the whole database once a day while the site is in use, and keeps the newest 14. Download one now and then and keep it somewhere other than this computer (Google Drive, a USB stick).</p></div>" +
        '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Backups</h2>' +
        '<p class="card__text">Each file holds every table, trigger, procedure and view. To restore one: open phpMyAdmin, choose <strong>Import</strong>, pick the file and click Import. It replaces the cleargate database.</p></div>' +
        '<div class="row-actions"><button class="btn btn--outline btn--sm" type="button" data-backup-save>Save one now</button>' +
        '<a class="btn btn--primary btn--sm" href="' + API + '?route=download-backup" download>' + icon("download", "icon--sm") + "Download a backup</a></div></div>" +
        '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Backup</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Created</th><th scope="col"><span class="visually-hidden">Download</span></th></tr></thead><tbody>' +
        (d.backups.length ? d.backups.map(function (b) {
          return "<tr><td><strong>" + esc(b.file) + "</strong></td>" +
            "<td>" + (b.kind === "auto" ? '<span class="badge badge--muted">Automatic</span>' : '<span class="badge badge--indigo">Manual</span>') + "</td>" +
            "<td>" + sizeText(b.size) + '</td><td class="nowrap">' + esc(fmtDate(b.created)) + "</td>" +
            '<td><a class="link-accent link-arrow" href="' + API + "?route=download-backup&file=" + encodeURIComponent(b.file) + '" download>Download ' + icon("download", "icon--sm") + "</a></td></tr>";
        }).join("") : '<tr><td colspan="5" class="empty-cell">No backups yet. The first automatic one is made within a minute of using the site.</td></tr>') +
        "</tbody></table></div></section>";
    } else {
      var ct = d.current;
      html = '<div class="callout ' + (ct ? "callout--green" : "callout--amber") + '"><p class="callout__title">' +
        (ct ? "Current term: " + esc(ct.term + ", A.Y " + ct.label) : "No current term") + "</p><p>" +
        (ct ? "Staff queues, reports and new student accounts use this term. Open the next term when the semester changes."
            : "Set a current academic year, then open its first term.") + "</p></div>" +
        '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Academic years</h2><p class="card__text">' + plural(d.active_students, "active student", "active students") + "</p></div>" +
        '<button class="btn btn--primary btn--sm" type="button" data-add="year">+ Add year</button></div>' +
        '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Academic year</th><th scope="col">Dates</th><th scope="col">Terms opened</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
        d.years.map(function (y, i) {
          var range = new Date(y.start_date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + " to " +
            new Date(y.end_date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
          return '<tr><td><strong>' + esc(y.label) + "</strong>" + (Number(y.is_current) ? ' <span class="badge badge--green">Current</span>' : "") + "</td>" +
            "<td>" + esc(range) + "</td><td>" + esc(y.terms_opened ? String(y.terms_opened).split(",").join(", ") : "None yet") + "</td>" +
            '<td><div class="row-actions">' + (Number(y.is_current) ? "" : '<button class="btn btn--outline btn--sm" type="button" data-current="' + i + '">Make current</button>') +
            '<button class="btn btn--outline btn--sm" type="button" data-open-term="' + i + '">Open a term</button></div></td></tr>';
        }).join("") + "</tbody></table></div></section>";
    }

    main.innerHTML = staffHead(ctx, "Settings", "Manage offices, programs and academic terms. Every change is recorded in the audit log.") +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab' + (sett.tab === t[0] ? " is-on" : "") + '" type="button" role="tab" aria-selected="' + (sett.tab === t[0]) + '" data-tab="' + t[0] + '">' + esc(t[1]) + ' <span class="count-pill">' + t[2] + "</span></button>";
      }).join("") + "</div>" + html + staffFoot(d.current ? d.current.term + " · A.Y " + d.current.label : "");

    $all("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { sett.tab = b.getAttribute("data-tab"); drawSettings(); }); });
    var saveBtn = $("[data-backup-save]");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      busy(saveBtn, true, "Saving…");
      api("create-backup", {}).then(function (b) { toast("Saved " + b.file + "."); return loadSettings(); }, function (err) { busy(saveBtn, false); toast(errorText(err)); });
    });
    $all("[data-add]").forEach(function (b) {
      b.addEventListener("click", function () {
        var what = b.getAttribute("data-add");
        if (what === "office") officeForm(); else if (what === "program") programForm(); else yearForm();
      });
    });
    $all("[data-edit-office]").forEach(function (b) { b.addEventListener("click", function () { officeForm(d.offices[+b.getAttribute("data-edit-office")]); }); });
    $all("[data-edit-program]").forEach(function (b) { b.addEventListener("click", function () { programForm(d.programs[+b.getAttribute("data-edit-program")]); }); });
    $all("[data-del-program]").forEach(function (b) {
      b.addEventListener("click", function () {
        var pr = d.programs[+b.getAttribute("data-del-program")];
        formDialog({
          title: "Delete " + pr.code + "?", sub: pr.name + " will be removed from the application form.", fields: "", submit: "Delete program", danger: true,
          onSubmit: function () { return api("delete-program", { program_id: pr.program_id }).then(function () { toast(pr.code + " deleted."); return loadSettings(); }); }
        });
      });
    });
    $all("[data-current]").forEach(function (b) {
      b.addEventListener("click", function () {
        var y = d.years[+b.getAttribute("data-current")];
        formDialog({
          title: "Make " + y.label + " current?", sub: "Staff queues and reports will switch to the newest term opened in this year.", fields: "", submit: "Make current",
          onSubmit: function () { return api("set-current-year", { academic_year_id: y.academic_year_id }).then(function () { toast(y.label + " is now the current year."); return loadSettings(); }); }
        });
      });
    });
    $all("[data-open-term]").forEach(function (b) { b.addEventListener("click", function () { openTermForm(d.years[+b.getAttribute("data-open-term")]); }); });
  }

  /* ---------- Staff accounts ---------- */
  var acct = { profile: null, rows: null, offices: [], q: "", only: "" };

  function loadAccounts() {
    return Promise.all([api("staff-accounts"), api("settings")]).then(function (r) {
      acct.rows = r[0];
      acct.offices = r[1].offices;
      drawAccounts();
    }).catch(showPageError);
  }

  function accountForm(a) {
    var isNew = !a;
    a = a || { full_name: "", email: "", role: "staff", office_code: "", position: "" };
    var offices = acct.offices.filter(function (o) { return Number(o.is_active) || o.code === a.office_code; })
      .map(function (o) { return [o.code, o.name]; });
    formDialog({
      title: isNew ? "Create a staff account" : "Edit " + a.full_name,
      sub: isNew ? "A temporary password is shown after you save. They choose their own on first sign-in." : a.email,
      fields: field("Full name", inputHtml("full_name", a.full_name, 'required maxlength="120"')) +
        field("ClearGate email", inputHtml("email", a.email, 'type="email" required maxlength="190" placeholder="surnamefirstnameoffice@cgateway.edu.ph"'), "Format: surname + first name + office, no spaces.") +
        '<div class="form-grid">' + field("Role", select("role", [["staff", "Office staff"], ["admin", "Administrator"]], a.role)) +
        field("Office", select("office", [["", "Choose an office"]].concat(offices), a.office_code || ""), "") + "</div>" +
        field("Position (optional)", inputHtml("position", a.position || "", 'maxlength="80" placeholder="e.g. Head Librarian"')),
      submit: isNew ? "Create account" : "Save changes",
      onOpen: function (f) {
        function sync() {
          var staff = f.elements.role.value === "staff";
          f.elements.office.closest(".form-field").hidden = !staff;
          f.elements.position.closest(".form-field").hidden = !staff;
        }
        f.elements.role.addEventListener("change", sync);
        sync();
      },
      onSubmit: function (f) {
        var data = {
          full_name: f.elements.full_name.value.trim(), email: f.elements.email.value.trim().toLowerCase(),
          role: f.elements.role.value, office: f.elements.office.value, position: f.elements.position.value.trim()
        };
        if (data.role === "staff" && !data.office) throw new ApiError(400, "invalid_office", "Choose the office this staff member signs for.");
        if (!isNew) data.user_id = a.user_id;
        return api("save-staff", data).then(function (r) {
          return loadAccounts().then(function () {
            if (r.temp_password) showTempPassword(data.full_name, data.email, r.temp_password);
            else toast("Account saved.");
          });
        });
      }
    });
  }

  function drawAccounts(keepFocus) {
    var p = acct.profile, ctx = staffContext(p), rows = acct.rows;
    var active = rows.filter(function (r) { return Number(r.is_active); }).length;
    var q = acct.q.toLowerCase();
    var shown = rows.filter(function (r) {
      if (acct.only === "active" && !Number(r.is_active)) return false;
      if (acct.only === "off" && Number(r.is_active)) return false;
      if (q && [r.full_name, r.email, r.office_name, r.position, r.role].join(" ").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var body = shown.length ? shown.map(function (r) {
      var me = Number(r.user_id) === Number(p.user.id);
      var state = !Number(r.is_active) ? '<span class="badge badge--muted">Turned off</span>' :
        (Number(r.must_change_password) ? '<span class="badge badge--amber">Temporary password</span>' : '<span class="badge badge--green">Active</span>');
      return '<tr' + (Number(r.is_active) ? "" : ' class="is-off"') + '><td><span class="person person--row"><span class="person__avatar" aria-hidden="true">' + esc(initialsOf(r.full_name)) + '</span><span class="student-cell"><strong>' + esc(r.full_name) + (me ? " (you)" : "") + "</strong><span>" + esc(r.email) + "</span></span></span></td>" +
        "<td>" + (r.role === "admin" ? "Administrator" : esc(r.office_name || "No office")) + (r.position ? '<span class="cell-sub">' + esc(r.position) + "</span>" : "") + "</td>" +
        "<td>" + state + '<span class="cell-sub nowrap">Last sign-in: ' + esc(r.last_login_at ? shortDate(r.last_login_at) : "never") + "</span></td>" +
        '<td><div class="row-actions"><button class="btn btn--outline btn--sm" type="button" data-acct-edit="' + r.user_id + '">Edit</button>' +
        '<button class="btn btn--outline btn--sm" type="button" data-acct-reset="' + r.user_id + '">Reset password</button>' +
        (me ? "" : '<button class="btn btn--plain btn--sm" type="button" data-acct-toggle="' + r.user_id + '">' + (Number(r.is_active) ? "Turn off" : "Turn on") + "</button>") + "</div></td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty-cell">No accounts match your filters.</td></tr>';

    main.innerHTML = staffHead(ctx, "Staff Accounts", "Office staff and administrators who sign in on the staff portal.") +
      '<div class="stat-cards">' +
      '<section class="card stat-card stat-card--wide"><p class="stat-card__label">Accounts</p><p class="stat-card__num">' + rows.length + '</p><p class="stat-card__meta">' + plural(rows.filter(function (r) { return r.role === "admin"; }).length, "administrator", "administrators") + "</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Active</p><p class="stat-card__num">' + active + '</p><p class="stat-card__meta">Can sign in</p></section>' +
      '<section class="card stat-card"><p class="stat-card__label">Turned off</p><p class="stat-card__num">' + (rows.length - active) + '</p><p class="stat-card__meta">Can’t sign in</p></section></div>' +
      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Accounts</h2><p class="card__text">Turning an account off signs that person out right away.</p></div>' +
      '<button class="btn btn--primary btn--sm" type="button" data-acct-new>+ Create account</button></div>' +
      '<div class="toolbar"><label class="toolbar__search">' + icon("search", "icon--sm") + '<span class="visually-hidden">Find an account</span>' +
      '<input type="search" placeholder="Find a name, email or office" value="' + esc(acct.q) + '" data-table-search></label>' +
      '<button type="button" class="chip' + (acct.only === "" ? " is-on" : "") + '" data-only="">All · ' + rows.length + "</button>" +
      '<button type="button" class="chip' + (acct.only === "active" ? " is-on" : "") + '" data-only="active">Active · ' + active + "</button>" +
      '<button type="button" class="chip' + (acct.only === "off" ? " is-on" : "") + '" data-only="off">Turned off · ' + (rows.length - active) + "</button></div>" +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Name</th><th scope="col">Office</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      body + "</tbody></table></div></section>" + staffFoot("");

    function byId(id) { return rows.filter(function (r) { return String(r.user_id) === String(id); })[0]; }
    var search = $("[data-table-search]");
    search.addEventListener("input", function () { acct.q = search.value.trim(); drawAccounts(true); });
    if (keepFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    $all("[data-only]").forEach(function (b) { b.addEventListener("click", function () { acct.only = b.getAttribute("data-only"); drawAccounts(); }); });
    $("[data-acct-new]").addEventListener("click", function () { accountForm(); });
    $all("[data-acct-edit]").forEach(function (b) { b.addEventListener("click", function () { accountForm(byId(b.getAttribute("data-acct-edit"))); }); });
    $all("[data-acct-reset]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = byId(b.getAttribute("data-acct-reset"));
        formDialog({
          title: "Reset " + a.full_name + "’s password?", sub: "Their current password stops working. You’ll get a temporary one to give them.", fields: "", submit: "Reset password",
          onSubmit: function () {
            return api("staff-reset-password", { user_id: a.user_id }).then(function (r) {
              return loadAccounts().then(function () { showTempPassword(a.full_name, a.email, r.temp_password); });
            });
          }
        });
      });
    });
    $all("[data-acct-toggle]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = byId(b.getAttribute("data-acct-toggle")), on = !Number(a.is_active);
        formDialog({
          title: (on ? "Turn on " : "Turn off ") + a.full_name + "’s account?",
          sub: on ? "They will be able to sign in again with their current password." : "They are signed out and can’t sign in until you turn the account back on. Their review history is kept.",
          fields: "", submit: on ? "Turn on" : "Turn off", danger: !on,
          onSubmit: function () {
            return api("staff-status", { user_id: a.user_id, active: on }).then(function () { toast(a.full_name + (on ? " can sign in again." : " is turned off.")); return loadAccounts(); });
          }
        });
      });
    });
  }

  /* =======================================================================
     Deadlines: countdown helpers shared by students and staff
     ======================================================================= */
  var serverSkew = 0;   // server clock minus this computer's clock, in ms

  function setServerNow(value) {
    var t = parseDt(value);
    if (!isNaN(t)) serverSkew = t - Date.now();
  }
  function parseDt(value) { return value ? new Date(String(value).replace(" ", "T")).getTime() : NaN; }
  function nowMs() { return Date.now() + serverSkew; }
  function toInputDt(value) { return value ? String(value).slice(0, 16).replace(" ", "T") : ""; }
  function inputMin() {
    var d = new Date(nowMs() + 5 * 60000);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dueDate(value) {
    var d = new Date(parseDt(value));
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ", " +
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function spanText(ms) {
    var min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return plural(min, "min", "min");
    var h = Math.floor(min / 60);
    if (h < 48) return plural(h, "hr", "hrs") + (h < 6 && min % 60 ? " " + (min % 60) + " min" : "");
    return plural(Math.round(h / 24), "day", "days");
  }

  /* Badge text and colour for a deadline. */
  function dueState(due, status) {
    var ms = parseDt(due) - nowMs();
    if (isNaN(ms)) return null;
    if (status === "approved") return { cls: "badge--muted", text: "Cleared before " + dueDate(due).split(",")[0] };
    if (ms < 0) return { cls: "badge--red", text: "Overdue by " + spanText(-ms), overdue: true };
    if (ms < 86400000) return { cls: "badge--orange", text: "Due in " + spanText(ms), soon: true };
    if (ms < 3 * 86400000) return { cls: "badge--amber", text: "Due in " + spanText(ms), soon: true };
    return { cls: "badge--indigo", text: spanText(ms) + " left" };
  }

  function dueBadge(due, status) {
    var s = dueState(due, status);
    if (!s) return "";
    return '<span class="badge due-badge ' + s.cls + '" data-due="' + esc(due) + '" data-due-status="' + esc(status || "") + '">' +
      icon("clock", "icon--xs") + "<span data-due-text>" + esc(s.text) + "</span></span>";
  }

  /* One line: "Due Mon, Oct 26, 5:00 PM  [3 days left]" */
  function dueLine(due, status, extra) {
    if (!due) return "";
    return '<span class="due-line">' + icon("clock", "icon--xs") + "Due " + esc(dueDate(due)) + " " + dueBadge(due, status) +
      (extra ? '<span class="due-line__note">' + esc(extra) + "</span>" : "") + "</span>";
  }

  /* d h m s countdown for the nearest deadline */
  function countdownParts(due) {
    var ms = Math.max(0, parseDt(due) - nowMs());
    var s = Math.floor(ms / 1000);
    return [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
  }
  function countdownHtml(due) {
    var p = countdownParts(due), labels = ["days", "hrs", "min", "sec"];
    return '<div class="countdown" data-countdown="' + esc(due) + '" role="timer" aria-label="Time left until ' + esc(dueDate(due)) + '">' +
      p.map(function (n, i) { return '<span class="countdown__cell"><span class="countdown__num" data-cd="' + i + '">' + (i ? (n < 10 ? "0" : "") + n : n) + '</span><span class="countdown__label">' + labels[i] + "</span></span>"; }).join("") + "</div>";
  }

  /* Keep every badge and countdown on the page current. */
  setInterval(function () {
    $all("[data-countdown]").forEach(function (el) {
      var p = countdownParts(el.getAttribute("data-countdown"));
      $all("[data-cd]", el).forEach(function (n) { var i = +n.getAttribute("data-cd"); n.textContent = (i ? (p[i] < 10 ? "0" : "") + p[i] : p[i]); });
    });
  }, 1000);
  setInterval(function () {
    $all("[data-due]").forEach(function (el) {
      var s = dueState(el.getAttribute("data-due"), el.getAttribute("data-due-status"));
      if (!s) return;
      el.className = "badge due-badge " + s.cls;
      $("[data-due-text]", el).textContent = s.text;
    });
  }, 30000);

  /* =======================================================================
     Staff/admin: Deadlines & Reminders
     ======================================================================= */
  var dl = { profile: null, data: null };

  function loadDeadlines() {
    return api("deadlines").then(function (d) {
      dl.data = d;
      if (d.now) setServerNow(d.now);
      drawDeadlines();
    }).catch(showPageError);
  }

  function ownOffice(p) { return p.user.role === "admin" ? "" : (p.staff ? p.staff.office_code : ""); }

  /* Set or change an office deadline. code = office code, or "all" (admin). */
  function officeDeadlineDialog(o, onDone) {
    var all = o === "all";
    formDialog({
      title: all ? "Set a deadline for every office" : (o.due_at ? "Change the " : "Set the ") + o.name + " deadline",
      sub: all ? "Replaces each office’s deadline for this term. Students with their own deadline keep it." :
        "Applies to every student this term, except students you gave their own deadline.",
      fields: '<div class="form-grid">' + field("Deadline", inputHtml("due_at", all ? "" : toInputDt(o.due_at), 'type="datetime-local" required min="' + inputMin() + '"')) + "</div>" +
        field("Note for students (optional)", inputHtml("note", all ? "" : (o.note || ""), 'maxlength="255" placeholder="e.g. Return borrowed books before the semester break"')) +
        '<label class="check-line"><input type="checkbox" name="notify" checked> Notify students who aren’t cleared yet</label>',
      submit: "Save deadline",
      onSubmit: function (f) {
        if (!f.elements.due_at.value) throw new ApiError(400, "invalid_date", "Choose a date and time for the deadline.");
        return api("save-deadline", { office: all ? "all" : o.code, due_at: f.elements.due_at.value, note: f.elements.note.value.trim(), notify: f.elements.notify.checked })
          .then(function (r) {
            toast("Deadline saved" + (r.notified ? " and " + plural(r.notified, "student", "students") + " notified." : "."));
            return onDone && onDone();
          });
      }
    });
  }

  /* Give one student their own deadline. row: {item_id, student_name, office_name, own_due_at, office_due_at, status} */
  function studentDeadlineDialog(row, onDone, items) {
    var pick = !row;
    var options = (items || []).filter(function (i) { return i.status !== "approved"; })
      .map(function (i) { return [i.item_id, i.student_name + " · " + i.student_number + " · " + i.office_name]; });
    formDialog({
      title: pick ? "Give a student their own deadline" : "Deadline for " + row.student_name,
      sub: pick ? "For a student who needs more time (or less) than the office deadline." :
        row.office_name + (row.office_due_at ? " · office deadline " + dueDate(row.office_due_at) : " · no office deadline set"),
      fields: (pick ? field("Student", select("item_id", [["", "Choose a student"]].concat(options), "", "required")) : "") +
        field("Their deadline", inputHtml("due_at", row ? toInputDt(row.own_due_at) : "", 'type="datetime-local" min="' + inputMin() + '"'),
          pick ? "" : "Leave it empty to use the office deadline again.") +
        '<label class="check-line"><input type="checkbox" name="notify" checked> Notify the student</label>',
      submit: "Save",
      onSubmit: function (f) {
        var id = pick ? f.elements.item_id.value : row.item_id;
        if (!id) throw new ApiError(400, "invalid_student", "Choose a student.");
        if (pick && !f.elements.due_at.value) throw new ApiError(400, "invalid_date", "Choose a date and time.");
        return api("item-deadline", { item_id: Number(id), due_at: f.elements.due_at.value || null, notify: f.elements.notify.checked }).then(function (r) {
          toast(r.due_at ? "Deadline saved." : "The student now follows the office deadline.");
          return onDone && onDone();
        });
      }
    });
  }

  /* opts: {office: code|"all"|"", item: row (one student), items: [...] for picking, offices: [...]} */
  function reminderDialog(opts, onDone) {
    var p = opts.profile, admin = p.user.role === "admin";
    var fixed = opts.item;
    var officeOptions = admin ? [["all", "Every office (from the Administrator)"]].concat((opts.offices || []).map(function (o) { return [o.code, o.name]; })) : null;
    var startOffice = fixed ? fixed.office_code : (opts.office || (admin ? "all" : ownOffice(p)));
    var officeName = fixed ? fixed.office_name : (p.staff ? p.staff.office_name : "");
    formDialog({
      title: fixed ? "Remind " + fixed.student_name : "Send a reminder",
      sub: fixed ? fixed.office_name + " · " + fixed.task : "Students see it in their notifications.",
      fields: (fixed ? "" :
          (admin ? field("From", select("office", officeOptions, startOffice)) : "") +
          field("Send to", select("audience", [["outstanding", "Everyone not cleared yet"], ["overdue", "Only students past the deadline"], ["student", "One student"]], "outstanding")) +
          field("Student", select("item_id", [["", "Choose a student"]], ""))) +
        field("Message", '<textarea class="form-field__control" name="message" rows="3" maxlength="255" required></textarea>', "Up to 255 characters.") +
        '<div class="form-grid">' + field("When", select("when", [["now", "Send now"], ["later", "Schedule for later"]], "now")) +
        field("Send at", inputHtml("send_at", "", 'type="datetime-local" min="' + inputMin() + '"')) + "</div>",
      submit: "Send reminder",
      onOpen: function (f) {
        var el = f.elements;
        function office() { return fixed ? fixed.office_code : (el.office ? el.office.value : startOffice); }
        function fillStudents() {
          if (!el.item_id) return;
          var code = office();
          var list = (opts.items || []).filter(function (i) { return i.status !== "approved" && (code === "all" || !code || i.office_code === code); });
          el.item_id.innerHTML = '<option value="">Choose a student</option>' + list.map(function (i) {
            return '<option value="' + i.item_id + '">' + esc(i.student_name + " · " + i.student_number + (code === "all" || !code ? " · " + i.office_name : "")) + "</option>";
          }).join("");
        }
        function defaultMessage() {
          var who = fixed ? fixed.office_name : (office() === "all" ? "" : (el.office ? el.office.options[el.office.selectedIndex].text : officeName));
          var due = fixed ? (fixed.due_at || fixed.own_due_at || fixed.office_due_at) : null;
          if (!who) return "Please finish your clearance requirements soon. Check My Requirements to see what’s left.";
          return "Please finish your " + who + " requirement" + (due ? " before " + dueDate(due) : " as soon as you can") + ". Upload your evidence or visit the office.";
        }
        var touched = false;
        el.message.value = defaultMessage();
        el.message.addEventListener("input", function () { touched = true; });
        function sync() {
          if (el.audience) {
            var one = el.audience.value === "student";
            el.item_id.closest(".form-field").hidden = !one;
            if (el.office) {
              var allOpt = el.office.querySelector('option[value="all"]');
              if (allOpt) allOpt.disabled = one;
              if (one && el.office.value === "all") el.office.value = (opts.offices && opts.offices[0]) ? opts.offices[0].code : "all";
            }
          }
          el.send_at.closest(".form-field").hidden = el.when.value !== "later";
          if (!touched) el.message.value = defaultMessage();
        }
        if (el.office) el.office.addEventListener("change", function () { fillStudents(); sync(); });
        if (el.audience) el.audience.addEventListener("change", sync);
        el.when.addEventListener("change", sync);
        fillStudents();
        sync();
      },
      onSubmit: function (f) {
        var el = f.elements;
        var data = { message: el.message.value.trim(), send_at: el.when.value === "later" ? el.send_at.value : "" };
        if (el.when.value === "later" && !el.send_at.value) throw new ApiError(400, "invalid_date", "Choose when to send it.");
        if (fixed) { data.audience = "student"; data.item_id = fixed.item_id; }
        else {
          data.audience = el.audience.value;
          data.office = el.office ? el.office.value : startOffice;
          if (data.audience === "student") {
            if (!el.item_id.value) throw new ApiError(400, "invalid_student", "Choose the student to remind.");
            data.item_id = Number(el.item_id.value);
          }
        }
        return api("send-reminder", data).then(function (r) {
          toast(r.sent_to === null ? "Reminder scheduled for " + dueDate(r.send_at) + "." :
            (r.sent_to ? "Reminder sent to " + plural(r.sent_to, "student", "students") + "." : "No students matched, so nobody was reminded."));
          return onDone && onDone();
        });
      }
    });
  }

  var AUDIENCE = { outstanding: "Everyone not cleared", overdue: "Students past the deadline", student: "" };

  function drawDeadlines() {
    var p = dl.profile, ctx = staffContext(p), d = dl.data, admin = p.user.role === "admin";
    if (!d.term) {
      main.innerHTML = staffHead(ctx, "Deadlines & Reminders", "") + '<div class="card"><p class="card__text">No current academic year is set yet.</p></div>';
      return;
    }
    var termText = d.term.term + " · A.Y " + d.term.label;
    var mine = ownOffice(p);

    var officeRows = d.offices.map(function (o, i) {
      var out = Number(o.outstanding), over = Number(o.overdue);
      return "<tr><td><span class=\"office-cell\"><span class=\"tile tile--sm tile--indigo\">" + icon(o.icon, "icon--sm") + '</span><span class="student-cell"><strong>' + esc(o.name) + "</strong>" +
        (o.set_by ? "<span>Set by " + esc(o.set_by) + "</span>" : "") + "</span></span></td>" +
        "<td>" + (o.due_at ? '<span class="student-cell"><strong>' + esc(dueDate(o.due_at)) + "</strong><span>" + dueBadge(o.due_at, out ? "pending" : "approved") + "</span></span>" : '<span class="muted">No deadline</span>') + "</td>" +
        "<td>" + out + " of " + o.students + (over ? ' <span class="badge badge--red">' + over + " overdue</span>" : "") +
        (Number(o.own_deadlines) ? '<span class="cell-sub">' + plural(Number(o.own_deadlines), "student has", "students have") + " their own</span>" : "") + "</td>" +
        '<td class="audit-details">' + esc(o.note || "—") + "</td>" +
        '<td><div class="row-actions"><button class="btn btn--outline btn--sm" type="button" data-set-dl="' + i + '">' + (o.due_at ? "Change" : "Set deadline") + "</button>" +
        '<button class="btn btn--outline btn--sm" type="button" data-remind-office="' + esc(o.code) + '"' + (out ? "" : " disabled") + ">" + icon("bell", "icon--sm") + "Remind</button>" +
        (o.due_at ? '<button class="btn btn--plain btn--sm" type="button" data-clear-dl="' + i + '">Remove</button>' : "") + "</div></td></tr>";
    }).join("");

    var own = d.items.filter(function (i) { return i.own_due_at; });
    var ownRows = own.length ? own.map(function (i) {
      return '<tr><td><span class="student-cell"><strong>' + esc(i.student_name) + "</strong><span>" + esc(i.student_number) + "</span></span></td>" +
        (admin ? "<td>" + esc(i.office_name) + "</td>" : "") +
        '<td><span class="student-cell"><strong>' + esc(dueDate(i.own_due_at)) + "</strong><span>" + dueBadge(i.own_due_at, i.status) + "</span></span></td>" +
        "<td>" + (i.office_due_at ? esc(dueDate(i.office_due_at)) : "—") + "</td>" +
        "<td>" + statusBadge(i.status) + "</td>" +
        '<td><div class="row-actions"><button class="btn btn--outline btn--sm" type="button" data-own-dl="' + i.item_id + '">Change</button>' +
        '<button class="btn btn--plain btn--sm" type="button" data-own-clear="' + i.item_id + '">Remove</button></div></td></tr>';
    }).join("") : '<tr><td colspan="' + (admin ? 6 : 5) + '" class="empty-cell">Every student follows their office’s deadline.</td></tr>';

    var remRows = d.reminders.length ? d.reminders.map(function (r) {
      var scheduled = !r.sent_at && !r.cancelled_at;
      var canCancel = scheduled && (admin || (r.office_code && r.office_code === mine));
      var state = r.cancelled_at ? '<span class="badge badge--muted">Cancelled</span>' :
        (scheduled ? '<span class="badge badge--amber">' + icon("clock", "icon--xs") + "Scheduled</span>" :
          '<span class="badge badge--green">' + icon("check", "icon--xs") + "Sent to " + (r.recipients || 0) + "</span>");
      var to = r.audience === "student" ? esc((r.student_name || "A student") + (r.student_number ? " · " + r.student_number : "")) : esc(AUDIENCE[r.audience]);
      return "<tr><td class=\"nowrap\">" + esc(fmtDate(r.sent_at || r.send_at)) + (scheduled ? '<span class="cell-sub">' + esc("in " + spanText(parseDt(r.send_at) - nowMs())) + "</span>" : "") + "</td>" +
        "<td>" + esc(r.office_name || "Every office") + '<span class="cell-sub">' + esc(r.created_by_name || "") + "</span></td>" +
        "<td>" + to + '</td><td class="audit-details">' + esc(r.message) + "</td><td>" + state + "</td>" +
        "<td>" + (canCancel ? '<button class="btn btn--plain btn--sm" type="button" data-cancel-rem="' + r.reminder_id + '">Cancel</button>' : "") + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="empty-cell">No reminders yet. Automatic ones still go out 3 days and 1 day before a deadline.</td></tr>';

    var next = d.offices.filter(function (o) { return o.due_at && parseDt(o.due_at) > nowMs(); })
      .sort(function (a, b) { return parseDt(a.due_at) - parseDt(b.due_at); })[0];
    var totalOut = d.offices.reduce(function (n, o) { return n + Number(o.outstanding); }, 0);
    var totalOver = d.offices.reduce(function (n, o) { return n + Number(o.overdue); }, 0);
    var scheduledCount = d.reminders.filter(function (r) { return !r.sent_at && !r.cancelled_at; }).length;

    main.innerHTML = staffHead(ctx, "Deadlines & Reminders", "Set when students must be cleared by, and remind the ones who aren’t.") +
      '<div class="stat-cards">' +
      '<section class="card stat-card stat-card--wide"><p class="stat-card__label">' + (next ? "Next deadline · " + esc(next.name) : "Next deadline") + "</p>" +
      (next ? countdownHtml(next.due_at) + '<p class="stat-card__meta">' + esc(dueDate(next.due_at)) + "</p>" : '<p class="stat-card__num">—</p><p class="stat-card__meta">No upcoming deadline</p>') + "</section>" +
      '<section class="card stat-card"><p class="stat-card__label">Not cleared yet</p><p class="stat-card__num">' + totalOut + '</p><p class="stat-card__meta">' + (totalOver ? totalOver + " past the deadline" : "None overdue") + "</p></section>" +
      '<section class="card stat-card"><p class="stat-card__label">Scheduled reminders</p><p class="stat-card__num">' + scheduledCount + '</p><p class="stat-card__meta">Plus automatic ones 3 days and 1 day before</p></section></div>' +

      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Office deadlines</h2><p class="card__text">' + esc(termText) + " · students can still submit after a deadline, but it shows as overdue.</p></div>" +
      (admin ? '<button class="btn btn--primary btn--sm" type="button" data-set-all>Set for every office</button>' : "") + "</div>" +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Office</th><th scope="col">Deadline</th><th scope="col">Not cleared</th><th scope="col">Note</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      officeRows + "</tbody></table></div></section>" +

      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Reminders</h2><p class="card__text">Sent and scheduled reminders, newest first.</p></div>' +
      '<button class="btn btn--primary btn--sm" type="button" data-new-rem>' + icon("bell", "icon--sm") + "New reminder</button></div>" +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">When</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Message</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      remRows + "</tbody></table></div></section>" +

      '<section class="card card--flush"><div class="card__head card__head--padded"><div><h2 class="card__title">Student-specific deadlines</h2><p class="card__text">Students who have their own date instead of the office deadline.</p></div>' +
      '<button class="btn btn--outline btn--sm" type="button" data-own-new>+ Add</button></div>' +
      '<div class="table-wrap"><table class="status-table staff-table admin-table"><thead><tr><th scope="col">Student</th>' + (admin ? '<th scope="col">Office</th>' : "") + '<th scope="col">Their deadline</th><th scope="col">Office deadline</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      ownRows + "</tbody></table></div></section>" + staffFoot(termText);

    var offices = d.offices.map(function (o) { return { code: o.code, name: o.name }; });
    $all("[data-set-dl]").forEach(function (b) { b.addEventListener("click", function () { officeDeadlineDialog(d.offices[+b.getAttribute("data-set-dl")], loadDeadlines); }); });
    var setAll = $("[data-set-all]");
    if (setAll) setAll.addEventListener("click", function () { officeDeadlineDialog("all", loadDeadlines); });
    $all("[data-clear-dl]").forEach(function (b) {
      b.addEventListener("click", function () {
        var o = d.offices[+b.getAttribute("data-clear-dl")];
        formDialog({ title: "Remove the " + o.name + " deadline?", sub: "Students will no longer see a due date for " + o.name + ". Students with their own deadline keep it.", fields: "", submit: "Remove deadline", danger: true,
          onSubmit: function () { return api("save-deadline", { office: o.code, clear: true }).then(function () { toast("Deadline removed."); return loadDeadlines(); }); } });
      });
    });
    $all("[data-remind-office]").forEach(function (b) {
      b.addEventListener("click", function () { reminderDialog({ profile: p, office: b.getAttribute("data-remind-office"), items: d.items, offices: offices }, loadDeadlines); });
    });
    $("[data-new-rem]").addEventListener("click", function () { reminderDialog({ profile: p, items: d.items, offices: offices }, loadDeadlines); });
    $all("[data-cancel-rem]").forEach(function (b) {
      b.addEventListener("click", function () {
        formDialog({ title: "Cancel this reminder?", sub: "It won’t be sent.", fields: "", submit: "Cancel reminder", danger: true,
          onSubmit: function () { return api("cancel-reminder", { reminder_id: Number(b.getAttribute("data-cancel-rem")) }).then(function () { toast("Reminder cancelled."); return loadDeadlines(); }); } });
      });
    });
    function itemById(id) { return d.items.filter(function (i) { return String(i.item_id) === String(id); })[0]; }
    $("[data-own-new]").addEventListener("click", function () { studentDeadlineDialog(null, loadDeadlines, d.items); });
    $all("[data-own-dl]").forEach(function (b) { b.addEventListener("click", function () { studentDeadlineDialog(itemById(b.getAttribute("data-own-dl")), loadDeadlines); }); });
    $all("[data-own-clear]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = itemById(b.getAttribute("data-own-clear"));
        formDialog({ title: "Remove " + i.student_name + "’s own deadline?", sub: "They will follow the " + i.office_name + " deadline again.", fields: "", submit: "Remove", danger: true,
          onSubmit: function () { return api("item-deadline", { item_id: i.item_id, due_at: null }).then(function () { toast("Removed."); return loadDeadlines(); }); } });
      });
    });
  }

  /* ---------- Boot ---------- */
  var renderers = { dashboard: renderDashboard, requirements: renderRequirements, status: renderStatus };

  if (page === "login") setupLogin();
  else if (page === "apply") setupApply();
  else if (page === "app-status") setupAppStatus();
  else if (page === "change-password") setupChangePassword();
  else if (page === "forgot") setupForgot();
  else if (page === "reset") setupReset();
  else if (renderers[page]) {
    loadProfile(["student"]).then(function (p) { studentProfile = p; renderers[page](p); }).catch(showPageError);
  } else if (page === "profile") {
    loadProfile(["student", "staff", "admin"]).then(renderProfile).catch(showPageError);
  } else if (page === "staff") {
    topSearch(function (v) { pending.q = v; pending.page = 1; if (pending.data) drawPending(); });
    loadProfile(["staff", "admin"]).then(function (p) { pending.profile = p; return loadPending(); }).catch(showPageError);
  } else if (page === "review") {
    var rid = new URLSearchParams(location.search).get("id");
    loadProfile(["staff", "admin"]).then(function (p) {
      review.profile = p;
      if (!rid) { location.replace("staff.html"); return; }
      return api("submission", undefined, "&id=" + encodeURIComponent(rid)).then(function (sub) {
        review.sub = sub;
        drawReview();
      });
    }).catch(showPageError);
  } else if (page === "applications") {
    topSearch(function (v) { appsState.q = v; if (appsState.data && !new URLSearchParams(location.search).get("id")) drawApps(); });
    loadProfile(["staff", "admin"]).then(function (p) {
      appsState.profile = p;
      if (!canManageApps(p)) { location.replace("staff.html"); return; }
      return loadApps();
    }).catch(showPageError);
  } else if (page === "messages") {
    topSearch(function (v) { threads.q = v; if (threads.profile) drawThreads(); });
    loadProfile(["staff", "admin"]).then(function (p) {
      threads.profile = p;
      return loadThreads().then(function () {
        var openItem = new URLSearchParams(location.search).get("item");
        if (openItem) openChat(openItem, loadThreads);
      });
    }).catch(showPageError);
  } else if (page === "history") {
    topSearch(function (v) { hist.q = v; if (hist.profile) drawHistory(); });
    loadProfile(["staff", "admin"]).then(function (p) { hist.profile = p; return loadHistory(); }).catch(showPageError);
  } else if (page === "deadlines") {
    loadProfile(["staff", "admin"]).then(function (p) { dl.profile = p; return loadDeadlines(); }).catch(showPageError);
  } else if (page === "reports") {
    loadProfile(["staff", "admin"]).then(function (p) {
      rep.profile = p;
      if (!canManageApps(p)) { location.replace("staff.html"); return; }
      return loadReports();
    }).catch(showPageError);
  } else if (page === "audit") {
    topSearch(function (v) { audit.q = v; if (audit.data) drawAudit(); });
    loadProfile(["staff", "admin"]).then(function (p) {
      audit.profile = p;
      if (!canManageApps(p)) { location.replace("staff.html"); return; }
      return loadAudit();
    }).catch(showPageError);
  } else if (page === "settings") {
    var wantTab = new URLSearchParams(location.search).get("tab");
    if (["offices", "programs", "years", "backups"].indexOf(wantTab) !== -1) sett.tab = wantTab;
    loadProfile(["admin"]).then(function (p) { sett.profile = p; return loadSettings(); }).catch(showPageError);
  } else if (page === "staff-accounts") {
    topSearch(function (v) { acct.q = v; if (acct.rows) drawAccounts(); });
    loadProfile(["admin"]).then(function (p) { acct.profile = p; return loadAccounts(); }).catch(showPageError);
  } else if (page === "office-status") {
    setupEditor();
    var search = $("form.search");
    if (search) {
      var queueSearch = $("input", search);
      search.addEventListener("submit", function (e) { e.preventDefault(); });
      queueSearch.addEventListener("input", function () {
        staffState.q = queueSearch.value.trim();
        if (staffState.profile) drawQueue();
      });
    }
    loadProfile(["staff", "admin"]).then(function (p) {
      staffState.profile = p;
      renderStaffShell(p);
      loadQueue();
    }).catch(showPageError);
  }
})();

/* =========================================================================
   Dark mode switch (top bar). The choice is remembered in this browser.
   ========================================================================= */
(function () {
  "use strict";
  var KEY = "cg-theme";
  var rootEl = document.documentElement;
  function current() { return rootEl.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function apply(theme) {
    if (theme === "dark") rootEl.setAttribute("data-theme", "dark"); else rootEl.removeAttribute("data-theme");
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.querySelectorAll("[data-theme-toggle]").forEach(label);
  }
  function label(btn) {
    var dark = current() === "dark";
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = dark ? "Light mode" : "Dark mode";
  }
  var actions = document.querySelector(".topbar__actions");
  if (!actions || actions.querySelector("[data-theme-toggle]")) return;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn theme-toggle";
  btn.setAttribute("data-theme-toggle", "");
  btn.innerHTML =
    '<svg class="icon icon--moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>' +
    '<svg class="icon icon--sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  label(btn);
  btn.addEventListener("click", function () { apply(current() === "dark" ? "light" : "dark"); });
  actions.insertBefore(btn, actions.firstChild);
  window.addEventListener("storage", function (e) { if (e.key === KEY) { if (e.newValue === "dark") rootEl.setAttribute("data-theme", "dark"); else rootEl.removeAttribute("data-theme"); label(btn); } });
})();
