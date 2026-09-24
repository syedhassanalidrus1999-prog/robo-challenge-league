const express = require("express");
const router = express.Router();
const { query } = require("../config/database");

// ============================================================================
// CONSTANTS
// ============================================================================

const ALLOWED_TYPES = [
  "gold",
  "silver",
  "bronze",
  "participation",
  "rank_1",
  "rank_2",
  "rank_3",
];

// Arial ไม่มีตัวอักษรไทย → ใส่ฟอนต์ไทยไว้ก่อน
const SVG_FONT = "Sarabun, Tahoma, 'Leelawadee UI', Arial, sans-serif";

// ============================================================================
// MEDAL
// ============================================================================

function getMedalType(score, maxScore) {
  const s = parseFloat(score || 0);
  const m = parseFloat(maxScore || 0);

  if (m <= 0) return null;

  const pct = (s / m) * 100;

  if (pct > 80) return "gold";
  if (pct >= 51) return "silver"; // หมายเหตุ: 50.01–50.99% จะตกไป bronze
  if (pct >= 30) return "bronze";

  return null;
}

function getMedalLabel(medal) {
  if (medal === "gold") return "🥇 ทอง (>80%)";
  if (medal === "silver") return "🥈 เงิน (51-80%)";
  if (medal === "bronze") return "🥉 ทองแดง (30-50%)";

  return null;
}

// ============================================================================
// BASIC HELPERS
// ============================================================================

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function backToCertificatePage(teamId) {
  return "/certificate?team_id=" + encodeURIComponent(teamId || "");
}

// ============================================================================
// STUDENTS / CHECK-IN
// ============================================================================

function getStudentList(team) {
  const students = [];

  for (let i = 1; i <= 3; i++) {
    const name = team[`student_${i}`];

    if (name && String(name).trim()) {
      students.push({
        number: i,
        name: String(name).trim(),
        checkedIn: Boolean(team[`student_${i}_checked_in`]),
      });
    }
  }

  return students;
}

function hasAnyStudentCheckedIn(team) {
  return getStudentList(team).some((student) => student.checkedIn);
}

// หานักเรียนจาก studentName หรือ student_id
// ต้องเป็นนักเรียนในทีมนี้เท่านั้น (กันการใส่ชื่อมั่ว)
function resolveStudent(team, req) {
  const students = getStudentList(team);

  const rawName = req.query.studentName || req.query.student_name;

  if (rawName && String(rawName).trim()) {
    const name = String(rawName).trim();
    return students.find((s) => s.name === name) || null;
  }

  const number = parseInt(req.query.student_id || req.query.student || "", 10);

  if (Number.isInteger(number)) {
    return students.find((s) => s.number === number) || null;
  }

  return null;
}

// ============================================================================
// SCORE
// ============================================================================

async function getMaxScore(tier) {
  const result = await query(
    `
      SELECT
        COALESCE(
          SUM(COALESCE(max_score, 0) * COALESCE(max_pieces, 1)),
          0
        ) AS total
      FROM criteria
      WHERE tier = $1
    `,
    [tier],
  );

  return parseFloat(result.rows[0]?.total || 0);
}

function getBestScore(scores) {
  if (!scores || !scores.length) {
    return 0;
  }

  return scores.reduce((best, score) => {
    const current = parseFloat(score.total_score || 0);
    return Math.max(best, current);
  }, 0);
}

// ============================================================================
// RANKING
// ============================================================================
//
// ใช้หลัก:
// 1. คะแนนสูงสุดมาก่อน
// 2. ถ้าคะแนนเท่ากัน เวลาน้อยกว่ามาก่อน
//    - ถ้า R1 = R2 ใช้เวลาที่ดีที่สุดของทั้งสองรอบ
// 3. ถ้ายังเท่ากัน เรียงตาม team id (ให้ผลคงที่ทุกครั้ง)
//
// ทีมที่ยังไม่มีคะแนน (best_score = 0) จะไม่ได้อันดับ (rank = null)
// ไม่กรอง is_published เพื่อให้ตรงกับหน้า Board
// ============================================================================

