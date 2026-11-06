// src/routes/timer.js
// นาฬิกานับถอยหลังเวลาซ้อม / แข่งขัน (นาฬิกาเดียวทั้งห้อง) สำหรับขึ้นโปรเจกเตอร์
//
//   /timer           หน้าแสดงผลบนโปรเจกเตอร์ (ไม่ต้อง login)
//   /timer/state     สถานะปัจจุบัน (JSON) — หน้าแสดงผลดึงทุก 1.5 วินาที
//   /timer/control   หน้าควบคุม (admin + viewer)
//   /timer/action    คำสั่งควบคุม (POST, admin + viewer)
//
// app.js (หลัง app.use(viewerGuard)):
//   app.use("/timer", require("./routes/timer"));
//
// หลักการ: server เก็บ "เวลาสิ้นสุด" ไม่ได้ส่งตัวเลขทุกวินาที
// หน้าจอคำนวณเวลาที่เหลือเองจากนาฬิกา server → เน็ตหลุดนาฬิกาก็ยังเดินถูก

const express = require("express");
const { query } = require("../config/database");

const router = express.Router();

const STATE_KEY = "timer_state";
const PRESETS_KEY = "timer_presets";

const DEFAULT_PRESETS = [
  { label: "ซ้อมรอบที่ 1", minutes: 30 },
  { label: "ซ้อมรอบที่ 2", minutes: 30 },
];

const EMPTY_STATE = {
  status: "idle", // idle | running | paused  (countdown / finished คำนวณจากเวลา)
  label: "",
  durationMs: 0,
  startAt: null, // ms epoch: นับถอยหลังก่อนเริ่ม จบตอนนี้ (null = ไม่มี)
  endAt: null, // ms epoch (ตอน running)
  remainingMs: 0, // ตอน paused
  message: "", // ข้อความแถบเล็กด้านล่าง
  banner: "", // ข้อความประกาศตัวใหญ่เต็มจอ เช่น "พักเบรก"
  bannerSub: "",
  next: "",
  version: 0,
};

const MAX_COUNTDOWN_SEC = 60;

function cleanText(v, max) {
  return String(Array.isArray(v) ? v[0] : (v ?? ""))
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

async function readJson(key, fallback) {
  const r = await query("SELECT value FROM settings WHERE key = $1 LIMIT 1", [
    key,
  ]);
  if (!r.rows.length || !r.rows[0].value) return fallback;
  try {
    return JSON.parse(r.rows[0].value);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(key, value) {
  await query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, JSON.stringify(value)],
  );
}

async function getState() {
  return Object.assign({}, EMPTY_STATE, await readJson(STATE_KEY, {}));
}

async function getPresets() {
  const list = await readJson(PRESETS_KEY, null);
  if (!Array.isArray(list) || !list.length) return DEFAULT_PRESETS;
  return list;
}

// สถานะสำหรับส่งให้หน้าจอ (คำนวณ finished จากเวลา server)
function publicState(state) {
  const now = Date.now();
  let status = state.status;
  if (status === "running" && state.startAt && state.startAt > now)
    status = "countdown";
  else if (status === "running" && state.endAt && state.endAt <= now)
    status = "finished";

  let remainingMs = 0;
  if (status === "countdown") remainingMs = state.durationMs;
  else if (status === "running") remainingMs = Math.max(0, state.endAt - now);
  else if (status === "paused") remainingMs = state.remainingMs;

  return {
    status,
    label: state.label,
    durationMs: state.durationMs,
    startAt: state.startAt,
    endAt: state.endAt,
    remainingMs,
    message: state.message,
    banner: state.banner,
    bannerSub: state.bannerSub,
    next: state.next,
    version: state.version,
    serverNow: now,
  };
}

function canControl(req) {
  const user = req.session && req.session.user;
  return Boolean(user && (user.role === "admin" || user.role === "viewer"));
}

// ============================================================================
// PUBLIC
// ============================================================================

router.get("/", (req, res) => {
  return res.render("timer/display", { layout: false });
});

router.get("/state", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(publicState(await getState()));
  } catch (err) {
    console.error("Timer state error:", err);
    return res
      .status(500)
      .json({ error: "state_failed", serverNow: Date.now() });
  }
});

// ============================================================================
// CONTROL
// ============================================================================

router.get("/control", async (req, res) => {
  if (!canControl(req)) {
    if (typeof req.flash === "function")
      req.flash("error", "กรุณาเข้าสู่ระบบเพื่อควบคุมนาฬิกา");
    return res.redirect("/auth/login");
  }
  try {
    return res.render("timer/control", {
      layout: false,
      presets: await getPresets(),
      user: req.session.user,
    });
  } catch (err) {
    console.error("Timer control page error:", err);
    return res.status(500).send("เปิดหน้าควบคุมไม่ได้");
  }
});

