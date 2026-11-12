// src/routes/announce.js
// ใบประกาศผลสำหรับพิธีกร: อันดับ 10 → 1 ของแต่ละรุ่น พร้อมบทพูด (พิมพ์ A4)
// ใช้อันดับชุดเดียวกับหน้าสรุปผล / จอแสดงผล (board.getRanked)
//
// app.js (ก่อน app.use("/board", ...)):
//   app.use("/board/announce", require("./routes/announce"));
//
// GET /board/announce?tier=all | beginner | intermediate | advance

const express = require("express");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const { requirePerm } = require("../utils/permissions");
const board = require("./board");

let formatTime;
try {
  formatTime = require("../utils/time").formatTime;
} catch (e) {
  formatTime = (v) =>
    v === null || v === undefined || v === "" ? "" : Number(v).toFixed(3);
}

const router = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

// ชื่อรางวัลที่พิธีกรอ่าน
function awardName(rank) {
  if (rank === 1) return "รางวัลชนะเลิศ";
  if (rank === 2) return "รางวัลรองชนะเลิศอันดับ 1";
  if (rank === 3) return "รางวัลรองชนะเลิศอันดับ 2";
  return "อันดับที่ " + rank;
}

// เหรียญ (เกณฑ์เดียวกับเกียรติบัตร)
function medalOf(score, max) {
  if (!(max > 0)) return "";
  const pct = (score / max) * 100;
  if (pct > 80) return "เหรียญทอง";
  if (pct >= 51) return "เหรียญเงิน";
  if (pct >= 30) return "เหรียญทองแดง";
  return "";
}

function students(team) {
  const list = [];
  for (let i = 1; i <= 3; i++) {
    const n = String(team["student_" + i] || "").trim();
    if (n) list.push(n);
  }
  return list;
}

async function buildTier(tier) {
  const [ranked, maxScore] = await Promise.all([
    board.getRanked(tier),
    board.getMaxScore(tier),
  ]);
  const top = ranked.filter((t) => parseFloat(t.best_score) > 0).slice(0, 10);

  const ids = top.map((t) => t.id);
  const detail = ids.length
    ? (await query("SELECT * FROM teams WHERE id = ANY($1)", [ids])).rows
    : [];
  const byId = {};
  detail.forEach((t) => {
    byId[t.id] = t;
  });

  const rows = top.map((t, i) => {
    const d = byId[t.id] || {};
    const score = parseFloat(t.best_score);
    return {
      rank: i + 1,
      award: awardName(i + 1),
      id: t.id,
      name: t.name,
      institution: t.institution || d.institution || "",
      students: students(d),
      coach: String(d.coach || "").trim(),
      score,
      time: formatTime(t.best_time),
      medal: medalOf(score, maxScore),
    };
  });

  // คะแนน + เวลาเท่ากัน → แจ้งพิธีกร/กรรมการ (อันดับตัดสินด้วยรหัสทีม)
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    r.tie = Boolean(
      (prev && prev.score === r.score && prev.time === r.time) ||
      (next && next.score === r.score && next.time === r.time),
    );
  });

  return {
    tier,
    label: TIER_LABEL[tier],
    maxScore,
    // ลำดับการประกาศ: 10 → 1
    rows: rows.slice().reverse(),
    count: rows.length,
  };
}

router.get(
  "/",
  requireLogin,
  requirePerm("board.allTiers"),
  async (req, res) => {
    const want = req.query.tier;
    const tiers = TIERS.includes(want) ? [want] : TIERS;
    try {
      const sections = [];
      for (const t of tiers) sections.push(await buildTier(t));

      return res.render("board/announce", {
        layout: false,
        sections,
        tiersAll: TIERS,
        tierLabel: TIER_LABEL,
        current: TIERS.includes(want) ? want : "all",
        printedAt: new Date().toLocaleString("th-TH", {
          timeZone: "Asia/Bangkok",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    } catch (err) {
      console.error("Announce page error:", err);
      req.flash("error", "สร้างใบประกาศผลไม่สำเร็จ");
      return res.redirect("/board");
    }
  },
);

module.exports = router;
