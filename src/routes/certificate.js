const express = require("express");
const router = express.Router();
const { query } = require("../config/database");

// ============================================================================
// MEDAL
// ============================================================================

function getMedalType(score, maxScore) {
  const s = parseFloat(score || 0);
  const m = parseFloat(maxScore || 0);

  if (m <= 0) return null;

  const pct = (s / m) * 100;

  if (pct > 80) return "gold";
  if (pct >= 51) return "silver";
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

// ============================================================================
// SCORE
// ============================================================================

async function getMaxScore(tier) {
  const result = await query(
    `
      SELECT
        COALESCE(
          SUM(
            COALESCE(max_score, 0)
            *
            COALESCE(max_pieces, 1)
          ),
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
//
// ไม่กรอง is_published เพื่อให้ตรงกับหน้า Board ที่ใช้จัดอันดับ
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
          WHEN COALESCE(s1.total_score, 0)
               >= COALESCE(s2.total_score, 0)
          THEN COALESCE(s1.time_seconds, 999999)
          ELSE COALESCE(s2.time_seconds, 999999)
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
        best_time ASC
    `,
    [tier],
  );

  return result.rows.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));
}

async function getTeamRank(teamId, tier) {
  const ranking = await getRanking(tier);

  const index = ranking.findIndex((team) => team.id === teamId);

  if (index === -1) {
    return null;
  }

  return {
    rank: index + 1,
    totalTeams: ranking.length,
    team: ranking[index],
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
// CERTIFICATE NAME
// ============================================================================

function getCertificateName(team, req) {
  const studentName = req.query.studentName || req.query.student_name || null;

  if (studentName && String(studentName).trim()) {
    return String(studentName).trim();
  }

  const studentNumber = parseInt(
    req.query.student_id || req.query.student || "",
    10,
  );

  if (
    Number.isInteger(studentNumber) &&
    studentNumber >= 1 &&
    studentNumber <= 3
  ) {
    const name = team[`student_${studentNumber}`];

    if (name) {
      return String(name).trim();
    }
  }

  return "";
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
// GENERATE SVG
// ============================================================================

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

  const backgroundUrl = template.background_url;

  const x = Number.isFinite(parseFloat(template.name_x))
    ? parseFloat(template.name_x)
    : 50;

  const y = Number.isFinite(parseFloat(template.name_y))
    ? parseFloat(template.name_y)
    : 50;

  const fontSize = Number.isFinite(parseFloat(template.name_font_size))
    ? parseFloat(template.name_font_size)
    : 48;

  const fontColor = template.name_color || "#111827";

  const posX = `${x}%`;
  const posY = `${y}%`;

  let titleText = "";

  if (type === "participation") {
    titleText = "CERTIFICATE OF PARTICIPATION";
  } else if (type === "rank_1") {
    titleText = "FIRST PLACE";
  } else if (type === "rank_2") {
    titleText = "SECOND PLACE";
  } else if (type === "rank_3") {
    titleText = "THIRD PLACE";
  } else if (type === "gold") {
    titleText = "GOLD MEDAL";
  } else if (type === "silver") {
    titleText = "SILVER MEDAL";
  } else if (type === "bronze") {
    titleText = "BRONZE MEDAL";
  }

  const safeBackground = escapeXml(backgroundUrl);

  const safeName = escapeXml(name);

  const safeTitle = escapeXml(titleText);

  const safeTeam = escapeXml(team.name || "");

  const safeInstitution = escapeXml(team.institution || "");

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  const safeScore =
    score > 0 && maxScore > 0
      ? escapeXml(`${score} / ${maxScore} คะแนน (${percentage}%)`)
      : "";

  const safeRank = rank && rank <= 3 ? escapeXml(`อันดับ ${rank}`) : "";

  const safeMedal = escapeXml(medalLabel || "");

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
    x="0"
    y="0"
    width="3508"
    height="2480"
    preserveAspectRatio="xMidYMid slice"
  />

  <text
    x="50%"
    y="20%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="64"
    font-weight="700"
    fill="#111827"
  >
    ${safeTitle}
  </text>

  <text
    x="${posX}"
    y="${posY}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="700"
    fill="${escapeXml(fontColor)}"
  >
    ${safeName}
  </text>

  ${
    safeTeam
      ? `
  <text
    x="50%"
    y="76%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="38"
    fill="#334155"
  >
    ${safeTeam}
  </text>
  `
      : ""
  }

  ${
    safeInstitution
      ? `
  <text
    x="50%"
    y="80%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="32"
    fill="#64748B"
  >
    ${safeInstitution}
  </text>
  `
      : ""
  }

  ${
    safeRank
      ? `
  <text
    x="50%"
    y="86%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="34"
    font-weight="700"
    fill="#111827"
  >
    ${safeRank}
  </text>
  `
      : ""
  }

  ${
    safeMedal
      ? `
  <text
    x="50%"
    y="86%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="34"
    font-weight="700"
    fill="#111827"
  >
    ${safeMedal}
  </text>
  `
      : ""
  }

  ${
    safeScore
      ? `
  <text
    x="50%"
    y="91%"
    text-anchor="middle"
    font-family="Arial, sans-serif"
    font-size="28"
    fill="#64748B"
  >
    ${safeScore}
  </text>
  `
      : ""
  }

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
    const [teamResult, scoresResult, templatesResult] = await Promise.all([
      query("SELECT * FROM teams WHERE id=$1", [team_id]),

      query(
        `
        SELECT *
        FROM scores
        WHERE team_id=$1
        ORDER BY round ASC
        `,
        [team_id],
      ),

      query("SELECT * FROM certificate_templates", []),
    ]);

    if (!teamResult.rows.length) {
      return emptyRender("ไม่พบข้อมูลทีม");
    }

    const team = teamResult.rows[0];

    const scores = scoresResult.rows;

    const templates = templatesResult.rows;

    const maxScore = await getMaxScore(team.tier);

    const bestScore = getBestScore(scores);

    const medal = getMedalType(bestScore, maxScore);

    const medalLabel = getMedalLabel(medal);

    const medalPct =
      maxScore > 0 ? Math.round((bestScore / maxScore) * 100) : 0;

    const checkedIn = hasAnyStudentCheckedIn(team);

    const rankData = await getTeamRank(team.id, team.tier);

    const tpl = (certType) => findTemplate(templates, team.tier, certType);

    return res.render("certificate/index", {
      layout: false,

      team,
      scores,
      checkedIn,

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
    return res.json({
      teams: [],
    });
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
            OR LOWER(REPLACE(id, '_', ' '))
              LIKE LOWER($2)
            OR LOWER(name) LIKE LOWER($3)
            OR LOWER(institution) LIKE LOWER($3)
          )
        ORDER BY created_at ASC
        LIMIT 50
        `,
      [`%${searchText}%`, `%${q}%`, `%${q}%`],
    );

    const teams = [];

    for (const team of result.rows) {
      // ------------------------------------------------------------
      // Students
      // ------------------------------------------------------------

      const students = getStudentList(team).map((student) => ({
        name: student.name,
        checked_in: student.checkedIn,
        number: student.number,
      }));

      // ------------------------------------------------------------
      // Ranking
      // ------------------------------------------------------------

      let rank = null;

      try {
        const rankData = await getTeamRank(team.id, team.tier);

        if (rankData) {
          rank = rankData.rank;
        }
      } catch (rankError) {
        console.error("Certificate search rank error:", rankError);
      }

      // ------------------------------------------------------------
      // Rank certificate ONLY
      // ------------------------------------------------------------

      const teamCertTypes = [];

      if (rank === 1) {
        teamCertTypes.push("1st");
      }

      if (rank === 2) {
        teamCertTypes.push("2nd");
      }

      if (rank === 3) {
        teamCertTypes.push("3rd");
      }

      // ------------------------------------------------------------
      // Scores / Medal
      //
      // Medal ไม่ใส่ใน team_cert_types
      // เพราะหน้าเว็บแสดง Medal แยกเอง
      // ------------------------------------------------------------

      const scoresResult = await query(
        `
            SELECT *
            FROM scores
            WHERE team_id=$1
            ORDER BY round ASC
            `,
        [team.id],
      );

      const scores = scoresResult.rows;

      const maxScore = await getMaxScore(team.tier);

      const bestScore = getBestScore(scores);

      const medal = getMedalType(bestScore, maxScore);

      // ------------------------------------------------------------
      // Result
      // ------------------------------------------------------------

      teams.push({
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
      });
    }

    return res.json({
      teams,
    });
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

router.get("/download", async (req, res) => {
  const team_id = req.query.team_id || req.query.teamId;

  let type = req.query.type || req.query.certType;

  // หน้า EJS เดิมใช้ 1st / 2nd / 3rd
  // ระบบภายในใช้ rank_1 / rank_2 / rank_3
  type = normalizeCertificateType(type);

  const allowedTypes = [
    "gold",
    "silver",
    "bronze",
    "participation",
    "rank_1",
    "rank_2",
    "rank_3",
  ];

  if (!team_id || !allowedTypes.includes(type)) {
    return res.redirect(
      "/certificate?team_id=" + encodeURIComponent(team_id || ""),
    );
  }

  try {
    const [teamResult, templateResult, scoresResult] = await Promise.all([
      query("SELECT * FROM teams WHERE id=$1", [team_id]),

      query(
        `
          SELECT *
          FROM certificate_templates
          WHERE tier = (
            SELECT tier
            FROM teams
            WHERE id=$1
          )
          AND cert_type=$2
          `,
        [team_id, type],
      ),

      query(
        `
          SELECT *
          FROM scores
          WHERE team_id=$1
          ORDER BY round ASC
          `,
        [team_id],
      ),
    ]);

    if (!teamResult.rows.length || !templateResult.rows.length) {
      return res.redirect(
        "/certificate?team_id=" + encodeURIComponent(team_id),
      );
    }

    const team = teamResult.rows[0];

    const students = getStudentList(team);

    const scores = scoresResult.rows;

    // ------------------------------------------------------------
    // Check-in
    // ------------------------------------------------------------

    if (!hasAnyStudentCheckedIn(team)) {
      return res.redirect(
        "/certificate?team_id=" + encodeURIComponent(team_id),
      );
    }

    // ------------------------------------------------------------
    // Participation
    // ------------------------------------------------------------

    if (type === "participation") {
      const studentName = getCertificateName(team, req);

      if (!studentName) {
        return res.redirect(
          "/certificate?team_id=" + encodeURIComponent(team_id),
        );
      }

      const student = students.find((item) => item.name === studentName);

      if (!student || !student.checkedIn) {
        return res.redirect(
          "/certificate?team_id=" + encodeURIComponent(team_id),
        );
      }
    }

    // ------------------------------------------------------------
    // Score
    // ------------------------------------------------------------

    const maxScore = await getMaxScore(team.tier);

    const bestScore = getBestScore(scores);

    // ------------------------------------------------------------
    // Medal
    // ------------------------------------------------------------

    if (isMedalCertificate(type)) {
      const actualMedal = getMedalType(bestScore, maxScore);

      if (actualMedal !== type) {
        return res.redirect(
          "/certificate?team_id=" + encodeURIComponent(team_id),
        );
      }
    }

    // ------------------------------------------------------------
    // Rank
    // ------------------------------------------------------------

    if (isRankCertificate(type)) {
      const rankData = await getTeamRank(team.id, team.tier);

      if (!rankData) {
        return res.redirect(
          "/certificate?team_id=" + encodeURIComponent(team_id),
        );
      }

      const requiredRank = rankFromType(type);

      if (rankData.rank !== requiredRank) {
        return res.redirect(
          "/certificate?team_id=" + encodeURIComponent(team_id),
        );
      }
    }

    // ------------------------------------------------------------
    // Generate
    // ------------------------------------------------------------

    const params = new URLSearchParams();

    params.set("team_id", team_id);

    params.set("type", type);

    if (req.query.studentName || req.query.student_name) {
      params.set(
        "studentName",
        req.query.studentName || req.query.student_name,
      );
    }

    return res.redirect(`/certificate/generate?${params.toString()}`);
  } catch (err) {
    console.error("Certificate download error:", err);

    return res.redirect("/certificate?team_id=" + encodeURIComponent(team_id));
  }
});

// ============================================================================
// GET /certificate/generate
// ============================================================================

router.get("/generate", async (req, res) => {
  const team_id = req.query.team_id || req.query.teamId;

  let type = req.query.type || req.query.certType;

  type = normalizeCertificateType(type);

  const allowedTypes = [
    "gold",
    "silver",
    "bronze",
    "participation",
    "rank_1",
    "rank_2",
    "rank_3",
  ];

  if (!team_id || !allowedTypes.includes(type)) {
    return res.status(400).send("ข้อมูลเกียรติบัตรไม่ถูกต้อง");
  }

  try {
    const [teamResult, templateResult, scoresResult] = await Promise.all([
      query("SELECT * FROM teams WHERE id=$1", [team_id]),

      query(
        `
          SELECT *
          FROM certificate_templates
          WHERE tier = (
            SELECT tier
            FROM teams
            WHERE id=$1
          )
          AND cert_type=$2
          `,
        [team_id, type],
      ),

      query(
        `
          SELECT *
          FROM scores
          WHERE team_id=$1
          ORDER BY round ASC
          `,
        [team_id],
      ),
    ]);

    if (!teamResult.rows.length) {
      return res.status(404).send("ไม่พบข้อมูลทีม");
    }

    if (!templateResult.rows.length) {
      return res
        .status(404)
        .send("ยังไม่มี Template สำหรับเกียรติบัตรประเภทนี้");
    }

    const team = teamResult.rows[0];

    const template = templateResult.rows[0];

    const scores = scoresResult.rows;

    // ------------------------------------------------------------
    // Check-in
    // ------------------------------------------------------------

    if (!hasAnyStudentCheckedIn(team)) {
      return res.status(403).send("ทีมนี้ยังไม่มีผู้เข้าแข่งขัน Check-in");
    }

    // ------------------------------------------------------------
    // Participation
    // ------------------------------------------------------------

    const certificateName = getCertificateName(team, req);

    if (!certificateName) {
      return res.status(400).send("ไม่พบชื่อสำหรับเกียรติบัตร");
    }

    if (type === "participation") {
      const students = getStudentList(team);

      const student = students.find((item) => item.name === certificateName);

      if (!student || !student.checkedIn) {
        return res.status(403).send("ผู้เข้าแข่งขันยังไม่ได้ Check-in");
      }
    }

    // ------------------------------------------------------------
    // Score
    // ------------------------------------------------------------

    const maxScore = await getMaxScore(team.tier);

    const bestScore = getBestScore(scores);

    // ------------------------------------------------------------
    // Medal
    // ------------------------------------------------------------

    let medal = null;
    let medalLabel = null;

    if (isMedalCertificate(type)) {
      medal = getMedalType(bestScore, maxScore);

      medalLabel = getMedalLabel(medal);

      if (medal !== type) {
        return res
          .status(403)
          .send("ทีมนี้ไม่มีสิทธิ์สำหรับเกียรติบัตรประเภทนี้");
      }
    }

    // ------------------------------------------------------------
    // Rank
    // ------------------------------------------------------------

    let rank = null;

    if (isRankCertificate(type)) {
      const rankData = await getTeamRank(team.id, team.tier);

      if (!rankData) {
        return res.status(403).send("ไม่พบอันดับของทีม");
      }

      rank = rankData.rank;

      const requiredRank = rankFromType(type);

      if (rank !== requiredRank) {
        return res
          .status(403)
          .send("ทีมนี้ไม่มีสิทธิ์สำหรับเกียรติบัตรอันดับนี้");
      }
    }

    // ------------------------------------------------------------
    // Create SVG
    // ------------------------------------------------------------

    const svg = createCertificateSvg({
      template,

      name: certificateName,

      team,

      type,

      rank,

      medalLabel,

      score: bestScore,

      maxScore,
    });

    const filename = `certificate-${team.id}-${type}.svg`;

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

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
