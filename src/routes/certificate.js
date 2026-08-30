const express = require("express");
const router = express.Router();
const { query } = require("../config/database");

// ─── GET /certificate ─────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.render("certificate/index", {
    layout: false,
    title: "ดาวน์โหลดเกียรติบัตร",
  });
});

// ─── GET /certificate/search ──────────────────────────────────────────────────
router.get("/search", async (req, res) => {
  var q = req.query.q || "";
  if (!q) return res.json({ teams: [] });

  try {
    // ดึง ranked ทุก tier เพื่อหาอันดับ
    var rankedAll = {};
    var tiers = ["beginner", "intermediate", "advance"];
    for (var i = 0; i < tiers.length; i++) {
      var tier = tiers[i];
      var r = await query(
        `SELECT t.id,
          GREATEST(COALESCE(s1.total_score,0), COALESCE(s2.total_score,0)) AS best_score,
          LEAST(
            CASE WHEN s1.is_published THEN COALESCE(s1.time_seconds,999999) ELSE 999999 END,
            CASE WHEN s2.is_published THEN COALESCE(s2.time_seconds,999999) ELSE 999999 END
          ) AS best_time
        FROM teams t
        LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
        LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
        WHERE t.tier = $1 AND t.status = 'approved'
        ORDER BY best_score DESC, best_time ASC`,
        [tier],
      );
      r.rows.forEach(function (row, idx) {
        rankedAll[row.id] = idx + 1;
      });
    }

    // ค้นหาทีม
    var teamsResult = await query(
      `SELECT id, name, institution, tier,
        student_1, student_1_checked_in,
        student_2, student_2_checked_in,
        student_3, student_3_checked_in
       FROM teams
       WHERE status = 'approved'
       AND (id ILIKE $1 OR name ILIKE $1 OR institution ILIKE $1)
       ORDER BY created_at ASC`,
      ["%" + q + "%"],
    );

    var teams = teamsResult.rows.map(function (t) {
      var rank = rankedAll[t.id] || null;

      // cert types สำหรับทีม (อันดับ)
      var teamCertTypes = [];
      if (rank === 1) teamCertTypes.push("1st");
      else if (rank === 2) teamCertTypes.push("2nd");
      else if (rank === 3) teamCertTypes.push("3rd");

      // students พร้อม checked_in
      var students = [];
      if (t.student_1)
        students.push({
          name: t.student_1,
          checked_in: t.student_1_checked_in,
        });
      if (t.student_2)
        students.push({
          name: t.student_2,
          checked_in: t.student_2_checked_in,
        });
      if (t.student_3)
        students.push({
          name: t.student_3,
          checked_in: t.student_3_checked_in,
        });

      return {
        id: t.id,
        name: t.name,
        institution: t.institution,
        tier: t.tier,
        rank: rank,
        team_cert_types: teamCertTypes,
        students: students,
      };
    });

    res.json({ teams: teams });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "เกิดข้อผิดพลาด" });
  }
});

// ─── GET /certificate/download ────────────────────────────────────────────────
router.get("/download", async (req, res) => {
  var { teamId, studentName, certType } = req.query;
  if (!teamId || !studentName || !certType)
    return res.status(400).send("ข้อมูลไม่ครบ");

  try {
    var teamResult = await query(
      "SELECT * FROM teams WHERE id = $1 AND status = $2",
      [teamId, "approved"],
    );
    var team = teamResult.rows[0];
    if (!team) return res.status(404).send("ไม่พบทีม");

    var tmplResult = await query(
      "SELECT * FROM certificate_templates WHERE tier = $1 AND cert_type = $2",
      [team.tier, certType],
    );
    var tmpl = tmplResult.rows[0];
    if (!tmpl || !tmpl.background_url) {
      return res
        .status(404)
        .send("ยังไม่มี template เกียรติบัตร กรุณาติดต่อผู้จัดงาน");
    }

    var nameX = tmpl.name_x || 50;
    var nameY = tmpl.name_y || 45;
    var fontSize = tmpl.name_font_size || 48;
    var nameColor = tmpl.name_color || "#000000";

    var html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:21cm; height:29.7cm; overflow:hidden; }
    .cert-page { position:relative; width:21cm; height:29.7cm; overflow:hidden; }
    .cert-bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .cert-name {
      position:absolute; left:${nameX}%; top:${nameY}%;
      transform:translate(-50%,-50%);
      font-family:'Kanit',sans-serif; font-size:${fontSize}px;
      font-weight:700; color:${nameColor};
      white-space:nowrap; text-align:center; z-index:10;
    }
    @media print {
      @page { size:A4 portrait; margin:0; }
      html, body { width:21cm; height:29.7cm; }
    }
  </style>
</head>
<body>
  <div class="cert-page">
    <img class="cert-bg" src="${tmpl.background_url}" crossorigin="anonymous">
    <div class="cert-name">${studentName}</div>
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});

module.exports = router;
