// src/routes/coupons.js
// คูปองอาหาร + น้ำ แบบรายทีม
// - 1 ทีม ต่อ 1 วัน = 1 QR (โค้ช / ผู้คุมทีม เป็นคนถือและมารับแทนทั้งทีม)
// - จำนวนชุด = นักเรียนที่ Check-in แล้ว + โค้ช 1 ชุด (ทุกทีม)
// - โค้ชคนเดียวดูแลหลายทีม → นับโค้ช 1 ชุดในทุกทีม (เช่น 2 ทีม = ทีมละ 4 ชุด)
//
// ต้องติดตั้งก่อน:  npm install qrcode
//
// app.js (หลัง app.use(viewerGuard) และก่อน app.use("/board", ...)):
//   const coupons = require("./routes/coupons");
//   app.use("/coupons", coupons.staffRouter);        // หน้าสแกน (admin + viewer)
//   app.use("/board/coupons", coupons.adminRouter);  // หลังบ้าน (admin)

const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const ExcelJS = require("exceljs");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const { requirePerm } = require("../utils/permissions");

const adminRouter = express.Router();
const staffRouter = express.Router();

// ============================================================================
// CONSTANTS / HELPERS
// ============================================================================

const COUPON_LABEL = "อาหาร + น้ำ";
const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RESET_WORD = "ล้างคูปอง";
const MAX_DAYS = 3;

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

function cleanText(v, max) {
  return String(first(v) ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function generateCode() {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return s.slice(0, 4) + "-" + s.slice(4);
}

function normalizeCode(v) {
  const raw = String(first(v) ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 8) return "";
  return raw.slice(0, 4) + "-" + raw.slice(4);
}

function normalizeName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ");
}

function coachKey(team) {
  return normalizeName(team && team.coach).toLowerCase();
}

function isIsoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );
}

function dayLabel(iso) {
  if (!isIsoDate(iso)) return iso || "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortDayLabel(iso) {
  if (!isIsoDate(iso)) return iso || "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

function formatThaiTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClock(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json")
  );
}

function studentsOf(team) {
  const list = [];
  for (let i = 1; i <= 3; i++) {
    const name = normalizeName(team["student_" + i]);
    if (name) {
      list.push({
        number: i,
        name,
        checkedIn: Boolean(team["student_" + i + "_checked_in"]),
      });
    }
  }
  return list;
}

// ============================================================================
// TABLE (สร้างอัตโนมัติ)
// ============================================================================

