// src/routes/screen.js
// ระบบจอแสดงผลบนเวที (คอมเครื่องเดียว: จอโน้ตบุ๊ก = หน้าควบคุม, จอโปรเจกเตอร์ = หน้าแสดงผล)
// หน้าควบคุมกับหน้าแสดงผลคุยกันผ่าน BroadcastChannel ในเบราว์เซอร์ (ไม่ผ่าน server)
// server ใช้แค่ 2 อย่าง: ดึงผลการแข่งขัน และสุ่มรางวัล (ผ่าน /board/survey/draw เดิม)
//
// app.js (หลัง app.use(viewerGuard) · ลบบรรทัด app.use("/timer", ...) เดิมออก):
//   const screen = require("./routes/screen");
//   app.use("/screen", screen.router);
//   app.use("/timer", screen.legacyTimer);   // ลิงก์ /timer เดิม → /screen

const express = require("express");
const { requireLogin } = require("../middleware/auth");
const board = require("./board");

let formatTime;
try {
  formatTime = require("../utils/time").formatTime;
} catch (e) {
  formatTime = (v) =>
    v === null || v === undefined || v === "" ? "" : Number(v).toFixed(3);
}

const router = express.Router();
const legacyTimer = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

// ไม่ใช้ requireAdmin จาก middleware/auth เพราะตัวนั้น redirect ไป /dashboard (404)
function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  const wantsJson = (req.headers.accept || "").includes("application/json");
  if (wantsJson)
    return res.status(403).json({ ok: false, error: "เฉพาะผู้ดูแลระบบ" });
  if (typeof req.flash === "function")
    req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

// ---------------- หน้าแสดงผล (เปิดบนจอโปรเจกเตอร์) ----------------
// ?preview=1 = ตัวอย่างขนาดเล็กในหน้าควบคุม (ไม่มีเสียง ไม่เล่นวิดีโอ)

router.get("/", (req, res) => {
  return res.render("screen/display", {
    layout: false,
    preview: req.query.preview === "1",
  });
});

// ---------------- หน้าควบคุม (จอโน้ตบุ๊ก) ----------------

router.get("/control", requireLogin, requireAdminOnly, (req, res) => {
  return res.render("screen/control", {
    layout: false,
    user: req.session.user,
  });
});

// ---------------- ผลการแข่งขัน Top 10 ----------------
// ใช้ getRanked เดียวกับหน้าสรุปผลและเกียรติบัตร → อันดับตรงกันทุกที่

router.get("/api/results", requireLogin, requireAdminOnly, async (req, res) => {
  const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";
  try {
    const [ranked, maxScore] = await Promise.all([
      board.getRanked(tier),
      board.getMaxScore(tier),
    ]);
    const teams = ranked
      .filter((t) => parseFloat(t.best_score) > 0)
      .slice(0, 10)
      .map((t, i) => ({
        rank: i + 1,
        id: t.id,
        name: t.name,
        institution: t.institution || "",
        score: parseFloat(t.best_score),
        time: formatTime(t.best_time),
      }));

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      tier,
      tierLabel: TIER_LABEL[tier],
      maxScore,
      teams,
    });
  } catch (err) {
    console.error("Screen results error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "โหลดผลการแข่งขันไม่สำเร็จ" });
  }
});

// ---------------- ลิงก์เดิมของนาฬิกา ----------------

legacyTimer.get("/", (req, res) => res.redirect("/screen"));
legacyTimer.get("/control", (req, res) => res.redirect("/screen/control"));

module.exports = { router, legacyTimer };
