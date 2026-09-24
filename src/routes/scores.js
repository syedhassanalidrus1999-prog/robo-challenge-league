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

function handleUpload(req, res, next) {
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ])(req, res, function (err) {
    if (err) {
      console.error("Multer error:", err.message);
      req.flash("error", "อัปโหลดไฟล์ไม่ได้: " + err.message);
      return res.redirect("/scores");
    }
    next();
  });
}

// ============================================================================
// HELPERS
// ============================================================================

const VALID_ROUNDS = [1, 2];

// เรียงด้วย id ด้วย เพื่อให้ลำดับคงที่ทุกครั้ง
const CRITERIA_BY_TIER_SQL =
  "SELECT * FROM criteria WHERE tier = $1 ORDER BY mission, id";

function parseRound(value) {
  const round = parseInt(value, 10);
  return VALID_ROUNDS.includes(round) ? round : null;
}

function parsePieces(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function calcMaxScore(criteria) {
  return criteria.reduce(
    (sum, c) =>
      sum + (parseFloat(c.max_score) || 0) * (parseInt(c.max_pieces, 10) || 1),
    0,
  );
}

// ค่าที่เคยบันทึกไว้ → { [criteria_id]: { full, partial } }
function buildPrevMap(criteria, existing) {
  const map = {};

  if (!existing) return map;

  const details = Array.isArray(existing.mission_details)
    ? existing.mission_details
    : [];

  if (details.length) {
    for (const d of details) {
      map[String(d.criteria_id)] = {
        full: parseInt(d.full, 10) || 0,
        partial: parseInt(d.partial, 10) || 0,
      };
    }
    return map;
  }

  // ข้อมูลเก่าก่อน migration: มีแค่ mission_1..5 ตามลำดับ
  criteria.slice(0, 5).forEach((c, i) => {
    const n = i + 1;
    map[String(c.id)] = {
      full: parseInt(existing[`mission_${n}_full`], 10) || 0,
      partial: parseInt(existing[`mission_${n}_partial`], 10) || 0,
    };
  });

  return map;
}

// คำนวณคะแนนทุกเกณฑ์จาก req.body (ช่องกรอกชื่อ crit_<id>_full / crit_<id>_partial)
function calcMissionDetails(criteria, body) {
  return criteria.map((c) => {
    const maxPieces = Math.max(1, parseInt(c.max_pieces, 10) || 1);
    const allowPartial = c.score_type === "both";

    const full = Math.min(parsePieces(body[`crit_${c.id}_full`]), maxPieces);

    const partial = allowPartial
      ? Math.min(parsePieces(body[`crit_${c.id}_partial`]), maxPieces - full)
      : 0;

    const scoreFull = parseFloat(c.max_score) || 0;
    const scorePartial = allowPartial ? parseFloat(c.score_partial) || 0 : 0;

    return {
      criteria_id: c.id,
      mission: c.mission,
      name: c.name,
      full,
      partial,
      score_full: scoreFull,
      score_partial: scorePartial,
      total: round2(full * scoreFull + partial * scorePartial),
    };
  });
}

// ─── GET /scores ──────────────────────────────────────────────────────────────
router.get("/", requireLogin, requireJudge, async (req, res) => {
  const user = req.session.user;
  const tier = user.role === "admin" ? req.query.tier || "beginner" : user.tier;
  try {
    const [teamsResult, criteriaResult] = await Promise.all([
      query(
        `SELECT t.*,
          s1.total_score as r1_score, s1.time_seconds as r1_time,
          s2.total_score as r2_score, s2.time_seconds as r2_time
        FROM teams t
        LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
        LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
        WHERE t.tier = $1
        ORDER BY t.created_at ASC`,
        [tier],
      ),
      query(CRITERIA_BY_TIER_SQL, [tier]),
    ]);

    res.render("scores/index", {
      title: "ลงคะแนน",
      pageTitle: "<span>ลงคะแนน</span>การแข่งขัน",
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      criteria: criteriaResult.rows,
      maxScore: calcMaxScore(criteriaResult.rows),
      tier,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "ไม่สามารถโหลดข้อมูลได้");
    res.redirect("/board");
  }
});

// ─── GET /scores/:teamId/:round ───────────────────────────────────────────────
router.get(
  "/:teamId/:round",
  requireLogin,
  requireJudge,
  requireTierAccess,
  async (req, res) => {
    const { teamId } = req.params;
    const round = parseRound(req.params.round);
    const user = req.session.user;

    if (!round) {
      req.flash("error", "รอบไม่ถูกต้อง");
      return res.redirect("/scores");
    }

    try {
      const [teamResult, existingResult] = await Promise.all([
        query("SELECT * FROM teams WHERE id = $1", [teamId]),
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

      const criteriaResult = await query(CRITERIA_BY_TIER_SQL, [team.tier]);
      const criteria = criteriaResult.rows;
      const existing = existingResult.rows[0] || null;

      res.render("scores/form", {
        layout: false,
        title: "ลงคะแนน " + team.name + " รอบ " + round,
        pageTitle: "<span>ลงคะแนน</span> — รอบที่ " + round,
        tierSelector: false,
        activeTier: team.tier,
        team,
        round,
        criteria,
        existing,
        prevMap: buildPrevMap(criteria, existing),
        maxScore: calcMaxScore(criteria),
      });
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
      res.redirect("/scores");
    }
  },
);

// ─── POST /scores/:teamId/:round ──────────────────────────────────────────────
router.post(
  "/:teamId/:round",
  requireLogin,
  requireJudge,
  handleUpload,
  async (req, res) => {
    const { teamId } = req.params;
    const round = parseRound(req.params.round);
    const user = req.session.user;

    if (!round) {
      req.flash("error", "รอบไม่ถูกต้อง");
      return res.redirect("/scores");
    }

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

      const criteriaResult = await query(CRITERIA_BY_TIER_SQL, [team.tier]);

      // ---------------- คะแนน ----------------

      const details = calcMissionDetails(criteriaResult.rows, req.body);

      const totalScore = round2(details.reduce((sum, d) => sum + d.total, 0));

      // คอลัมน์เดิม mission_1..5 ยังเขียนไว้ เผื่อหน้าอื่นยังอ่านอยู่
      const empty = { total: 0, full: 0, partial: 0 };
      const legacy = [0, 1, 2, 3, 4].map((i) => details[i] || empty);

      // ---------------- เวลา ----------------

      const timeRaw = parseFloat(req.body.time_seconds);
      const timeSeconds =
        Number.isFinite(timeRaw) && timeRaw >= 0 ? round2(timeRaw) : null;

      // ---------------- รูป / ลายเซ็น ----------------

      const photoUrl =
        req.files && req.files.photo ? req.files.photo[0].path : null;

      let signatureUrl = null;
      const sigData = Array.isArray(req.body.signature_data)
        ? req.body.signature_data[0]
        : req.body.signature_data;

      if (
        sigData &&
        typeof sigData === "string" &&
        sigData.startsWith("data:image")
      ) {
        try {
          const uploadResult = await cloudinary.uploader.upload(sigData, {
            folder: "robo-league/signatures",
          });
          signatureUrl = uploadResult.secure_url;
        } catch (sigErr) {
          console.error("Signature upload error:", sigErr.message);
        }
      }

      // ---------------- บันทึก ----------------

      await query(
        `INSERT INTO scores (
          team_id, judge_id, round,
          mission_1, mission_1_full, mission_1_partial,
          mission_2, mission_2_full, mission_2_partial,
          mission_3, mission_3_full, mission_3_partial,
          mission_4, mission_4_full, mission_4_partial,
          mission_5, mission_5_full, mission_5_partial,
          time_seconds, photo_url, signature_url,
          mission_details, total_score
        ) VALUES (
          $1,$2,$3,
          $4,$5,$6, $7,$8,$9, $10,$11,$12, $13,$14,$15, $16,$17,$18,
          $19,$20,$21,
          $22::jsonb, $23
        )
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
          mission_details=$22::jsonb,
          total_score=$23,
          scored_at=NOW()`,
        [
          teamId,
          parseInt(user.id, 10),
          round,
          ...legacy.flatMap((m) => [m.total, m.full, m.partial]),
          timeSeconds,
          photoUrl,
          signatureUrl,
          JSON.stringify(details),
          totalScore,
        ],
      );

      req.flash(
        "success",
        "บันทึกคะแนนรอบ " +
          round +
          ' ของทีม "' +
          team.name +
          '" สำเร็จ (' +
          totalScore +
          " คะแนน)",
      );
      res.redirect("/scores");
    } catch (err) {
      console.error("SCORE POST ERROR:", err.message, err.stack);
      req.flash("error", "ไม่สามารถบันทึกคะแนนได้");
      res.redirect("/scores");
    }
  },
);

module.exports = router;
