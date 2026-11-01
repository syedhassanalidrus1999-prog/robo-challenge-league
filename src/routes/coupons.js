// src/routes/coupons.js
// ระบบคูปองอาหาร + น้ำ (1 ใบ ต่อคน ต่อวัน) สำหรับนักเรียนและโค้ช
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

// ตัดตัวที่สับสนกันออก (0/O, 1/I/L)
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

// รับได้ทั้ง "k7m2 qx9p", "K7M2QX9P", "K7M2-QX9P"
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

function isIsoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

// วันนี้ตามเวลาไทย เป็น YYYY-MM-DD
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

function wantsJson(req) {
  return (
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json")
  );
}

// ============================================================================
// TABLE (สร้างอัตโนมัติ)
// ============================================================================

async function ensureTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code VARCHAR(12) NOT NULL,
      team_id VARCHAR(20) NOT NULL,
      holder_type VARCHAR(10) NOT NULL,
      student_number SMALLINT,
      holder_key VARCHAR(250) NOT NULL,
      holder_name VARCHAR(200) NOT NULL,
      coupon_day VARCHAR(10) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'active',
      used_at TIMESTAMPTZ,
      used_by VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
  );

  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_uq ON coupons (code)",
    [],
  );

  // 1 คน ต่อ 1 วัน มีคูปองที่ยังไม่ถูกยกเลิกได้ใบเดียว
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS coupons_holder_day_uq
       ON coupons (holder_key, coupon_day)
       WHERE status <> 'void'`,
    [],
  );

  await query(
    "CREATE INDEX IF NOT EXISTS coupons_team_idx ON coupons (team_id)",
    [],
  );

  console.log("[coupons] ตาราง coupons พร้อมใช้งาน");
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

// วันที่แจกคูปอง: ตั้งเองในหน้าคูปอง หรือใช้วันงานจากหน้าตั้งค่า
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
    // "0" = ใช้คูปองข้ามวันได้ (สำหรับทดสอบ)
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
// GENERATE
// ============================================================================
//
// สร้างเฉพาะใบที่ยังไม่มี (กดซ้ำได้ ไม่สร้างซ้ำ)
// - นักเรียน: ทุกชื่อในทีม
// - โค้ช: นับตามชื่อ (โค้ช 1 คนดูแลหลายทีม ได้คูปองชุดเดียว)
// - ข้ามทีมที่ "ไม่อนุมัติ"

function holdersOfTeam(team) {
  const list = [];
  for (let i = 1; i <= 3; i++) {
    const name = normalizeName(team["student_" + i]);
    if (name) {
      list.push({
        team_id: team.id,
        holder_type: "student",
        student_number: i,
        holder_key: "S:" + team.id + ":" + i,
        holder_name: name,
      });
    }
  }
  const coach = normalizeName(team.coach);
  if (coach) {
    list.push({
      team_id: team.id,
      holder_type: "coach",
      student_number: null,
      holder_key: "C:" + coach.toLowerCase(),
      holder_name: coach,
    });
  }
  return list;
}

async function generateCoupons(days, teamIds) {
  if (!days.length) return { created: 0 };

  const teamsResult = teamIds
    ? await query(
        "SELECT * FROM teams WHERE id = ANY($1) AND COALESCE(status, '') <> 'rejected' ORDER BY created_at ASC",
        [teamIds],
      )
    : await query(
        "SELECT * FROM teams WHERE COALESCE(status, '') <> 'rejected' ORDER BY created_at ASC",
        [],
      );

  const existing = await query(
    "SELECT holder_key, coupon_day FROM coupons WHERE status <> 'void' AND coupon_day = ANY($1)",
    [days],
  );
  const have = new Set(
    existing.rows.map((r) => r.holder_key + "|" + r.coupon_day),
  );

  let created = 0;

  for (const team of teamsResult.rows) {
    for (const h of holdersOfTeam(team)) {
      for (const day of days) {
        const key = h.holder_key + "|" + day;
        if (have.has(key)) continue;

        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await query(
              `INSERT INTO coupons
                 (code, team_id, holder_type, student_number, holder_key, holder_name, coupon_day)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                generateCode(),
                h.team_id,
                h.holder_type,
                h.student_number,
                h.holder_key,
                h.holder_name,
                day,
              ],
            );
            created++;
            break;
          } catch (err) {
            if (err.code !== "23505") throw err;
            if (err.constraint === "coupons_code_uq") continue; // รหัสชน → สุ่มใหม่
            break; // มีคูปองของคนนี้วันนี้แล้ว
          }
        }
        have.add(key);
      }
    }
  }

  return { created };
}