async function getRanking(tier) {
  const result = await query(
    `
      SELECT
        t.id,
        t.name,
        t.institution,
        t.status,
        t.tier,

        s1.total_score AS r1_score,
        s1.time_seconds AS r1_time,

        s2.total_score AS r2_score,
        s2.time_seconds AS r2_time,

        GREATEST(
          COALESCE(s1.total_score, 0),
          COALESCE(s2.total_score, 0)
        ) AS best_score,

        CASE
          WHEN COALESCE(s1.total_score, -1) > COALESCE(s2.total_score, -1)
            THEN s1.time_seconds
          WHEN COALESCE(s2.total_score, -1) > COALESCE(s1.total_score, -1)
            THEN s2.time_seconds
          ELSE LEAST(s1.time_seconds, s2.time_seconds)
        END AS best_time

      FROM teams t

      LEFT JOIN scores s1
        ON s1.team_id = t.id
        AND s1.round = 1

      LEFT JOIN scores s2
        ON s2.team_id = t.id
        AND s2.round = 2

      WHERE t.tier = $1

      ORDER BY
        best_score DESC,
        best_time ASC NULLS LAST,
        t.id ASC
    `,
    [tier],
  );

  let counter = 0;

  return result.rows.map((team) => {
    const hasScore = parseFloat(team.best_score || 0) > 0;

    return {
      ...team,
      rank: hasScore ? ++counter : null,
    };
  });
}

async function getTeamRank(teamId, tier) {
  const ranking = await getRanking(tier);

  const team = ranking.find((t) => String(t.id) === String(teamId));

  if (!team || team.rank === null) {
    return null;
  }

  return {
    rank: team.rank,
    totalTeams: ranking.filter((t) => t.rank !== null).length,
    team,
  };
}

// ============================================================================
// CERTIFICATE TYPE
// ============================================================================

function normalizeCertificateType(type) {
  if (!type) return null;

  const value = String(type).trim();

  // หน้า Certificate เดิมใช้ 1st / 2nd / 3rd
  if (value === "1st") return "rank_1";
  if (value === "2nd") return "rank_2";
  if (value === "3rd") return "rank_3";

  return value;
}

function isRankCertificate(type) {
  return ["rank_1", "rank_2", "rank_3"].includes(type);
}

function isMedalCertificate(type) {
  return ["gold", "silver", "bronze"].includes(type);
}

function rankFromType(type) {
  if (type === "rank_1") return 1;
  if (type === "rank_2") return 2;
  if (type === "rank_3") return 3;

  return null;
}

// ============================================================================
// TEMPLATE
// ============================================================================

function findTemplate(templates, tier, certType) {
  return (
    templates.find(
      (template) => template.tier === tier && template.cert_type === certType,
    ) || null
  );
}

// ============================================================================
// VALIDATE (ใช้ร่วมกันระหว่าง /download และ /generate)
// ============================================================================

function fail(status, message) {
  return { ok: false, status, message };
}