async function ensureTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS team_coupons (
      id SERIAL PRIMARY KEY,
      code VARCHAR(12) NOT NULL,
      team_id VARCHAR(20) NOT NULL,
      coupon_day VARCHAR(10) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'active',
      students_given SMALLINT,
      coach_given BOOLEAN,
      used_at TIMESTAMPTZ,
      used_by VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
  );

  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS team_coupons_code_uq ON team_coupons (code)",
    [],
  );

  // 1 ทีม ต่อ 1 วัน มีคูปองที่ยังไม่ถูกยกเลิกได้ใบเดียว
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS team_coupons_team_day_uq
       ON team_coupons (team_id, coupon_day)
       WHERE status <> 'void'`,
    [],
  );

  console.log("[coupons] ตาราง team_coupons พร้อมใช้งาน");
}

const tableReady = ensureTable().catch((err) => {
  console.error("[coupons] สร้างตารางไม่สำเร็จ:", err.message);
});

// ============================================================================
// SETTINGS
// ============================================================================

async function getSettingsMap() {
  const r = await query("SELECT key, value FROM settings", []);
  const map = {};
  r.rows.forEach((row) => {
    map[row.key] = row.value;
  });
  return map;
}

function resolveDays(settings) {
  const own = String(settings.coupon_days || "")
    .split(",")
    .map((s) => s.trim())
    .filter(isIsoDate);
  if (own.length) return own.slice(0, MAX_DAYS);

  const start = settings.event_date;
  const end = settings.event_date_end || settings.event_date;
  if (!isIsoDate(start) || !isIsoDate(end)) return [];

  const days = [];
  const [y, m, d] = start.split("-").map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < MAX_DAYS; i++) {
    const iso = cur.toISOString().slice(0, 10);
    if (iso > end) break;
    days.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

async function getCouponConfig() {
  const settings = await getSettingsMap();
  return {
    days: resolveDays(settings),
    strictDay: settings.coupon_strict_day !== "0",
  };
}

async function saveSetting(key, value) {
  await query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, value],
  );
}

// ============================================================================
// GENERATE (สร้างเฉพาะใบที่ยังไม่มี · ข้ามทีมที่ไม่อนุมัติ)
// ============================================================================

async function insertCoupon(teamId, day) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await query(
        "INSERT INTO team_coupons (code, team_id, coupon_day) VALUES ($1, $2, $3)",
        [generateCode(), teamId, day],
      );
      return true;
    } catch (err) {
      if (err.code !== "23505") throw err;
      if (err.constraint === "team_coupons_code_uq") continue; // รหัสชน → สุ่มใหม่
      return false; // ทีมนี้มีคูปองของวันนี้แล้ว
    }
  }
  return false;
}

async function generateCoupons(days, teamIds) {
  if (!days.length) return { created: 0 };

  const teamsResult = teamIds
    ? await query(
        "SELECT id FROM teams WHERE id = ANY($1) AND status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
        [teamIds],
      )
    : await query(
        "SELECT id FROM teams WHERE status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
        [],
      );

  const existing = await query(
    "SELECT team_id, coupon_day FROM team_coupons WHERE status <> 'void' AND coupon_day = ANY($1)",
    [days],
  );
  const have = new Set(
    existing.rows.map((r) => r.team_id + "|" + r.coupon_day),
  );

  let created = 0;
  for (const t of teamsResult.rows) {
    for (const day of days) {
      if (have.has(t.id + "|" + day)) continue;
      if (await insertCoupon(t.id, day)) created++;
    }
  }
  return { created };
}

// ============================================================================
// ACCESS
// ============================================================================

function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  if (wantsJson(req))
    return res.status(403).json({ ok: false, message: "เฉพาะผู้ดูแลระบบ" });
  req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

function requireScanner(req, res, next) {
  const user = req.session && req.session.user;
  if (user && (user.role === "admin" || user.role === "viewer")) return next();
  if (wantsJson(req))
    return res.status(403).json({ ok: false, message: "ไม่มีสิทธิ์สแกนคูปอง" });
  req.flash("error", "ไม่มีสิทธิ์สแกนคูปอง");
  return res.redirect("/board");
}

// สิทธิ์ (utils/permissions.js):
//   coupons.scan    สแกน / แลกคูปอง            → แอดมิน, สตาฟสวัสดิการ
//   coupons.reissue ออกคูปองใบใหม่ (คูปองหาย)    → แอดมิน, สตาฟสวัสดิการ
//   coupons.view    ดูตารางคูปอง / Excel         → แอดมิน, สตาฟสวัสดิการ, สตาฟไอที
//   coupons.print   สร้าง / พิมพ์คูปอง           → แอดมิน, สตาฟไอที
//   coupons.manage  ตั้งค่าวัน / ล้างคูปอง        → แอดมิน
adminRouter.use(requireLogin);
staffRouter.use(requireLogin);
const PERM_SCAN = requirePerm("coupons.scan");
const PERM_REISSUE = requirePerm("coupons.reissue");
const PERM_PRINT = requirePerm("coupons.print");
const PERM_VIEW = requirePerm("coupons.view");
const PERM_MANAGE = requirePerm("coupons.manage");

// ============================================================================
// STAFF: GET /coupons/scan
// ============================================================================

async function todayStats(today) {
  const r = await query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'void')::int AS teams,
            COUNT(*) FILTER (WHERE status = 'used')::int AS redeemed,
            COALESCE(SUM(CASE WHEN status = 'used'
                              THEN COALESCE(students_given, 0) + CASE WHEN coach_given THEN 1 ELSE 0 END
                              ELSE 0 END), 0)::int AS meals
     FROM team_coupons WHERE coupon_day = $1`,
    [today],
  );
  return r.rows[0] || { teams: 0, redeemed: 0, meals: 0 };
}

