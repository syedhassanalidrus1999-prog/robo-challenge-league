const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { requireLogin, requireAdmin } = require("../middleware/auth");

const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

async function generateTeamId(tier) {
  const prefix =
    tier === "beginner" ? "B" : tier === "intermediate" ? "I" : "A";
  const result = await query(
    "SELECT MAX(CAST(SUBSTRING(id FROM 2 FOR 3) AS INT)) as maxnum FROM teams WHERE tier = $1",
    [tier],
  );
  const num = (parseInt(result.rows[0].maxnum) || 0) + 1;
  return `T${String(num).padStart(3, "0")}_${prefix}`;
}

// GET /teams
router.get("/", requireLogin, requireAdmin, async (req, res) => {
  const tier = req.query.tier || "beginner";
  const search = req.query.search || "";
  try {
    let sql = `SELECT * FROM teams WHERE tier = $1`;
    const params = [tier];
    if (search) {
      sql += ` AND (name ILIKE $2 OR institution ILIKE $2 OR id ILIKE $2)`;
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY created_at ASC`;
    const [teamsResult, countResult] = await Promise.all([
      query(sql, params),
      query(`SELECT tier, COUNT(*) as cnt FROM teams GROUP BY tier`),
    ]);
    const counts = { beginner: 0, intermediate: 0, advance: 0, total: 0 };
    countResult.rows.forEach((r) => {
      counts[r.tier] = parseInt(r.cnt);
      counts.total += parseInt(r.cnt);
    });
    res.render("teams/index", {
      title: "จัดการทีม",
      pageTitle: "<span>จัดการ</span>ทีมที่สมัคร",
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      counts,
      search,
      tier,
      TIER_LABEL,
      TIER_COLOR: { beginner: "green", intermediate: "blue", advance: "amber" },
      STATUS_LABEL: {
        approved: "อนุมัติแล้ว",
        pending: "รอพิจารณา",
        rejected: "ไม่ผ่าน",
      },
      STATUS_BADGE: {
        approved: "badge-green",
        pending: "badge-blue",
        rejected: "badge-red",
      },
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถโหลดข้อมูลทีมได้");
    res.redirect("/board");
  }
});

// POST /teams
router.post("/", requireLogin, requireAdmin, async (req, res) => {
  const {
    name,
    institution,
    tier,
    student_1,
    student_1_dob,
    student_2,
    student_2_dob,
    student_3,
    student_3_dob,
    coach,
    status,
    note,
  } = req.body;
  if (!name || !institution || !tier) {
    req.flash("error", "กรุณากรอกชื่อทีม สถาบัน และรุ่น");
    return res.redirect(`/teams?tier=${tier || "beginner"}`);
  }
  try {
    const id = await generateTeamId(tier);
    await query(
      `
      INSERT INTO teams (id, name, institution, tier, student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob, coach, status, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `,
      [
        id,
        name.trim(),
        institution.trim(),
        tier,
        student_1?.trim() || null,
        student_1_dob || null,
        student_2?.trim() || null,
        student_2_dob || null,
        student_3?.trim() || null,
        student_3_dob || null,
        coach?.trim() || null,
        status || "pending",
        note?.trim() || null,
      ],
    );
    req.flash("success", `เพิ่มทีม "${name}" (${id}) สำเร็จ`);
    res.redirect(`/teams?tier=${tier}`);
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถเพิ่มทีมได้");
    res.redirect(`/teams?tier=${tier}`);
  }
});

// PUT /teams/:id
router.put("/:id", requireLogin, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    institution,
    tier,
    student_1,
    student_1_dob,
    student_2,
    student_2_dob,
    student_3,
    student_3_dob,
    coach,
    status,
    note,
  } = req.body;
  try {
    await query(
      `
      UPDATE teams SET
        name=$1, institution=$2,
        student_1=$3, student_1_dob=$4,
        student_2=$5, student_2_dob=$6,
        student_3=$7, student_3_dob=$8,
        coach=$9, status=$10, note=$11, updated_at=NOW()
      WHERE id=$12
    `,
      [
        name.trim(),
        institution.trim(),
        student_1?.trim() || null,
        student_1_dob || null,
        student_2?.trim() || null,
        student_2_dob || null,
        student_3?.trim() || null,
        student_3_dob || null,
        coach?.trim() || null,
        status,
        note?.trim() || null,
        id,
      ],
    );
    req.flash("success", `อัปเดตทีม "${name}" สำเร็จ`);
    res.redirect(`/teams?tier=${tier}`);
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถอัปเดตทีมได้");
    res.redirect("/teams");
  }
});

// DELETE /teams/:id
router.delete("/:id", requireLogin, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { tier } = req.query;
  try {
    await query("DELETE FROM teams WHERE id = $1", [id]);
    req.flash("success", `ลบทีม ${id} แล้ว`);
    res.redirect(`/teams?tier=${tier || "beginner"}`);
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถลบทีมได้");
    res.redirect("/teams");
  }
});

router.get("/board", requireLogin, (req, res) => {
  if (req.session.user.role === "admin") return res.redirect("/teams");
  res.redirect("/scores");
});

module.exports = router;
