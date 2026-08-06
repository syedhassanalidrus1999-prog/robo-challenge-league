const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const {
  requireLogin,
  requireJudge,
  requireTierAccess,
} = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "robo-league/scores",
    allowed_formats: ["jpg", "jpeg", "png"],
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /scores
router.get("/", requireLogin, requireJudge, async (req, res) => {
  const user = req.session.user;
  const tier = user.role === "admin" ? req.query.tier || "beginner" : user.tier;
  try {
    const [teamsResult, criteriaResult] = await Promise.all([
      query(
        `
        SELECT t.*,
          s1.total_score as r1_score, s1.time_seconds as r1_time,
          s2.total_score as r2_score, s2.time_seconds as r2_time
        FROM teams t
        LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
        LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
        WHERE t.tier = $1
        ORDER BY t.created_at ASC
      `,
        [tier],
      ),
      query(`SELECT * FROM criteria WHERE tier = $1 ORDER BY mission`, [tier]),
    ]);
    const maxScore = criteriaResult.rows.reduce(
      (s, c) => s + parseFloat(c.max_score),
      0,
    );
    res.render("scores/index", {
      title: "ลงคะแนน",
      pageTitle: "<span>ลงคะแนน</span>การแข่งขัน",
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      criteria: criteriaResult.rows,
      maxScore,
      tier,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถโหลดข้อมูลได้");
    res.redirect("/dashboard");
  }
});

// GET /scores/:teamId/:round
router.get(
  "/:teamId/:round",
  requireLogin,
  requireJudge,
  requireTierAccess,
  async (req, res) => {
    const { teamId, round } = req.params;
    const user = req.session.user;
    try {
      const [teamResult, criteriaResult, existingResult] = await Promise.all([
        query("SELECT * FROM teams WHERE id = $1", [teamId]),
        query(
          "SELECT * FROM criteria WHERE tier = (SELECT tier FROM teams WHERE id = $1) ORDER BY mission",
          [teamId],
        ),
        query("SELECT * FROM scores WHERE team_id = $1 AND round = $2", [
          teamId,
          round,
        ]),
      ]);
      const team = teamResult.rows[0];
      if (!team) {
        req.flash("error", "ไม่พบทีมนี้");
        return res.redirect("/scores");
      }
      if (user.role === "judge" && user.tier !== team.tier) {
        req.flash("error", "คุณเป็นกรรมการรุ่น " + user.tier + " เท่านั้น");
        return res.redirect("/scores");
      }
      const existing = existingResult.rows[0] || null;
      const maxScore = criteriaResult.rows.reduce(
        (s, c) => s + parseFloat(c.max_score),
        0,
      );
      res.render("scores/form", {
        layout: "layouts/main",
        title: "ลงคะแนน " + team.name + " รอบ " + round,
        pageTitle: "<span>ลงคะแนน</span> — รอบที่ " + round,
        tierSelector: false,
        activeTier: team.tier,
        team,
        round: parseInt(round),
        criteria: criteriaResult.rows,
        existing,
        maxScore,
      });
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
      res.redirect("/scores");
    }
  },
);

// POST /scores/:teamId/:round
router.post(
  "/:teamId/:round",
  requireLogin,
  requireJudge,
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  async (req, res) => {
    const { teamId, round } = req.params;
    const user = req.session.user;
    const { time_seconds } = req.body;
    try {
      const teamResult = await query("SELECT * FROM teams WHERE id = $1", [
        teamId,
      ]);
      const team = teamResult.rows[0];
      if (!team) {
        req.flash("error", "ไม่พบทีมนี้");
        return res.redirect("/scores");
      }
      if (user.role === "judge" && user.tier !== team.tier) {
        req.flash("error", "คุณไม่มีสิทธิ์ลงคะแนนรุ่นนี้");
        return res.redirect("/scores");
      }

      const criteriaResult = await query(
        "SELECT * FROM criteria WHERE tier = $1 ORDER BY mission",
        [team.tier],
      );

      const missionScores = criteriaResult.rows.map(function (c, i) {
        var n = i + 1;
        var fullCount = parseFloat(req.body["mission_" + n + "_full"]) || 0;
        var partialCount =
          c.score_type === "both"
            ? parseFloat(req.body["mission_" + n + "_partial"]) || 0
            : 0;
        var scorePerFull = parseFloat(c.max_score);
        var scorePerPartial = parseFloat(c.score_partial) || 0;
        var total = fullCount * scorePerFull + partialCount * scorePerPartial;
        return { full: fullCount, partial: partialCount, total: total };
      });

      var mission1 = missionScores[0] || { total: 0, full: 0, partial: 0 };
      var mission2 = missionScores[1] || { total: 0, full: 0, partial: 0 };
      var mission3 = missionScores[2] || { total: 0, full: 0, partial: 0 };
      var mission4 = missionScores[3] || { total: 0, full: 0, partial: 0 };
      var mission5 = missionScores[4] || { total: 0, full: 0, partial: 0 };

      var photoUrl = req.files && req.files.photo ? req.files.photo[0].path : null;

// signature จาก base64
var signatureUrl = null;
if (req.body.signature_data && req.body.signature_data.startsWith('data:image')) {
  try {
    var uploadResult = await cloudinary.uploader.upload(req.body.signature_data, {
      folder: 'robo-league/signatures'
    });
    signatureUrl = uploadResult.secure_url;
  } catch (sigErr) {
    console.error('Signature upload error:', sigErr.message);
  }
}

await query(
  `
  INSERT INTO scores (
    team_id, judge_id, round,
    mission_1, mission_1_full, mission_1_partial,
    mission_2, mission_2_full, mission_2_partial,
    mission_3, mission_3_full, mission_3_partial,
    mission_4, mission_4_full, mission_4_partial,
    mission_5, mission_5_full, mission_5_partial,
    time_seconds, photo_url, signature_url
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
  ON CONFLICT (team_id, round) DO UPDATE SET
    judge_id=$2,
    mission_1=$4, mission_1_full=$5, mission_1_partial=$6,
    mission_2=$7, mission_2_full=$8, mission_2_partial=$9,
    mission_3=$10, mission_3_full=$11, mission_3_partial=$12,
    mission_4=$13, mission_4_full=$14, mission_4_partial=$15,
    mission_5=$16, mission_5_full=$17, mission_5_partial=$18,
    time_seconds=$19,
    photo_url=COALESCE($20, scores.photo_url),
    signature_url=COALESCE($21, scores.signature_url),
    scored_at=NOW()
  `,
  [
    teamId, user.id, parseInt(round),
    mission1.total, mission1.full, mission1.partial,
    mission2.total, mission2.full, mission2.partial,
    mission3.total, mission3.full, mission3.partial,
    mission4.total, mission4.full, mission4.partial,
    mission5.total, mission5.full, mission5.partial,
    time_seconds ? parseFloat(time_seconds) : null,
    photoUrl, signatureUrl
  ]
);

req.flash('success', 'บันทึกคะแนนรอบ ' + round + ' ของทีม "' + team.name + '" สำเร็จ');
res.redirect('/scores');
} catch (err) {
  console.error('SCORE POST ERROR:', err.message, err.stack);
  req.flash('error', 'ไม่สามารถบันทึกคะแนนได้');
  res.redirect('/scores');
}

module.exports = router;