staffRouter.get("/", PERM_SCAN, (req, res) => res.redirect("/coupons/scan"));

staffRouter.get("/scan", PERM_SCAN, async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();
    const today = todayBangkok();

    return res.render("coupons/scan", {
      layout: false,
      couponLabel: COUPON_LABEL,
      todayLabel: dayLabel(today),
      isCouponDay: config.days.includes(today),
      strictDay: config.strictDay,
      stats: await todayStats(today),
      user: req.session.user,
      notice: cleanText(req.query.msg, 200),
      noticeOk: req.query.ok === "1",
    });
  } catch (err) {
    console.error("Coupon scan page error:", err);
    return res.status(500).send("ไม่สามารถเปิดหน้าสแกนคูปองได้");
  }
});

// ============================================================================
// STAFF: POST /coupons/redeem  (JSON)
// ============================================================================

function baseView(c, team) {
  return {
    code: c.code,
    teamId: c.team_id,
    team: team ? team.name : c.team_id,
    coach: team ? normalizeName(team.coach) : "",
    day: shortDayLabel(c.coupon_day),
    usedAt: formatThaiTime(c.used_at),
    usedBy: c.used_by || "",
    studentsGiven: c.students_given,
    coachGiven: c.coach_given,
    meals: (c.students_given || 0) + (c.coach_given ? 1 : 0),
  };
}

