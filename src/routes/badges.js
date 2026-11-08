// src/routes/badges.js
// สร้างป้ายชื่อผู้เข้าแข่งขัน / โค้ช ขนาด 10 × 14 ซม. จากภาพพื้นหลังตามรุ่น
//
// ภาพพื้นหลัง (วางใน src/public/images/badges/):
//   student-beginner.png, student-intermediate.png, student-advance.png   (NAME + TEAM NAME)
//   coach-beginner.png,   coach-intermediate.png,   coach-advance.png     (COACH + TEAM NAME)
//
// app.js (ก่อน app.use("/board", ...)):
//   app.use("/board/badges", require("./routes/badges"));

const express = require("express");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const { requirePerm } = require("../utils/permissions");

const router = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};
const WHO = ["students", "coaches", "all"];

function normalizeName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanText(v, max) {
  return String(Array.isArray(v) ? v[0] : (v ?? ""))
    .trim()
    .slice(0, max);
}

// ไม่ใช้ requireAdmin จาก middleware/auth เพราะตัวนั้น redirect ไป /dashboard (404)
function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

// แอดมิน + สตาฟไอที
router.use(requireLogin, requirePerm("print.badges"));

async function loadTeams(tier, teamId) {
  if (teamId) {
    const r = await query("SELECT * FROM teams WHERE id = $1", [teamId]);
    return r.rows;
  }
  const r =
    tier === "all"
      ? await query(
          `SELECT * FROM teams WHERE status IS DISTINCT FROM 'rejected'
         ORDER BY CASE tier WHEN 'beginner' THEN 1 WHEN 'intermediate' THEN 2 ELSE 3 END, created_at ASC`,
          [],
        )
      : await query(
          "SELECT * FROM teams WHERE tier = $1 AND status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
          [tier],
        );
  return r.rows;
}

function badgesOf(team, who) {
  const list = [];
  const tier = TIERS.includes(team.tier) ? team.tier : "beginner";

  if (who === "students" || who === "all") {
    for (let i = 1; i <= 3; i++) {
      const name = normalizeName(team["student_" + i]);
      if (!name) continue;
      list.push({
        kind: "student",
        tier,
        name,
        team: team.name,
        teamId: team.id,
      });
    }
  }

  if (who === "coaches" || who === "all") {
    const coach = normalizeName(team.coach);
    if (coach)
      list.push({
        kind: "coach",
        tier,
        name: coach,
        team: team.name,
        teamId: team.id,
      });
  }

  return list;
}

// ---------------- GET /board/badges ----------------

router.get("/", async (req, res) => {
  try {
    const r = await query(
      `SELECT tier,
              COUNT(*)::int AS teams,
              SUM((NULLIF(TRIM(student_1), '') IS NOT NULL)::int
                + (NULLIF(TRIM(student_2), '') IS NOT NULL)::int
                + (NULLIF(TRIM(student_3), '') IS NOT NULL)::int)::int AS students,
              SUM((NULLIF(TRIM(coach), '') IS NOT NULL)::int)::int AS coaches
       FROM teams WHERE status IS DISTINCT FROM 'rejected'
       GROUP BY tier`,
      [],
    );

    const counts = {};
    r.rows.forEach((row) => {
      counts[row.tier] = row;
    });

    return res.render("badges/admin", {
      title: "ป้ายชื่อ",
      pageTitle: "<span>ป้ายชื่อ</span>ผู้เข้าแข่งขัน",
      tierSelector: false,
      activeTier: "",
      tiers: TIERS,
      tierLabel: TIER_LABEL,
      counts,
    });
  } catch (err) {
    console.error("Badge admin error:", err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    return res.redirect("/board");
  }
});

// ---------------- GET /board/badges/print ----------------
// ?tier=beginner|intermediate|advance|all  &who=students|coaches|all
// &layout=a4|label  &team=T007_B (พิมพ์ทีมเดียว)

router.get("/print", async (req, res) => {
  try {
    const tier =
      TIERS.includes(req.query.tier) || req.query.tier === "all"
        ? req.query.tier
        : "beginner";
    const who = WHO.includes(req.query.who) ? req.query.who : "students";
    const layout = req.query.layout === "label" ? "label" : "a4";
    const teamId = cleanText(req.query.team, 20);

    const teams = await loadTeams(tier, teamId);
    const badges = [];
    teams.forEach((t) => {
      badgesOf(t, who).forEach((b) => badges.push(b));
    });

    const pages = [];
    const perPage = layout === "label" ? 1 : 4;
    for (let i = 0; i < badges.length; i += perPage) {
      pages.push(badges.slice(i, i + perPage));
    }

    const base = teamId ? "team=" + encodeURIComponent(teamId) : "tier=" + tier;
    const url = (l, w) =>
      "/board/badges/print?" + base + "&who=" + w + "&layout=" + l;

    return res.render("badges/print", {
      layout: false,
      pages,
      badgeCount: badges.length,
      teamCount: teams.length,
      sheetLayout: layout,
      who,
      links: {
        a4: url("a4", who),
        label: url("label", who),
        students: url(layout, "students"),
        coaches: url(layout, "coaches"),
        all: url(layout, "all"),
      },
    });
  } catch (err) {
    console.error("Badge print error:", err);
    req.flash("error", "สร้างป้ายชื่อไม่สำเร็จ");
    return res.redirect("/board/badges");
  }
});

module.exports = router;