// ============================================================================
// ACCESS
// ============================================================================

// ไม่ใช้ requireAdmin จาก middleware/auth เพราะตัวนั้น redirect ไป /dashboard (404)
function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  if (wantsJson(req))
    return res.status(403).json({ ok: false, error: "เฉพาะผู้ดูแลระบบ" });
  req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

// จุดแลกคูปอง: admin + viewer (ผู้ดูข้อมูล)
function requireScanner(req, res, next) {
  const user = req.session && req.session.user;
  if (user && (user.role === "admin" || user.role === "viewer")) return next();
  if (wantsJson(req))
    return res.status(403).json({ ok: false, error: "ไม่มีสิทธิ์สแกนคูปอง" });
  req.flash("error", "ไม่มีสิทธิ์สแกนคูปอง");
  return res.redirect("/board");
}

adminRouter.use(requireLogin, requireAdminOnly);
staffRouter.use(requireLogin, requireScanner);

// ============================================================================
// STAFF: GET /coupons/scan
// ============================================================================

staffRouter.get("/", (req, res) => res.redirect("/coupons/scan"));

staffRouter.get("/scan", async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();
    const today = todayBangkok();

    const stats = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'used')::int AS used,
              COUNT(*) FILTER (WHERE status <> 'void')::int AS total
       FROM coupons WHERE coupon_day = $1`,
      [today],
    );

    return res.render("coupons/scan", {
      layout: false,
      couponLabel: COUPON_LABEL,
      todayLabel: dayLabel(today),
      isCouponDay: config.days.includes(today),
      strictDay: config.strictDay,
      stats: stats.rows[0] || { used: 0, total: 0 },
      user: req.session.user,
    });
  } catch (err) {
    console.error("Coupon scan page error:", err);
    return res.status(500).send("ไม่สามารถเปิดหน้าสแกนคูปองได้");
  }
});

// ============================================================================
// STAFF: POST /coupons/redeem  (JSON)
// ============================================================================

function couponView(c, team) {
  return {
    code: c.code,
    name: c.holder_name,
    role: c.holder_type === "coach" ? "โค้ช" : "นักเรียน",
    team: team ? team.name : c.team_id,
    teamId: c.team_id,
    day: shortDayLabel(c.coupon_day),
    usedAt: formatThaiTime(c.used_at),
    usedBy: c.used_by || "",
  };
}

staffRouter.post("/redeem", async (req, res) => {
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

    const found = await query("SELECT * FROM coupons WHERE code = $1 LIMIT 1", [
      code,
    ]);
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
    const team = teamResult.rows[0] || null;
    const view = couponView(c, team);

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
          "ใช้ไปแล้ว เมื่อ " +
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

    // ต้อง Check-in ก่อน (โค้ช: มีนักเรียนในทีม Check-in อย่างน้อย 1 คน)
    if (team) {
      const checkedIn =
        c.holder_type === "student"
          ? Boolean(team["student_" + c.student_number + "_checked_in"])
          : [1, 2, 3].some((i) => team["student_" + i + "_checked_in"]);

      if (!checkedIn) {
        return res.json({
          ok: false,
          reason: "not_checked_in",
          message:
            c.holder_type === "student"
              ? "นักเรียนยังไม่ได้ Check-in ให้ไปลงทะเบียนที่โต๊ะ Check-in ก่อน"
              : "ทีมยังไม่ได้ Check-in ให้ไปลงทะเบียนที่โต๊ะ Check-in ก่อน",
          coupon: view,
        });
      }
    }

    const user = req.session.user || {};
    const usedBy = String(user.name || user.username || "").slice(0, 100);

    // ใช้ได้ครั้งเดียว: อัปเดตเฉพาะใบที่ยัง active (กันสแกนพร้อมกัน 2 เครื่อง)
    const updated = await query(
      `UPDATE coupons SET status = 'used', used_at = NOW(), used_by = $2
       WHERE code = $1 AND status = 'active'
       RETURNING *`,
      [code, usedBy],
    );

    if (!updated.rows.length) {
      const again = await query("SELECT * FROM coupons WHERE code = $1", [
        code,
      ]);
      const v2 = couponView(again.rows[0], team);
      return res.json({
        ok: false,
        reason: "used",
        message:
          "ใช้ไปแล้ว เมื่อ " +
          v2.usedAt +
          (v2.usedBy ? " โดย " + v2.usedBy : ""),
        coupon: v2,
      });
    }

    return res.json({
      ok: true,
      message: "แลกสำเร็จ — ให้ " + COUPON_LABEL,
      coupon: couponView(updated.rows[0], team),
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

adminRouter.get("/", async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";

    const [dayStats, teamsResult, couponCounts, recent] = await Promise.all([
      query(
        `SELECT coupon_day,
                COUNT(*) FILTER (WHERE status <> 'void')::int AS total,
                COUNT(*) FILTER (WHERE status = 'used')::int AS used,
                COUNT(*) FILTER (WHERE status <> 'void' AND holder_type = 'student')::int AS students,
                COUNT(*) FILTER (WHERE status <> 'void' AND holder_type = 'coach')::int AS coaches
         FROM coupons GROUP BY coupon_day ORDER BY coupon_day`,
        [],
      ),
      query(
        `SELECT id, name, institution, tier, status, coach,
                student_1, student_2, student_3,
                student_1_checked_in, student_2_checked_in, student_3_checked_in
         FROM teams WHERE tier = $1 ORDER BY created_at ASC`,
        [tier],
      ),
      query(
        `SELECT team_id,
                COUNT(*) FILTER (WHERE status <> 'void')::int AS total,
                COUNT(*) FILTER (WHERE status = 'used')::int AS used
         FROM coupons GROUP BY team_id`,
        [],
      ),
      query(
        `SELECT code, holder_name, holder_type, team_id, coupon_day, used_at, used_by
         FROM coupons WHERE status = 'used'
         ORDER BY used_at DESC LIMIT 15`,
        [],
      ),
    ]);

    const countMap = {};
    couponCounts.rows.forEach((r) => {
      countMap[r.team_id] = r;
    });

    const statsByDay = {};
    dayStats.rows.forEach((r) => {
      statsByDay[r.coupon_day] = r;
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
      teams: teamsResult.rows.map((t) => ({
        id: t.id,
        name: t.name,
        institution: t.institution,
        status: t.status,
        people: holdersOfTeam(t).length,
        checkedIn: [1, 2, 3].filter((i) => t["student_" + i + "_checked_in"])
          .length,
        total: countMap[t.id] ? countMap[t.id].total : 0,
        used: countMap[t.id] ? countMap[t.id].used : 0,
      })),
      recent: recent.rows.map((r) => ({
        code: r.code,
        name: r.holder_name,
        role: r.holder_type === "coach" ? "โค้ช" : "นักเรียน",
        teamId: r.team_id,
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

adminRouter.post("/settings", async (req, res) => {
  try {
    const days = [req.body.day1, req.body.day2, req.body.day3]
      .map((d) => cleanText(d, 10))
      .filter(isIsoDate);
    const unique = Array.from(new Set(days)).sort();

    await saveSetting("coupon_days", unique.join(","));
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

adminRouter.post("/generate", async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();

    if (!config.days.length) {
      req.flash("error", "กรุณาตั้งวันที่แจกคูปองก่อน");
      return res.redirect("/board/coupons");
    }

    const { created } = await generateCoupons(config.days, null);
    req.flash(
      "success",
      created
        ? "สร้างคูปองเพิ่ม " + created + " ใบ"
        : "คูปองครบทุกคนแล้ว ไม่มีใบที่ต้องสร้างเพิ่ม",
    );
  } catch (err) {
    console.error("Coupon generate error:", err);
    req.flash("error", "สร้างคูปองไม่สำเร็จ");
  }
  return res.redirect(
    "/board/coupons" +
      (req.query.tier ? "?tier=" + encodeURIComponent(req.query.tier) : ""),
  );
});

// ---------------- GET /board/coupons/print?team=ID | ?tier=beginner ----------------

adminRouter.get("/print", async (req, res) => {
  try {
    await tableReady;
    const config = await getCouponConfig();

    if (!config.days.length) {
      req.flash("error", "กรุณาตั้งวันที่แจกคูปองก่อน");
      return res.redirect("/board/coupons");
    }

    const teamId = cleanText(req.query.team, 20);
    const tier = TIERS.includes(req.query.tier) ? req.query.tier : null;

    const teamsResult = teamId
      ? await query("SELECT * FROM teams WHERE id = $1", [teamId])
      : await query(
          "SELECT * FROM teams WHERE tier = $1 AND COALESCE(status, '') <> 'rejected' ORDER BY created_at ASC",
          [tier || "beginner"],
        );

    const teams = teamsResult.rows;
    if (!teams.length) {
      req.flash("error", "ไม่พบทีม");
      return res.redirect("/board/coupons");
    }

    // สร้างใบที่ยังขาดก่อนพิมพ์
    await generateCoupons(
      config.days,
      teams.map((t) => t.id),
    );

    const sheets = [];

    for (const team of teams) {
      // รวมคูปองโค้ชที่ผูกไว้กับทีมอื่นด้วย (โค้ชคนเดียวหลายทีม)
      const keys = holdersOfTeam(team).map((h) => h.holder_key);
      const result = await query(
        `SELECT * FROM coupons
         WHERE status <> 'void' AND holder_key = ANY($1) AND coupon_day = ANY($2)
         ORDER BY holder_type DESC, student_number ASC NULLS LAST, coupon_day ASC`,
        [keys, config.days],
      );

      const items = [];
      for (const c of result.rows) {
        items.push({
          code: c.code,
          name: c.holder_name,
          role:
            c.holder_type === "coach"
              ? "โค้ช"
              : "นักเรียนคนที่ " + c.student_number,
          day: dayLabel(c.coupon_day),
          used: c.status === "used",
          qr: await QRCode.toString(c.code, {
            type: "svg",
            margin: 0,
            errorCorrectionLevel: "M",
          }),
        });
      }

      sheets.push({
        id: team.id,
        name: team.name,
        institution: team.institution || "",
        tierLabel: TIER_LABEL[team.tier] || team.tier,
        items,
      });
    }

    return res.render("coupons/print", {
      layout: false,
      couponLabel: COUPON_LABEL,
      sheets,
      backUrl: "/board/coupons?tier=" + (teams[0].tier || "beginner"),
    });
  } catch (err) {
    console.error("Coupon print error:", err);
    req.flash("error", "สร้างหน้าพิมพ์คูปองไม่สำเร็จ");
    return res.redirect("/board/coupons");
  }
});

// ---------------- POST /board/coupons/reissue ----------------
// คูปองหาย → ยกเลิกใบเดิม แล้วออกใบใหม่ให้คนเดิม วันเดิม

adminRouter.post("/reissue", async (req, res) => {
  const code = normalizeCode(req.body.code);
  if (!code) {
    req.flash("error", "รหัสคูปองไม่ถูกต้อง");
    return res.redirect("/board/coupons");
  }

  try {
    await tableReady;
    const found = await query("SELECT * FROM coupons WHERE code = $1", [code]);
    const c = found.rows[0];

    if (!c) {
      req.flash("error", "ไม่พบคูปอง " + code);
      return res.redirect("/board/coupons");
    }
    if (c.status === "used") {
      req.flash("error", "คูปอง " + code + " ถูกใช้ไปแล้ว ออกใบใหม่ไม่ได้");
      return res.redirect("/board/coupons");
    }
    if (c.status === "void") {
      req.flash("error", "คูปอง " + code + " ถูกยกเลิกไปแล้ว");
      return res.redirect("/board/coupons");
    }

    await query("UPDATE coupons SET status = 'void' WHERE id = $1", [c.id]);

    let newCode = "";
    for (let attempt = 0; attempt < 5 && !newCode; attempt++) {
      const candidate = generateCode();
      try {
        await query(
          `INSERT INTO coupons
             (code, team_id, holder_type, student_number, holder_key, holder_name, coupon_day)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            candidate,
            c.team_id,
            c.holder_type,
            c.student_number,
            c.holder_key,
            c.holder_name,
            c.coupon_day,
          ],
        );
        newCode = candidate;
      } catch (err) {
        if (err.code !== "23505" || err.constraint !== "coupons_code_uq")
          throw err;
      }
    }

    req.flash(
      "success",
      "ยกเลิก " +
        code +
        " และออกใบใหม่ " +
        newCode +
        " ให้ " +
        c.holder_name +
        " แล้ว",
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

adminRouter.get("/export", async (req, res) => {
  try {
    await tableReady;
    const result = await query(
      `SELECT c.*, t.name AS team_name, t.tier
       FROM coupons c LEFT JOIN teams t ON t.id = c.team_id
       ORDER BY c.coupon_day, t.tier, c.team_id, c.holder_type DESC, c.student_number`,
      [],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "Robo Challenge League";
    const ws = wb.addWorksheet("คูปอง");

    ws.columns = [
      { header: "วันที่", key: "day", width: 14 },
      { header: "รหัสคูปอง", key: "code", width: 13 },
      { header: "รุ่น", key: "tier", width: 13 },
      { header: "ทีม", key: "team_id", width: 10 },
      { header: "ชื่อทีม", key: "team_name", width: 28 },
      { header: "ประเภท", key: "role", width: 12 },
      { header: "ชื่อ", key: "name", width: 28 },
      { header: "สถานะ", key: "status", width: 12 },
      { header: "เวลาที่ใช้", key: "used_at", width: 18 },
      { header: "ผู้สแกน", key: "used_by", width: 18 },
    ];

    result.rows.forEach((r) => {
      ws.addRow({
        day: shortDayLabel(r.coupon_day),
        code: r.code,
        tier: TIER_LABEL[r.tier] || r.tier || "",
        team_id: r.team_id,
        team_name: r.team_name || "",
        role: r.holder_type === "coach" ? "โค้ช" : "นักเรียน",
        name: r.holder_name,
        status:
          r.status === "used"
            ? "ใช้แล้ว"
            : r.status === "void"
              ? "ยกเลิก"
              : "ยังไม่ใช้",
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
    ws.autoFilter = { from: "A1", to: "J1" };

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
// ลบคูปองทั้งหมด (ใช้ล้างข้อมูลทดสอบก่อนวันงาน)

adminRouter.post("/reset", async (req, res) => {
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
    const count = await query("SELECT COUNT(*)::int AS cnt FROM coupons", []);
    await query("TRUNCATE coupons RESTART IDENTITY", []);

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