staffRouter.post("/redeem", PERM_SCAN, async (req, res) => {
  const code = normalizeCode(req.body.code);

  if (!code) {
    return res.json({
      ok: false,
      reason: "invalid",
      message: "รหัสคูปองไม่ถูกต้อง",
    });
  }

  try {
    await tableReady;

    const found = await query(
      "SELECT * FROM team_coupons WHERE code = $1 LIMIT 1",
      [code],
    );
    const c = found.rows[0];
    if (!c) {
      return res.json({
        ok: false,
        reason: "not_found",
        message: "ไม่พบคูปองนี้ในระบบ",
      });
    }

    const teamResult = await query(
      "SELECT * FROM teams WHERE id = $1 LIMIT 1",
      [c.team_id],
    );
    const team = teamResult.rows[0];
    if (!team) {
      return res.json({
        ok: false,
        reason: "not_found",
        message: "ไม่พบทีมของคูปองนี้",
      });
    }

    const view = baseView(c, team);

    if (c.status === "void") {
      return res.json({
        ok: false,
        reason: "void",
        message: "คูปองนี้ถูกยกเลิกแล้ว (ออกใบใหม่ให้แล้ว)",
        coupon: view,
      });
    }

    if (c.status === "used") {
      return res.json({
        ok: false,
        reason: "used",
        message:
          "รับไปแล้ว " +
          view.meals +
          " ชุด เมื่อ " +
          view.usedAt +
          (view.usedBy ? " โดย " + view.usedBy : ""),
        coupon: view,
      });
    }

    const config = await getCouponConfig();
    const today = todayBangkok();

    if (config.strictDay && c.coupon_day !== today) {
      return res.json({
        ok: false,
        reason: "wrong_day",
        message: "เป็นคูปองของ" + dayLabel(c.coupon_day) + " ใช้วันนี้ไม่ได้",
        coupon: view,
      });
    }

    const students = studentsOf(team);
    const present = students.filter((s) => s.checkedIn);
    const absent = students.filter((s) => !s.checkedIn);

    if (!present.length) {
      return res.json({
        ok: false,
        reason: "not_checked_in",
        message:
          "ทีมนี้ยังไม่มีนักเรียน Check-in ให้ไปลงทะเบียนที่โต๊ะ Check-in ก่อน",
        coupon: view,
      });
    }

    // นับโค้ชในทุกทีม แม้เป็นโค้ชคนเดียวกันหลายทีม
    const hasCoach = Boolean(coachKey(team));
    const coachGiven = hasCoach;

    const user = req.session.user || {};
    const usedBy = String(user.name || user.username || "").slice(0, 100);

    // ใช้ได้ครั้งเดียว: อัปเดตเฉพาะใบที่ยัง active (กันสแกนพร้อมกันหลายเครื่อง)
    const updated = await query(
      `UPDATE team_coupons
       SET status = 'used', used_at = NOW(), used_by = $2, students_given = $3, coach_given = $4
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [c.id, usedBy, present.length, coachGiven],
    );

    if (!updated.rows.length) {
      const again = await query("SELECT * FROM team_coupons WHERE id = $1", [
        c.id,
      ]);
      const v2 = baseView(again.rows[0], team);
      return res.json({
        ok: false,
        reason: "used",
        message:
          "รับไปแล้ว " +
          v2.meals +
          " ชุด เมื่อ " +
          v2.usedAt +
          (v2.usedBy ? " โดย " + v2.usedBy : ""),
        coupon: v2,
      });
    }

    const v = baseView(updated.rows[0], team);
    v.present = present.map((s) => s.name);
    v.absent = absent.map((s) => s.name);
    v.coachNote = hasCoach ? "" : "ทีมนี้ไม่มีชื่อโค้ช";

    return res.json({
      ok: true,
      message: "ให้ " + COUPON_LABEL + " " + v.meals + " ชุด",
      coupon: v,
    });
  } catch (err) {
    console.error("Coupon redeem error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        reason: "error",
        message: "ระบบขัดข้อง กรุณาสแกนอีกครั้ง",
      });
  }
});

// ============================================================================
// ADMIN: GET /board/coupons
// ============================================================================

adminRouter.get("/", PERM_VIEW, async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";

    const [dayStatsResult, teamsResult, couponsResult, recentResult] =
      await Promise.all([
        query(
          `SELECT coupon_day,
                COUNT(*) FILTER (WHERE status <> 'void')::int AS teams,
                COUNT(*) FILTER (WHERE status = 'used')::int AS redeemed,
                COALESCE(SUM(CASE WHEN status = 'used'
                                  THEN COALESCE(students_given, 0) + CASE WHEN coach_given THEN 1 ELSE 0 END
                                  ELSE 0 END), 0)::int AS meals
         FROM team_coupons GROUP BY coupon_day`,
          [],
        ),
        query(`SELECT * FROM teams WHERE tier = $1 ORDER BY created_at ASC`, [
          tier,
        ]),
        query(
          `SELECT tc.* FROM team_coupons tc
         JOIN teams t ON t.id = tc.team_id
         WHERE t.tier = $1 AND tc.status <> 'void'`,
          [tier],
        ),
        query(
          `SELECT tc.*, t.name AS team_name, t.coach FROM team_coupons tc
         LEFT JOIN teams t ON t.id = tc.team_id
         WHERE tc.status = 'used'
         ORDER BY tc.used_at DESC LIMIT 15`,
          [],
        ),
      ]);

    const statsByDay = {};
    dayStatsResult.rows.forEach((r) => {
      statsByDay[r.coupon_day] = r;
    });

    const couponMap = {};
    couponsResult.rows.forEach((c) => {
      couponMap[c.team_id + "|" + c.coupon_day] = c;
    });

    const teams = teamsResult.rows.map((t) => {
      const students = studentsOf(t);
      return {
        id: t.id,
        name: t.name,
        coach: normalizeName(t.coach),
        status: t.status,
        studentCount: students.length,
        checkedIn: students.filter((s) => s.checkedIn).length,
        days: config.days.map((d) => {
          const c = couponMap[t.id + "|" + d];
          if (!c) return { state: "none" };
          if (c.status === "used") {
            return {
              state: "used",
              meals: (c.students_given || 0) + (c.coach_given ? 1 : 0),
              time: formatClock(c.used_at),
            };
          }
          return { state: "active" };
        }),
      };
    });

    return res.render("coupons/admin", {
      title: "คูปอง",
      pageTitle: "<span>คูปอง</span>อาหาร + น้ำ",
      tierSelector: true,
      activeTier: tier,
      tier,
      tierLabel: TIER_LABEL[tier],
      couponLabel: COUPON_LABEL,
      days: config.days,
      strictDay: config.strictDay,
      dayLabel,
      shortDayLabel,
      statsByDay,
      teams,
      recent: recentResult.rows.map((r) => ({
        teamId: r.team_id,
        team: r.team_name || r.team_id,
        coach: normalizeName(r.coach),
        meals: (r.students_given || 0) + (r.coach_given ? 1 : 0),
        day: shortDayLabel(r.coupon_day),
        usedAt: formatThaiTime(r.used_at),
        usedBy: r.used_by || "",
      })),
      resetWord: RESET_WORD,
      today: todayBangkok(),
    });
  } catch (err) {
    console.error("Coupon admin error:", err);
    req.flash("error", "โหลดข้อมูลคูปองไม่ได้");
    return res.redirect("/board");
  }
});

// ---------------- POST /board/coupons/settings ----------------

adminRouter.post("/settings", PERM_MANAGE, async (req, res) => {
  try {
    const days = [req.body.day1, req.body.day2, req.body.day3]
      .map((d) => cleanText(d, 10))
      .filter(isIsoDate);
    await saveSetting(
      "coupon_days",
      Array.from(new Set(days)).sort().join(","),
    );
    await saveSetting(
      "coupon_strict_day",
      first(req.body.strict_day) === "1" ? "1" : "0",
    );
    req.flash("success", "บันทึกการตั้งค่าคูปองแล้ว");
  } catch (err) {
    console.error("Coupon settings error:", err);
    req.flash("error", "บันทึกไม่สำเร็จ");
  }
  return res.redirect("/board/coupons");
});

// ---------------- POST /board/coupons/generate ----------------

adminRouter.post("/generate", PERM_PRINT, async (req, res) => {
  const back =
    "/board/coupons" +
    (TIERS.includes(req.query.tier) ? "?tier=" + req.query.tier : "");
  try {
    await tableReady;
    const config = await getCouponConfig();
    if (!config.days.length) {
      req.flash("error", "กรุณาตั้งวันที่แจกคูปองก่อน");
      return res.redirect(back);
    }
    const { created } = await generateCoupons(config.days, null);
    req.flash(
      "success",
      created
        ? "สร้างคูปองเพิ่ม " + created + " ใบ"
        : "คูปองครบทุกทีมแล้ว ไม่มีใบที่ต้องสร้างเพิ่ม",
    );
  } catch (err) {
    console.error("Coupon generate error:", err);
    req.flash("error", "สร้างคูปองไม่สำเร็จ");
  }
  return res.redirect(back);
});

// ---------------- GET /board/coupons/print?team=ID | ?tier=beginner ----------------

async function printHandler(req, res) {
  try {
    await tableReady;
    const config = await getCouponConfig();
    if (!config.days.length) {
      req.flash("error", "กรุณาตั้งวันที่แจกคูปองก่อน");
      return res.redirect("/board/coupons");
    }

    const teamId = cleanText(req.query.team, 20);
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";

    const teamsResult = teamId
      ? await query("SELECT * FROM teams WHERE id = $1", [teamId])
      : await query(
          "SELECT * FROM teams WHERE tier = $1 AND status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
          [tier],
        );

    const teams = teamsResult.rows;
    if (!teams.length) {
      req.flash("error", "ไม่พบทีม");
      return res.redirect("/board/coupons");
    }

    await generateCoupons(
      config.days,
      teams.map((t) => t.id),
    );

    const couponsResult = await query(
      `SELECT * FROM team_coupons
       WHERE status <> 'void' AND team_id = ANY($1) AND coupon_day = ANY($2)`,
      [teams.map((t) => t.id), config.days],
    );
    const couponMap = {};
    couponsResult.rows.forEach((c) => {
      couponMap[c.team_id + "|" + c.coupon_day] = c;
    });

    // 1 สติกเกอร์ = 1 ทีม (รวม QR ทุกวันไว้ในดวงเดียว)
    const stickers = [];
    for (const t of teams) {
      const students = studentsOf(t).map((s) => s.name);
      const coach = normalizeName(t.coach);
      const dayItems = [];

      for (let i = 0; i < config.days.length; i++) {
        const d = config.days[i];
        const c = couponMap[t.id + "|" + d];
        if (!c) continue;
        const [y, m, dd] = d.split("-").map(Number);
        dayItems.push({
          index: i + 1,
          weekday: new Date(y, m - 1, dd).toLocaleDateString("th-TH", {
            weekday: "short",
          }),
          date: shortDayLabel(d),
          code: c.code,
          used: c.status === "used",
          qr: await QRCode.toString(c.code, {
            type: "svg",
            margin: 0,
            errorCorrectionLevel: "M",
          }),
        });
      }

      if (!dayItems.length) continue;

      stickers.push({
        tier: t.tier,
        teamId: t.id,
        team: t.name,
        institution: t.institution || "",
        tierLabel: TIER_LABEL[t.tier] || t.tier,
        coach,
        students,
        maxMeals: students.length + (coach ? 1 : 0),
        days: dayItems,
      });
    }

    // layout: a4 = A4 แผ่นละ 4 ดวง / label = 1 ดวงต่อหน้า (10×14 ซม.)
    // side:   back = คูปอง / front = ป้ายชื่อ / duplex = หน้า+หลัง สลับหน้ากัน (พิมพ์ 2 หน้า)
    const layout = req.query.layout === "label" ? "label" : "a4";
    const side = ["front", "back", "duplex"].includes(req.query.side)
      ? req.query.side
      : "back";
    const pages = buildPages(stickers, layout, side);

    const baseQuery = teamId
      ? "team=" + encodeURIComponent(teamId)
      : "tier=" + tier;
    const url = (l, sd) =>
      req.baseUrl + "/print?" + baseQuery + "&layout=" + l + "&side=" + sd;

    return res.render("coupons/print", {
      layout: false,
      couponLabel: COUPON_LABEL,
      pages,
      stickerCount: stickers.length,
      teamCount: teams.length,
      sheetLayout: layout,
      side,
      links: {
        a4: url("a4", side),
        label: url("label", side),
        back: url(layout, "back"),
        front: url(layout, "front"),
        duplex: url(layout, "duplex"),
      },
      backUrl:
        req.baseUrl === "/coupons"
          ? "/coupons/scan"
          : "/board/coupons?tier=" + (teams[0].tier || "beginner"),
    });
  } catch (err) {
    console.error("Coupon print error:", err);
    req.flash("error", "สร้างหน้าพิมพ์คูปองไม่สำเร็จ");
    return res.redirect("/board/coupons");
  }
}

// จัดหน้าพิมพ์
// A4 แผ่นละ 4 ดวง (2 คอลัมน์ × 2 แถว) — ด้านหลังสลับซ้าย/ขวา
// เพื่อให้ตรงกับด้านหน้าเมื่อพิมพ์ 2 หน้าแบบพลิกด้านยาว (Flip on long edge)
function buildPages(stickers, layout, side) {
  const pages = [];

  if (layout === "label") {
    stickers.forEach((s) => {
      if (side === "front" || side === "duplex")
        pages.push({ side: "front", cells: [s] });
      if (side === "back" || side === "duplex")
        pages.push({ side: "back", cells: [s] });
    });
    return pages;
  }

  for (let i = 0; i < stickers.length; i += 4) {
    const g = [0, 1, 2, 3].map((k) => stickers[i + k] || null);
    if (side === "front" || side === "duplex")
      pages.push({ side: "front", cells: g });
    if (side === "back" || side === "duplex")
      pages.push({ side: "back", cells: [g[1], g[0], g[3], g[2]] });
  }
  return pages;
}

adminRouter.get("/print", PERM_PRINT, printHandler);

// สตาฟสวัสดิการ: พิมพ์คูปองใบใหม่ของทีมเดียว (หลังออกใบใหม่)
staffRouter.get("/print", PERM_REISSUE, (req, res) => {
  if (!cleanText(req.query.team, 20)) return res.redirect("/coupons/scan");
  return printHandler(req, res);
});

// ---------------- POST /coupons/reissue-team (สตาฟสวัสดิการ) ----------------
// คูปองหาย / ชำรุด: ยกเลิกคูปองที่ยังไม่ได้ใช้ของทีม แล้วออกใบใหม่ (ใบที่ใช้แล้วคงไว้)

staffRouter.post("/reissue-team", PERM_REISSUE, async (req, res) => {
  const teamId = cleanText(req.body.team, 20).toUpperCase();
  const backMsg = (msg, ok) =>
    res.redirect(
      "/coupons/scan?msg=" + encodeURIComponent(msg) + (ok ? "&ok=1" : ""),
    );

  if (!teamId) return backMsg("กรุณาใส่รหัสทีม");

  try {
    await tableReady;
    const teamResult = await query("SELECT * FROM teams WHERE UPPER(id) = $1", [
      teamId,
    ]);
    const team = teamResult.rows[0];
    if (!team) return backMsg("ไม่พบทีม " + teamId);
    if (team.status === "rejected")
      return backMsg("ทีม " + team.id + " ไม่ได้รับอนุมัติ ไม่มีคูปอง");

    const voided = await query(
      "UPDATE team_coupons SET status = 'void' WHERE team_id = $1 AND status = 'active' RETURNING coupon_day",
      [team.id],
    );
    if (!voided.rows.length) {
      return backMsg(
        "ทีม " +
          team.id +
          " ไม่มีคูปองที่ยังไม่ได้ใช้ (ใช้ครบแล้ว หรือยังไม่ได้สร้างคูปอง)",
      );
    }

    for (const row of voided.rows) await insertCoupon(team.id, row.coupon_day);

    const user = req.session.user || {};
    console.log(
      "[coupons] ออกใบใหม่ทีม",
      team.id,
      voided.rows.length,
      "ใบ โดย",
      user.username,
    );
    return res.redirect(
      "/coupons/print?team=" +
        encodeURIComponent(team.id) +
        "&layout=label&side=back",
    );
  } catch (err) {
    console.error("Coupon reissue-team error:", err);
    return backMsg("ออกใบใหม่ไม่สำเร็จ ลองอีกครั้ง");
  }
});

// ---------------- POST /board/coupons/reissue ----------------

adminRouter.post("/reissue", PERM_REISSUE, async (req, res) => {
  const code = normalizeCode(req.body.code);
  if (!code) {
    req.flash("error", "รหัสคูปองไม่ถูกต้อง");
    return res.redirect("/board/coupons");
  }

  try {
    await tableReady;
    const found = await query("SELECT * FROM team_coupons WHERE code = $1", [
      code,
    ]);
    const c = found.rows[0];

    if (!c) {
      req.flash("error", "ไม่พบคูปอง " + code);
      return res.redirect("/board/coupons");
    }
    if (c.status !== "active") {
      req.flash(
        "error",
        "คูปอง " +
          code +
          (c.status === "used" ? " ถูกใช้ไปแล้ว" : " ถูกยกเลิกไปแล้ว") +
          " ออกใบใหม่ไม่ได้",
      );
      return res.redirect("/board/coupons");
    }

    await query("UPDATE team_coupons SET status = 'void' WHERE id = $1", [
      c.id,
    ]);
    await insertCoupon(c.team_id, c.coupon_day);

    req.flash(
      "success",
      "ยกเลิก " + code + " และออกใบใหม่ให้ทีม " + c.team_id + " แล้ว",
    );
    return res.redirect(
      "/board/coupons/print?team=" + encodeURIComponent(c.team_id),
    );
  } catch (err) {
    console.error("Coupon reissue error:", err);
    req.flash("error", "ออกใบใหม่ไม่สำเร็จ");
    return res.redirect("/board/coupons");
  }
});

// ---------------- GET /board/coupons/export ----------------

adminRouter.get("/export", PERM_VIEW, async (req, res) => {
  try {
    await tableReady;
    const result = await query(
      `SELECT tc.*, t.name AS team_name, t.tier, t.coach
       FROM team_coupons tc LEFT JOIN teams t ON t.id = tc.team_id
       ORDER BY tc.coupon_day, t.tier, tc.team_id`,
      [],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "Robo Challenge League";
    const ws = wb.addWorksheet("คูปองรายทีม");

    ws.columns = [
      { header: "วันที่", key: "day", width: 12 },
      { header: "รหัสคูปอง", key: "code", width: 13 },
      { header: "รุ่น", key: "tier", width: 13 },
      { header: "ทีม", key: "team_id", width: 10 },
      { header: "ชื่อทีม", key: "team_name", width: 28 },
      { header: "โค้ช", key: "coach", width: 26 },
      { header: "สถานะ", key: "status", width: 11 },
      { header: "นักเรียน (ชุด)", key: "students", width: 13 },
      { header: "โค้ช (ชุด)", key: "coach_meal", width: 10 },
      { header: "รวม (ชุด)", key: "meals", width: 10 },
      { header: "เวลาที่รับ", key: "used_at", width: 18 },
      { header: "ผู้สแกน", key: "used_by", width: 18 },
    ];

    result.rows.forEach((r) => {
      const used = r.status === "used";
      ws.addRow({
        day: shortDayLabel(r.coupon_day),
        code: r.code,
        tier: TIER_LABEL[r.tier] || r.tier || "",
        team_id: r.team_id,
        team_name: r.team_name || "",
        coach: normalizeName(r.coach),
        status: used ? "รับแล้ว" : r.status === "void" ? "ยกเลิก" : "ยังไม่รับ",
        students: used ? r.students_given || 0 : "",
        coach_meal: used ? (r.coach_given ? 1 : 0) : "",
        meals: used ? (r.students_given || 0) + (r.coach_given ? 1 : 0) : "",
        used_at: formatThaiTime(r.used_at),
        used_by: r.used_by || "",
      });
    });

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    };
    header.alignment = { vertical: "middle", horizontal: "center" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "L1" };

    const date = new Date().toISOString().slice(0, 10);
    const thaiName = `RCL_คูปอง_${date}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="RCL_coupons_${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(thaiName)}`,
    );

    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("Coupon export error:", err);
    if (!res.headersSent) return res.status(500).send("ส่งออกไม่สำเร็จ");
  }
});

