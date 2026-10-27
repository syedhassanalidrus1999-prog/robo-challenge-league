const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { requireLogin, requireAdmin } = require("../middleware/auth");

const TIERS = ["beginner", "intermediate", "advance"];

function safeTier(value) {
  return TIERS.includes(value) ? value : "beginner";
}

// Check-in: admin + viewer (ผู้ดูข้อมูล) ทำได้
// ไม่ใช้ requireAdmin เพราะตัวนั้นส่งคนที่ไม่ใช่ admin ไปหน้า /dashboard (404)
function requireCheckinAccess(req, res, next) {
  const user = req.session && req.session.user;
  if (user && (user.role === "admin" || user.role === "viewer")) {
    return next();
  }
  req.flash("error", "ไม่มีสิทธิ์เปลี่ยนสถานะ Check-in");
  return res.redirect("/board");
}

// ─── GET /teams ───────────────────────────────────────────────────────────────
router.get("/", requireLogin, async (req, res) => {
  const tier = safeTier(req.query.tier);
  try {
    const [teamsResult, countsResult, participantsResult] = await Promise.all([
      query("SELECT * FROM teams WHERE tier = $1 ORDER BY created_at ASC", [
        tier,
      ]),
      query("SELECT tier, COUNT(*) as cnt FROM teams GROUP BY tier", []),
      query(
        `
        SELECT
          tier,
          GROUPING(tier) AS is_total,
          SUM(
            (NULLIF(TRIM(student_1), '') IS NOT NULL)::int +
            (NULLIF(TRIM(student_2), '') IS NOT NULL)::int +
            (NULLIF(TRIM(student_3), '') IS NOT NULL)::int
          )::int AS students,
          COUNT(DISTINCT NULLIF(REGEXP_REPLACE(TRIM(coach), '\\s+', ' ', 'g'), ''))::int AS coaches
        FROM teams
        GROUP BY ROLLUP(tier)
      `,
        [],
      ),
    ]);

    const counts = { beginner: 0, intermediate: 0, advance: 0 };
    countsResult.rows.forEach(function (r) {
      counts[r.tier] = parseInt(r.cnt);
    });

    // จำนวนนักเรียน / โค้ช (โค้ชนับแบบไม่ซ้ำชื่อ)
    const participantCounts = {
      beginner: { students: 0, coaches: 0 },
      intermediate: { students: 0, coaches: 0 },
      advance: { students: 0, coaches: 0 },
      all: { students: 0, coaches: 0 },
    };
    participantsResult.rows.forEach(function (r) {
      const key = Number(r.is_total) === 1 ? "all" : r.tier;
      if (!key) return;
      participantCounts[key] = {
        students: parseInt(r.students) || 0,
        coaches: parseInt(r.coaches) || 0,
      };
    });

    return res.render("teams/index", {
      title: "จัดการทีม",
      pageTitle: "<span>จัดการ</span>ทีมที่สมัคร",
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      counts,
      participantCounts,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    return res.redirect("/board");
  }
});

// ─── POST /teams ──────────────────────────────────────────────────────────────
router.post("/", requireLogin, requireAdmin, async (req, res) => {
  const {
    name,
    institution,
    phone,
    coach,
    coach_email,
    tier,
    student_1,
    student_1_dob,
    student_2,
    student_2_dob,
    student_3,
    student_3_dob,
  } = req.body;
  try {
    const prefix =
      tier === "beginner" ? "B" : tier === "intermediate" ? "I" : "A";
    const countResult = await query(
      "SELECT MAX(CAST(SUBSTRING(id FROM 2 FOR 3) AS INT)) as maxnum FROM teams WHERE tier = $1",
      [tier],
    );
    const num = (parseInt(countResult.rows[0].maxnum) || 0) + 1;
    const id = "T" + String(num).padStart(3, "0") + "_" + prefix;
    await query(
      `INSERT INTO teams (id, name, institution, phone, coach, coach_email, tier,
        student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        name.trim(),
        institution.trim(),
        phone ? phone.trim() : null,
        coach ? coach.trim() : null,
        coach_email ? coach_email.trim() : null,
        tier,
        student_1 ? student_1.trim() : null,
        student_1_dob || null,
        student_2 ? student_2.trim() : null,
        student_2_dob || null,
        student_3 ? student_3.trim() : null,
        student_3_dob || null,
        "pending",
      ],
    );
    req.flash("success", "เพิ่มทีมแล้ว");
    return res.redirect("/teams?tier=" + tier);
  } catch (err) {
    console.error(err);
    req.flash("error", "เพิ่มทีมไม่ได้");
    return res.redirect("/teams?tier=" + (req.body.tier || "beginner"));
  }
});

// ─── PUT /teams/:id ───────────────────────────────────────────────────────────
router.put("/:id", requireLogin, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const tier = req.body.tier || req.query.tier || "beginner";
  const {
    name,
    institution,
    phone,
    coach,
    coach_email,
    status,
    note,
    student_1,
    student_1_dob,
    student_2,
    student_2_dob,
    student_3,
    student_3_dob,
  } = req.body;
  try {
    await query(
      `UPDATE teams SET name=$1, institution=$2, phone=$3, coach=$4, coach_email=$5, tier=$6, status=$7, note=$8,
        student_1=$9, student_1_dob=$10, student_2=$11, student_2_dob=$12,
        student_3=$13, student_3_dob=$14 WHERE id=$15`,
      [
        name.trim(),
        institution.trim(),
        phone ? phone.trim() : null,
        coach ? coach.trim() : null,
        coach_email ? coach_email.trim() : null,
        tier,
        status,
        note ? note.trim() : null,
        student_1 ? student_1.trim() : null,
        student_1_dob || null,
        student_2 ? student_2.trim() : null,
        student_2_dob || null,
        student_3 ? student_3.trim() : null,
        student_3_dob || null,
        id,
      ],
    );
    req.flash("success", "อัปเดตทีมแล้ว");
    return res.redirect("/teams?tier=" + tier);
  } catch (err) {
    console.error(err);
    req.flash("error", "อัปเดตไม่ได้");
    return res.redirect("/teams?tier=" + tier);
  }
});

// ─── DELETE /teams/:id ────────────────────────────────────────────────────────
router.delete("/:id", requireLogin, requireAdmin, async (req, res) => {
  const tier = req.query.tier || "beginner";
  try {
    await query("DELETE FROM scores WHERE team_id = $1", [req.params.id]);
    await query("DELETE FROM teams WHERE id = $1", [req.params.id]);
    req.flash("success", "ลบทีมแล้ว");
  } catch (err) {
    console.error(err);
    req.flash("error", "ลบไม่ได้");
  }
  return res.redirect("/teams?tier=" + tier);
});

// ─── POST /teams/:id/checkin/:studentNum ──────────────────────────────────────
// admin + viewer สลับสถานะ Check-in ได้
router.post(
  "/:id/checkin/:studentNum",
  requireLogin,
  requireCheckinAccess,
  async (req, res) => {
    const { id, studentNum } = req.params;
    const tier = safeTier(req.query.tier);
    const back = "/teams?tier=" + tier;

    if (!["1", "2", "3"].includes(studentNum)) {
      req.flash("error", "ข้อมูลไม่ถูกต้อง");
      return res.redirect(back);
    }

    const col = "student_" + studentNum + "_checked_in";

    try {
      // สลับค่าในคำสั่งเดียว (กดพร้อมกันหลายเครื่องก็ไม่เพี้ยน)
      const result = await query(
        "UPDATE teams SET " +
          col +
          " = NOT COALESCE(" +
          col +
          ", false) WHERE id = $1 RETURNING " +
          col +
          " AS checked_in",
        [id],
      );

      if (!result.rows.length) {
        req.flash("error", "ไม่พบทีมนี้");
      } else {
        req.flash(
          "success",
          result.rows[0].checked_in ? "เช็คชื่อแล้ว" : "ยกเลิกเช็คชื่อแล้ว",
        );
      }
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
    }

    return res.redirect(back);
  },
);

module.exports = router;