router.post("/action", async (req, res) => {
  if (!canControl(req)) {
    return res
      .status(403)
      .json({ ok: false, error: "ไม่มีสิทธิ์ควบคุมนาฬิกา" });
  }

  const action = cleanText(req.body.action, 20);
  const now = Date.now();

  try {
    const s = await getState();
    const inCountdown = s.status === "running" && s.startAt && s.startAt > now;
    const running = s.status === "running" && s.endAt > now && !inCountdown;

    switch (action) {
      case "start": {
        const minutes = parseFloat(req.body.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
          return res.json({
            ok: false,
            error: "ระยะเวลาไม่ถูกต้อง (1–600 นาที)",
          });
        }
        const ms = Math.round(minutes * 60000);
        const cd = Math.min(
          MAX_COUNTDOWN_SEC,
          Math.max(0, parseInt(req.body.countdown, 10) || 0),
        );
        s.status = "running";
        s.label = cleanText(req.body.label, 80) || "จับเวลา";
        s.durationMs = ms;
        s.startAt = cd ? now + cd * 1000 : null;
        s.endAt = now + cd * 1000 + ms;
        s.remainingMs = 0;
        s.banner = ""; // เริ่มจับเวลา = ปิดประกาศเต็มจอ
        s.bannerSub = "";
        break;
      }

      case "pause":
        if (inCountdown) {
          // หยุดระหว่างนับถอยหลัง → ยังไม่เริ่มเดิน เก็บเวลาเต็มไว้
          s.status = "paused";
          s.remainingMs = s.durationMs;
          s.startAt = null;
          s.endAt = null;
          break;
        }
        if (!running)
          return res.json({ ok: false, error: "นาฬิกาไม่ได้เดินอยู่" });
        s.status = "paused";
        s.remainingMs = s.endAt - now;
        s.startAt = null;
        s.endAt = null;
        break;

      case "resume":
        if (s.status !== "paused")
          return res.json({ ok: false, error: "นาฬิกาไม่ได้หยุดพักอยู่" });
        s.status = "running";
        s.startAt = null;
        s.endAt = now + s.remainingMs;
        s.remainingMs = 0;
        break;

      case "add": {
        const sec = parseInt(req.body.seconds, 10);
        if (!Number.isFinite(sec) || sec === 0 || Math.abs(sec) > 3600) {
          return res.json({ ok: false, error: "จำนวนวินาทีไม่ถูกต้อง" });
        }
        if (inCountdown) {
          s.durationMs = Math.max(1000, s.durationMs + sec * 1000);
          s.endAt = s.startAt + s.durationMs;
        } else if (running) {
          s.endAt = Math.max(now + 1000, s.endAt + sec * 1000);
          s.durationMs = Math.max(s.durationMs + sec * 1000, s.endAt - now);
        } else if (s.status === "paused") {
          s.remainingMs = Math.max(1000, s.remainingMs + sec * 1000);
          s.durationMs = Math.max(s.durationMs + sec * 1000, s.remainingMs);
        } else if (s.status === "running" && sec > 0) {
          // หมดเวลาไปแล้ว → ต่อเวลาจากตอนนี้
          s.startAt = null;
          s.endAt = now + sec * 1000;
          s.durationMs = sec * 1000;
        } else {
          return res.json({ ok: false, error: "ยังไม่ได้เริ่มจับเวลา" });
        }
        break;
      }

      case "reset":
        s.status = "idle";
        s.label = "";
        s.durationMs = 0;
        s.startAt = null;
        s.endAt = null;
        s.remainingMs = 0;
        break;

      case "banner":
        s.banner = cleanText(req.body.text, 60);
        s.bannerSub = cleanText(req.body.sub, 100);
        if (!s.banner)
          return res.json({ ok: false, error: "กรุณาใส่ข้อความประกาศ" });
        break;

      case "bannerClear":
        s.banner = "";
        s.bannerSub = "";
        break;

      case "message":
        s.message = cleanText(req.body.text, 120);
        break;

      case "next":
        s.next = cleanText(req.body.text, 120);
        break;

      case "presets": {
        const lines = String(req.body.text || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 8);
        const list = [];
        for (const line of lines) {
          const m = line.match(/^(.+?)\s*[|,]\s*(\d+(?:\.\d+)?)\s*$/);
          if (!m)
            return res.json({
              ok: false,
              error: 'รูปแบบไม่ถูกต้อง: "' + line + '" (ใช้ ชื่อ | นาที)',
            });
          list.push({
            label: m[1].slice(0, 60),
            minutes: Math.min(600, parseFloat(m[2])),
          });
        }
        await writeJson(PRESETS_KEY, list.length ? list : DEFAULT_PRESETS);
        return res.json({
          ok: true,
          presets: list.length ? list : DEFAULT_PRESETS,
        });
      }

      default:
        return res.json({ ok: false, error: "คำสั่งไม่ถูกต้อง" });
    }

    s.version = (s.version || 0) + 1;
    await writeJson(STATE_KEY, s);
    return res.json({ ok: true, state: publicState(s) });
  } catch (err) {
    console.error("Timer action error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "ระบบขัดข้อง กรุณาลองอีกครั้ง" });
  }
});

module.exports = router;