// ---------------- POST /board/coupons/reset ----------------

adminRouter.post("/reset", PERM_MANAGE, async (req, res) => {
  try {
    if (cleanText(req.body.confirm_text, 50) !== RESET_WORD) {
      req.flash(
        "error",
        'พิมพ์คำว่า "' +
          RESET_WORD +
          '" ให้ถูกต้องเพื่อยืนยัน — ยังไม่ได้ลบคูปอง',
      );
      return res.redirect("/board/coupons");
    }

    await tableReady;
    const count = await query(
      "SELECT COUNT(*)::int AS cnt FROM team_coupons",
      [],
    );
    await query("TRUNCATE team_coupons RESTART IDENTITY", []);

    const n = count.rows[0] ? count.rows[0].cnt : 0;
    console.log(
      "[coupons] ล้างคูปองทั้งหมด",
      n,
      "ใบ โดย",
      req.session.user && req.session.user.username,
    );
    req.flash(
      "success",
      "ลบคูปองทั้งหมดแล้ว (" + n + " ใบ) — กดสร้างคูปองใหม่ก่อนพิมพ์",
    );
  } catch (err) {
    console.error("Coupon reset error:", err);
    req.flash("error", "ลบคูปองไม่สำเร็จ");
  }
  return res.redirect("/board/coupons");
});

module.exports = { adminRouter, staffRouter };