async function validateCertificateRequest(req) {
  const teamId = req.query.team_id || req.query.teamId;
  const type = normalizeCertificateType(req.query.type || req.query.certType);

  if (!teamId || !ALLOWED_TYPES.includes(type)) {
    return fail(400, "ข้อมูลเกียรติบัตรไม่ถูกต้อง");
  }

  // ---------------- Team ----------------

  const teamResult = await query(`SELECT * FROM teams WHERE id = $1 LIMIT 1`, [
    teamId,
  ]);

  if (!teamResult.rows.length) {
    return fail(404, "ไม่พบข้อมูลทีม");
  }

  const team = teamResult.rows[0];

  // ---------------- Template ----------------

  const templateResult = await query(
    `
      SELECT *
      FROM certificate_templates
      WHERE tier = $1
        AND cert_type = $2
      LIMIT 1
    `,
    [team.tier, type],
  );

  if (!templateResult.rows.length) {
    console.error("Certificate template not found:", {
      team_id: teamId,
      tier: team.tier,
      type,
    });

    return fail(404, "ยังไม่มี Template สำหรับเกียรติบัตรประเภทนี้");
  }

  const template = templateResult.rows[0];

  // ---------------- Check-in ----------------

  if (!hasAnyStudentCheckedIn(team)) {
    return fail(403, "ทีมนี้ยังไม่มีผู้เข้าแข่งขัน Check-in");
  }

  // ---------------- Student ----------------

  let student = resolveStudent(team, req);

  // Participation ต้องระบุผู้เข้าแข่งขัน
  if (type === "participation") {
    if (!student) {
      return fail(400, "ไม่พบชื่อผู้เข้าแข่งขันในทีมนี้");
    }

    if (!student.checkedIn) {
      return fail(403, "ผู้เข้าแข่งขันยังไม่ได้ Check-in");
    }
  }

  // Rank / Medal
  // ถ้าไม่ได้ส่ง student มา ให้ใช้ผู้ที่ Check-in คนแรก
  if (!student) {
    student = getStudentList(team).find((s) => s.checkedIn);
  }

  if (!student) {
    return fail(403, "ไม่พบผู้เข้าแข่งขันที่ Check-in");
  }

  // ---------------- Score ----------------

  const scoresResult = await query(
    `SELECT * FROM scores WHERE team_id = $1 ORDER BY round ASC`,
    [teamId],
  );

  const maxScore = await getMaxScore(team.tier);
  const bestScore = getBestScore(scoresResult.rows);

  // ---------------- Medal ----------------

  let medalLabel = null;

  if (isMedalCertificate(type)) {
    const medal = getMedalType(bestScore, maxScore);

    if (medal !== type) {
      return fail(403, "ทีมนี้ไม่มีสิทธิ์สำหรับเกียรติบัตรประเภทนี้");
    }

    medalLabel = getMedalLabel(medal);
  }

  // ---------------- Rank ----------------

  let rank = null;

  if (isRankCertificate(type)) {
    const rankData = await getTeamRank(team.id, team.tier);

    if (!rankData) {
      return fail(403, "ไม่พบอันดับของทีม");
    }

    if (rankData.rank !== rankFromType(type)) {
      return fail(403, "ทีมนี้ไม่มีสิทธิ์สำหรับเกียรติบัตรอันดับนี้");
    }

    rank = rankData.rank;
  }

  return {
    ok: true,
    type,
    team,
    template,
    student,
    bestScore,
    maxScore,
    medalLabel,
    rank,
  };
}

// ============================================================================
// GENERATE SVG
// ============================================================================

function svgText({ y, size, fill, bold = false, content }) {
  if (!content) return "";

  return `
  <text
    x="50%"
    y="${y}"
    text-anchor="middle"
    font-family="${SVG_FONT}"
    font-size="${size}"
    ${bold ? 'font-weight="700"' : ""}
    fill="${fill}"
  >${content}</text>`;
}

function createCertificateSvg({
  template,
  name,
  team,
  type,
  rank,
  medalLabel,
  score,
  maxScore,
}) {
  if (!template || !template.background_url) {
    throw new Error("CERTIFICATE_BACKGROUND_MISSING");
  }

  const num = (value, fallback) =>
    Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;

  const x = num(template.name_x, 50);
  const y = num(template.name_y, 50);
  const fontSize = num(template.name_font_size, 48);
  const fontColor = template.name_color || "#111827";

  const titles = {
    participation: "CERTIFICATE OF PARTICIPATION",
    rank_1: "FIRST PLACE",
    rank_2: "SECOND PLACE",
    rank_3: "THIRD PLACE",
    gold: "GOLD MEDAL",
    silver: "SILVER MEDAL",
    bronze: "BRONZE MEDAL",
  };

  const safeBackground = escapeXml(template.background_url);
  const safeName = escapeXml(name);
  const safeTitle = escapeXml(titles[type] || "");
  const safeTeam = escapeXml(team.name || "");
  const safeInstitution = escapeXml(team.institution || "");

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  const safeScore =
    score > 0 && maxScore > 0
      ? escapeXml(`${score} / ${maxScore} คะแนน (${percentage}%)`)
      : "";

  const safeRank = rank && rank <= 3 ? escapeXml(`อันดับ ${rank}`) : "";
  const safeMedal = escapeXml(medalLabel || "");

  // rank กับ medal ไม่มีทางมีพร้อมกัน → ใช้ตำแหน่ง 86% ร่วมกัน
  const safeBadge = safeRank || safeMedal;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="3508"
  height="2480"
  viewBox="0 0 3508 2480"
>
  <image
    href="${safeBackground}"
    xlink:href="${safeBackground}"
    x="0"
    y="0"
    width="3508"
    height="2480"
    preserveAspectRatio="xMidYMid slice"
  />
${svgText({ y: "20%", size: 64, fill: "#111827", bold: true, content: safeTitle })}

  <text
    x="${x}%"
    y="${y}%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${SVG_FONT}"
    font-size="${fontSize}"
    font-weight="700"
    fill="${escapeXml(fontColor)}"
  >${safeName}</text>
${svgText({ y: "76%", size: 38, fill: "#334155", content: safeTeam })}
${svgText({ y: "80%", size: 32, fill: "#64748B", content: safeInstitution })}
${svgText({ y: "86%", size: 34, fill: "#111827", bold: true, content: safeBadge })}
${svgText({ y: "91%", size: 28, fill: "#64748B", content: safeScore })}
</svg>`;
}

// ============================================================================
// GET /certificate
// ============================================================================

router.get("/", async (req, res) => {
  const { team_id } = req.query;

  const emptyRender = (errorMsg) =>
    res.render("certificate/index", {
      layout: false,

      team: null,
      scores: [],
      checkedIn: false,

      bestScore: 0,
      maxScore: 0,

      medal: null,
      medalLabel: null,
      medalPct: 0,

      rank: null,

      participationTemplate: null,

      rank1Template: null,
      rank2Template: null,
      rank3Template: null,

      goldTemplate: null,
      silverTemplate: null,
      bronzeTemplate: null,

      errorMsg,
    });

  if (!team_id) {
    return emptyRender("ไม่พบรหัสทีม");
  }

  try {
    const teamResult = await query(
      `SELECT * FROM teams WHERE id = $1 LIMIT 1`,
      [team_id],
    );

    if (!teamResult.rows.length) {
      return emptyRender("ไม่พบข้อมูลทีม");
    }

    const team = teamResult.rows[0];

    // หน้านี้ต้องใช้ Template ทุกประเภทของ tier นี้
    const [templatesResult, scoresResult, maxScore, rankData] =
      await Promise.all([
        query(`SELECT * FROM certificate_templates WHERE tier = $1`, [
          team.tier,
        ]),
        query(`SELECT * FROM scores WHERE team_id = $1 ORDER BY round ASC`, [
          team_id,
        ]),
        getMaxScore(team.tier),
        getTeamRank(team.id, team.tier),
      ]);

    const templates = templatesResult.rows;
    const scores = scoresResult.rows;

    const bestScore = getBestScore(scores);
    const medal = getMedalType(bestScore, maxScore);
    const medalLabel = getMedalLabel(medal);
    const medalPct =
      maxScore > 0 ? Math.round((bestScore / maxScore) * 100) : 0;

    const tpl = (certType) => findTemplate(templates, team.tier, certType);

    return res.render("certificate/index", {
      layout: false,

      team,
      scores,
      checkedIn: hasAnyStudentCheckedIn(team),

      bestScore,
      maxScore,

      medal,
      medalLabel,
      medalPct,

      rank: rankData ? rankData.rank : null,

      participationTemplate: tpl("participation"),

      rank1Template: tpl("rank_1"),
      rank2Template: tpl("rank_2"),
      rank3Template: tpl("rank_3"),

      goldTemplate: tpl("gold"),
      silverTemplate: tpl("silver"),
      bronzeTemplate: tpl("bronze"),

      errorMsg: null,
    });
  } catch (err) {
    console.error("Certificate page error:", err);

    return emptyRender("เกิดข้อผิดพลาด");
  }
});

// ============================================================================
// GET /certificate/search
// ============================================================================

router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.json({ teams: [] });
  }

  try {
    const searchText = q.replace(/\s+/g, "_");

    const result = await query(
      `
        SELECT *
        FROM teams
        WHERE
          (
            LOWER(id) LIKE LOWER($1)
            OR LOWER(REPLACE(id, '_', ' ')) LIKE LOWER($2)
            OR LOWER(name) LIKE LOWER($3)
            OR LOWER(institution) LIKE LOWER($3)
          )
        ORDER BY created_at ASC
        LIMIT 50
      `,
      [`%${searchText}%`, `%${q}%`, `%${q}%`],
    );

    const foundTeams = result.rows;

    if (!foundTeams.length) {
      return res.json({ teams: [] });
    }

    // ------------------------------------------------------------
    // ดึงข้อมูลครั้งเดียวต่อ tier แทนการ query ซ้ำทุกทีม
    // ------------------------------------------------------------

    const tiers = [...new Set(foundTeams.map((t) => t.tier))];

    const rankByTier = new Map();
    const maxScoreByTier = new Map();

    await Promise.all(
      tiers.map(async (tier) => {
        const [ranking, maxScore] = await Promise.all([
          getRanking(tier),
          getMaxScore(tier),
        ]);

        rankByTier.set(
          tier,
          new Map(ranking.map((t) => [String(t.id), t.rank])),
        );
        maxScoreByTier.set(tier, maxScore);
      }),
    );

    // Scores ของทุกทีมใน query เดียว
    const scoresResult = await query(
      `
        SELECT *
        FROM scores
        WHERE team_id = ANY($1)
        ORDER BY round ASC
      `,
      [foundTeams.map((t) => t.id)],
    );

    const scoresByTeam = new Map();

    for (const score of scoresResult.rows) {
      const key = String(score.team_id);
      if (!scoresByTeam.has(key)) scoresByTeam.set(key, []);
      scoresByTeam.get(key).push(score);
    }

    // ------------------------------------------------------------
    // Build result
    // ------------------------------------------------------------

    const teams = foundTeams.map((team) => {
      const students = getStudentList(team).map((student) => ({
        name: student.name,
        checked_in: student.checkedIn,
        number: student.number,
      }));

      const rank = rankByTier.get(team.tier)?.get(String(team.id)) ?? null;

      // Rank certificate ONLY
      // Medal ไม่ใส่ใน team_cert_types เพราะหน้าเว็บแสดง Medal แยกเอง
      const teamCertTypes = [];
      if (rank === 1) teamCertTypes.push("1st");
      if (rank === 2) teamCertTypes.push("2nd");
      if (rank === 3) teamCertTypes.push("3rd");

      const maxScore = maxScoreByTier.get(team.tier) || 0;
      const bestScore = getBestScore(scoresByTeam.get(String(team.id)));
      const medal = getMedalType(bestScore, maxScore);

      return {
        id: team.id,
        name: team.name,
        institution: team.institution,
        tier: team.tier,

        rank,

        students,

        team_cert_types: teamCertTypes,

        best_score: bestScore,
        max_score: maxScore,

        medal,
        medalLabel: getMedalLabel(medal),

        checkedIn: hasAnyStudentCheckedIn(team),
      };
    });

    return res.json({ teams });
  } catch (err) {
    console.error("Certificate search error:", err);

    return res.status(500).json({
      teams: [],
      error: "เกิดข้อผิดพลาดในการค้นหา",
    });
  }
});

// ============================================================================
// GET /certificate/download
// ============================================================================
//
// ตรวจสิทธิ์ แล้ว redirect ไป /generate
// ถ้าไม่ผ่าน → กลับไปหน้า Certificate
// ============================================================================

router.get("/download", async (req, res) => {
  const teamId = req.query.team_id || req.query.teamId || "";

  try {
    const result = await validateCertificateRequest(req);

    if (!result.ok) {
      return res.redirect(backToCertificatePage(teamId));
    }

    // ส่งต่อด้วย student_id (ตัวเลข) แทนชื่อ → ไม่มีปัญหา encoding ภาษาไทย
    const params = new URLSearchParams({
      team_id: String(result.team.id),
      type: result.type,
      student_id: String(result.student.number),
    });

    return res.redirect(`/certificate/generate?${params.toString()}`);
  } catch (err) {
    console.error("Certificate download error:", err);

    return res.redirect(backToCertificatePage(teamId));
  }
});

// ============================================================================
// GET /certificate/generate
// ============================================================================

router.get("/generate", async (req, res) => {
  try {
    const result = await validateCertificateRequest(req);

    if (!result.ok) {
      return res.status(result.status).send(result.message);
    }

    const {
      type,
      team,
      template,
      student,
      bestScore,
      maxScore,
      medalLabel,
      rank,
    } = result;

    const svg = createCertificateSvg({
      template,
      name: student.name,
      team,
      type,
      rank,
      medalLabel,
      score: bestScore,
      maxScore,
    });

    // Header รับได้แค่ ASCII → ใช้ filename* สำหรับชื่อภาษาไทย
    const filename = `certificate-${team.id}-${type}-${student.number}.svg`;
    const asciiFallback = filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/"/g, "");

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );

    return res.send(svg);
  } catch (err) {
    console.error("Certificate generate error:", err);

    return res.status(500).send("ไม่สามารถสร้างเกียรติบัตรได้");
  }
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;
