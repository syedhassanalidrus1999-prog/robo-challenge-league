// src/routes/survey.js
// แบบประเมินความพึงพอใจ + รหัสชิงโชค
//
// app.js:
//   const survey = require("./routes/survey");
//   app.use("/survey", survey.publicRouter);        // หน้าสาธารณะ
//   app.use("/board/survey", survey.adminRouter);   // หลังบ้าน (วางก่อน app.use("/board", ...))

const express = require("express");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");

const publicRouter = express.Router();
const adminRouter = express.Router();

// ============================================================================
// CONSTANTS
// ============================================================================

const QUESTIONS = [
  { key: "q1", label: "การประชาสัมพันธ์และข้อมูลก่อนวันงาน" },
  { key: "q2", label: "ขั้นตอนการลงทะเบียน / รับสมัคร" },
  { key: "q3", label: "ความชัดเจนของกติกาและเกณฑ์การแข่งขัน" },
  { key: "q4", label: "ความพร้อมของอุปกรณ์และสนามแข่งขัน" },
  { key: "q5", label: "บรรยากาศและความปลอดภัยในงาน" },
  { key: "q6", label: "ประโยชน์ที่ได้รับจากการเข้าร่วมกิจกรรม" },
  { key: "q7", label: "ภาพรวมความพึงพอใจต่อการจัดการแข่งขันครั้งนี้" },
];

const TYPES = {
  participant: "ผู้เข้าแข่งขัน (นักเรียน)",
  coach: "ผู้คุมทีม / โค้ช",
  audience: "ผู้ชมทั่วไป / ผู้ปกครอง",
  staff: "คณะกรรมการ / สตาฟ",
};

const TYPE_KEYS = Object.keys(TYPES);

// ตัดตัวที่สับสนกันออก (0/O, 1/I/L)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

// เกณฑ์แปลผลค่าเฉลี่ย 5 ระดับ
function levelLabel(avg) {
  const n = Number(avg);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n > 4.5) return "มากที่สุด";
  if (n > 3.5) return "มาก";
  if (n > 2.5) return "ปานกลาง";
  if (n > 1.5) return "น้อย";
  return "น้อยที่สุด";
}

function fmtAvg(n) {
  return n === null || n === undefined || isNaN(n) ? "—" : Number(n).toFixed(2);
}

// ============================================================================
// TABLE (สร้างอัตโนมัติครั้งแรกที่โหลดไฟล์ — ไม่ต้องรัน SQL เอง)
// ============================================================================

async function ensureTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS survey_responses (
      id SERIAL PRIMARY KEY,
      respondent_type VARCHAR(20) NOT NULL,
      team_id VARCHAR(20),
      student_number SMALLINT,
      respondent_name VARCHAR(200) NOT NULL,
      phone VARCHAR(20),
      q1 SMALLINT NOT NULL CHECK (q1 BETWEEN 1 AND 5),
      q2 SMALLINT NOT NULL CHECK (q2 BETWEEN 1 AND 5),
      q3 SMALLINT NOT NULL CHECK (q3 BETWEEN 1 AND 5),
      q4 SMALLINT NOT NULL CHECK (q4 BETWEEN 1 AND 5),
      q5 SMALLINT NOT NULL CHECK (q5 BETWEEN 1 AND 5),
      q6 SMALLINT NOT NULL CHECK (q6 BETWEEN 1 AND 5),
      q7 SMALLINT NOT NULL CHECK (q7 BETWEEN 1 AND 5),
      suggestion TEXT,
      interest_course BOOLEAN,
      consent_contact BOOLEAN NOT NULL DEFAULT FALSE,
      lucky_code VARCHAR(12) NOT NULL,
      is_winner BOOLEAN NOT NULL DEFAULT FALSE,
      prize VARCHAR(200),
      won_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
  );

  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS survey_lucky_code_uq ON survey_responses (lucky_code)",
    [],
  );

  // นักเรียน 1 คน = 1 สิทธิ์
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS survey_student_uq
       ON survey_responses (team_id, student_number)
       WHERE respondent_type = 'participant'`,
    [],
  );

  // โค้ช / ผู้ชม / สตาฟ: 1 เบอร์ = 1 สิทธิ์
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS survey_phone_uq
       ON survey_responses (phone)
       WHERE phone IS NOT NULL`,
    [],
  );

  console.log("[survey] ตาราง survey_responses พร้อมใช้งาน");
}

const tableReady = ensureTable().catch((err) => {
  console.error("[survey] สร้างตารางไม่สำเร็จ:", err.message);
});

// ============================================================================
// HELPERS
// ============================================================================

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanText(value, max) {
  return String(first(value) ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function normalizePhone(value) {
  return String(first(value) ?? "").replace(/\D/g, "");
}

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return "RCL-" + code;
}

// ปิดชื่อบางส่วนตอนแสดงบนจอโปรเจกเตอร์
function maskName(name) {
  // ตัดคำนำหน้า เพื่อให้เห็นส่วนต้นของชื่อจริง
  const plain = String(name || "")
    .trim()
    .replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นางสาว|นาง|นาย|น\.ส\.)\s*/, "");
  const chars = Array.from(plain);
  if (chars.length <= 4) return chars.join("") + "***";
  return chars.slice(0, Math.ceil(chars.length / 2)).join("") + "***";
}

// 0812345678 → 08x-xxx-5678
function maskPhone(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return "";
  return d.slice(0, 2) + "x-xxx-" + d.slice(-4);
}

// ชื่อที่แสดงบนจอ: มีชื่อ → ปิดบางส่วน / ไม่มีชื่อ → เลขท้ายเบอร์
function displayName(name, phone) {
  if (String(name || "").trim()) return maskName(name);
  return maskPhone(phone) || "ไม่ระบุชื่อ";
}

async function getSettings() {
  const result = await query("SELECT key, value FROM settings", []);
  const settings = {};
  result.rows.forEach(function (r) {
    settings[r.key] = r.value;
  });
  return settings;
}

async function isSurveyOpen() {
  const result = await query(
    "SELECT value FROM settings WHERE key = 'survey_open' LIMIT 1",
    [],
  );
  // ยังไม่เคยตั้งค่า = เปิด
  if (!result.rows.length) return true;
  return result.rows[0].value !== "0";
}

function formatThaiDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "short",
  });
}

// ============================================================================
// VALIDATE
// ============================================================================

async function validateSubmission(body) {
  const errors = [];
  const type = cleanText(body.respondent_type, 20);

  const data = {
    respondent_type: type,
    team_id: null,
    student_number: null,
    respondent_name: "",
    phone: null,
    suggestion: cleanText(body.suggestion, 2000) || null,
    interest_course: null,
    consent_contact: false,
  };

  if (!TYPE_KEYS.includes(type)) {
    errors.push("กรุณาเลือกประเภทผู้ตอบ");
  }

  // ---------------- ตัวตนผู้ตอบ ----------------

  if (type === "participant") {
    const teamId = cleanText(body.team_id, 20);
    const studentNumber = parseInt(first(body.student_number), 10);

    if (!teamId || ![1, 2, 3].includes(studentNumber)) {
      errors.push("กรุณาค้นหาและเลือกชื่อของคุณจากรายชื่อทีม");
    } else {
      const teamResult = await query(
        "SELECT id, name, student_1, student_2, student_3 FROM teams WHERE id = $1 LIMIT 1",
        [teamId],
      );
      const team = teamResult.rows[0];
      const studentName = team
        ? String(team["student_" + studentNumber] || "").trim()
        : "";

      if (!studentName) {
        errors.push("ไม่พบชื่อนักเรียนที่เลือก กรุณาค้นหาใหม่อีกครั้ง");
      } else {
        // ใช้ชื่อจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ
        data.team_id = team.id;
        data.student_number = studentNumber;
        data.respondent_name = studentName;
      }
    }
  } else if (TYPE_KEYS.includes(type)) {
    const name = cleanText(body.respondent_name, 200);
    const phone = normalizePhone(body.phone);

    if (!/^0\d{8,9}$/.test(phone)) {
      errors.push(
        "กรุณากรอกเบอร์โทรให้ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)",
      );
    }

    data.respondent_name = name;
    data.phone = phone || null;
  }

  // ---------------- คะแนน ----------------

  const missing = [];
  QUESTIONS.forEach(function (q, i) {
    const v = parseInt(first(body[q.key]), 10);
    if (v >= 1 && v <= 5) {
      data[q.key] = v;
    } else {
      missing.push(i + 1);
    }
  });

  if (missing.length) {
    errors.push(
      "กรุณาให้คะแนนให้ครบทุกข้อ (ยังไม่ได้ตอบข้อ " + missing.join(", ") + ")",
    );
  }

  // ---------------- ผู้ชม: ความสนใจคอร์ส ----------------

  if (type === "audience") {
    const interest = first(body.interest_course);
    if (interest === "yes") data.interest_course = true;
    else if (interest === "no") data.interest_course = false;

    data.consent_contact = first(body.consent_contact) === "1";
  }

  // ---------------- ยินยอม PDPA ----------------

  if (first(body.consent_data) !== "1") {
    errors.push("กรุณายินยอมให้เก็บข้อมูลก่อนส่งแบบประเมิน");
  }

  return { errors, data };
}

// ============================================================================
// PUBLIC: GET /survey
// ============================================================================

function renderForm(res, extra) {
  return getSettings()
    .catch(function () {
      return {};
    })
    .then(function (settings) {
      return res.render(
        "survey/form",
        Object.assign(
          {
            layout: false,
            questions: QUESTIONS,
            types: TYPES,
            values: {},
            errors: [],
            isOpen: true,
            eventLabel: settings.event_date_label || "",
          },
          extra,
        ),
      );
    });
}

publicRouter.get("/", async (req, res) => {
  try {
    await tableReady;
    const open = await isSurveyOpen();
    return renderForm(res, { isOpen: open });
  } catch (err) {
    console.error("Survey page error:", err);
    return res.status(500).send("ไม่สามารถโหลดแบบประเมินได้");
  }
});

// ============================================================================
// PUBLIC: GET /survey/students?q=  (ค้นหาชื่อนักเรียนจากทีม)
// ============================================================================

publicRouter.get("/students", async (req, res) => {
  const q = cleanText(req.query.q, 60);

  if (q.length < 2) return res.json({ teams: [] });

  try {
    await tableReady;

    const like = "%" + q + "%";
    const result = await query(
      `SELECT id, name, institution, student_1, student_2, student_3
       FROM teams
       WHERE id ILIKE $1
          OR name ILIKE $1
          OR institution ILIKE $1
          OR student_1 ILIKE $1
          OR student_2 ILIKE $1
          OR student_3 ILIKE $1
       ORDER BY created_at ASC
       LIMIT 15`,
      [like],
    );

    const teamIds = result.rows.map((t) => t.id);
    const answered = new Set();

    if (teamIds.length) {
      const done = await query(
        `SELECT team_id, student_number FROM survey_responses
         WHERE respondent_type = 'participant' AND team_id = ANY($1)`,
        [teamIds],
      );
      done.rows.forEach(function (r) {
        answered.add(r.team_id + ":" + r.student_number);
      });
    }

    const teams = result.rows.map(function (t) {
      const students = [];
      for (let i = 1; i <= 3; i++) {
        const name = String(t["student_" + i] || "").trim();
        if (name) {
          students.push({
            number: i,
            name,
            answered: answered.has(t.id + ":" + i),
          });
        }
      }
      return { id: t.id, name: t.name, institution: t.institution, students };
    });

    return res.json({ teams: teams.filter((t) => t.students.length) });
  } catch (err) {
    console.error("Survey student search error:", err);
    return res.status(500).json({ teams: [], error: "ค้นหาไม่สำเร็จ" });
  }
});

// ============================================================================
// PUBLIC: POST /survey
// ============================================================================

publicRouter.post("/", async (req, res) => {
  try {
    await tableReady;

    if (!(await isSurveyOpen())) {
      return renderForm(res, { isOpen: false });
    }

    const { errors, data } = await validateSubmission(req.body);

    if (errors.length) {
      return renderForm(res, { errors, values: req.body || {} });
    }

    // สุ่มรหัสใหม่ถ้าบังเอิญชนกับรหัสที่มีอยู่ (โอกาสต่ำมาก)
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateCode();

      try {
        await query(
          `INSERT INTO survey_responses (
            respondent_type, team_id, student_number, respondent_name, phone,
            q1, q2, q3, q4, q5, q6, q7,
            suggestion, interest_course, consent_contact, lucky_code
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            data.respondent_type,
            data.team_id,
            data.student_number,
            data.respondent_name,
            data.phone,
            data.q1,
            data.q2,
            data.q3,
            data.q4,
            data.q5,
            data.q6,
            data.q7,
            data.suggestion,
            data.interest_course,
            data.consent_contact,
            code,
          ],
        );

        req.session.surveyResult = {
          code,
          name:
            data.respondent_name ||
            (data.phone ? "เบอร์ลงท้าย " + data.phone.slice(-4) : ""),
          type: TYPES[data.respondent_type],
        };

        return res.redirect("/survey/done");
      } catch (err) {
        if (err.code !== "23505") throw err;

        if (err.constraint === "survey_lucky_code_uq") continue;

        const msg =
          err.constraint === "survey_student_uq"
            ? "นักเรียนคนนี้ตอบแบบประเมินไปแล้ว (1 คน ได้ 1 สิทธิ์) หากรหัสหาย ติดต่อเจ้าหน้าที่ที่จุดลงทะเบียน"
            : "เบอร์โทรนี้ใช้ตอบแบบประเมินไปแล้ว (1 เบอร์ ได้ 1 สิทธิ์) หากรหัสหาย ติดต่อเจ้าหน้าที่ที่จุดลงทะเบียน";

        return renderForm(res, { errors: [msg], values: req.body || {} });
      }
    }

    throw new Error("SURVEY_CODE_GENERATION_FAILED");
  } catch (err) {
    console.error("Survey submit error:", err);
    return renderForm(res, {
      errors: ["บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"],
      values: req.body || {},
    });
  }
});

// ============================================================================
// PUBLIC: GET /survey/done
// ============================================================================

publicRouter.get("/done", (req, res) => {
  const result = req.session.surveyResult;
  if (!result) return res.redirect("/survey");

  return res.render("survey/done", {
    layout: false,
    result,
  });
});

// ============================================================================
// ADMIN
// ============================================================================

// ไม่ใช้ requireAdmin จาก middleware/auth เพราะตัวนั้น redirect ไป /dashboard (404)
function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  if (wantsJson(req))
    return res.status(403).json({ error: "เฉพาะผู้ดูแลระบบ" });
  req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

function wantsJson(req) {
  return req.xhr || (req.headers.accept || "").includes("application/json");
}

adminRouter.use(requireLogin, requireAdminOnly);

// ---------------- GET /board/survey ----------------

adminRouter.get("/", async (req, res) => {
  try {
    await tableReady;

    const avgCols = QUESTIONS.map(
      (q) => `ROUND(AVG(${q.key})::numeric, 2) AS ${q.key}`,
    ).join(", ");

    const [statsResult, interestResult, leadsResult, suggestionsResult, open] =
      await Promise.all([
        query(
          `SELECT respondent_type, GROUPING(respondent_type) AS is_total,
                  COUNT(*)::int AS cnt, ${avgCols}
           FROM survey_responses
           GROUP BY ROLLUP(respondent_type)`,
          [],
        ),
        query(
          `SELECT
             COUNT(*) FILTER (WHERE interest_course)::int AS interested,
             COUNT(*) FILTER (WHERE interest_course AND consent_contact)::int AS contactable,
             COUNT(*) FILTER (WHERE is_winner)::int AS winners
           FROM survey_responses`,
          [],
        ),
        query(
          `SELECT respondent_name, phone, created_at
           FROM survey_responses
           WHERE interest_course AND consent_contact
           ORDER BY created_at DESC
           LIMIT 200`,
          [],
        ),
        query(
          `SELECT respondent_type, suggestion, created_at
           FROM survey_responses
           WHERE COALESCE(TRIM(suggestion), '') <> ''
           ORDER BY created_at DESC
           LIMIT 100`,
          [],
        ),
        isSurveyOpen(),
      ]);

    const byType = {};
    let total = { cnt: 0 };

    statsResult.rows.forEach(function (r) {
      const row = { cnt: r.cnt };
      QUESTIONS.forEach((q) => {
        row[q.key] = r[q.key] === null ? null : Number(r[q.key]);
      });
      if (Number(r.is_total) === 1) total = row;
      else byType[r.respondent_type] = row;
    });

    // ค่าเฉลี่ยรวมทุกข้อ
    const overallValues = QUESTIONS.map((q) => total[q.key]).filter(
      (v) => v !== null && v !== undefined,
    );
    const overallAvg = overallValues.length
      ? overallValues.reduce((a, b) => a + b, 0) / overallValues.length
      : null;

    return res.render("survey/admin", {
      title: "แบบประเมิน",
      pageTitle: "<span>แบบประเมิน</span>ความพึงพอใจ",
      tierSelector: false,
      activeTier: "",
      questions: QUESTIONS,
      types: TYPES,
      byType,
      total,
      overallAvg,
      levelLabel,
      fmt: fmtAvg,
      interest: interestResult.rows[0],
      leads: leadsResult.rows,
      suggestions: suggestionsResult.rows,
      isOpen: open,
      formatThaiDateTime,
    });
  } catch (err) {
    console.error("Survey admin error:", err);
    req.flash("error", "โหลดข้อมูลแบบประเมินไม่ได้");
    return res.redirect("/board");
  }
});

// ---------------- POST /board/survey/toggle ----------------

adminRouter.post("/toggle", async (req, res) => {
  try {
    const open = await isSurveyOpen();
    await query(
      "INSERT INTO settings (key, value) VALUES ('survey_open', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [open ? "0" : "1"],
    );
    req.flash(
      "success",
      open ? "ปิดรับแบบประเมินแล้ว" : "เปิดรับแบบประเมินแล้ว",
    );
  } catch (err) {
    console.error("Survey toggle error:", err);
    req.flash("error", "เปลี่ยนสถานะไม่สำเร็จ");
  }
  return res.redirect("/board/survey");
});

// ---------------- GET /board/survey/export ----------------

adminRouter.get("/export", async (req, res) => {
  try {
    await tableReady;

    const result = await query(
      "SELECT * FROM survey_responses ORDER BY created_at ASC",
      [],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "Robo Challenge League";
    const ws = wb.addWorksheet("แบบประเมิน");

    ws.columns = [
      { header: "เวลา", key: "created_at", width: 18 },
      { header: "รหัสชิงโชค", key: "lucky_code", width: 12 },
      { header: "ประเภท", key: "type", width: 22 },
      { header: "ชื่อ", key: "name", width: 28 },
      { header: "ทีม", key: "team_id", width: 10 },
      { header: "นักเรียนคนที่", key: "student_number", width: 12 },
      { header: "เบอร์โทร", key: "phone", width: 14 },
    ]
      .concat(
        QUESTIONS.map((q, i) => ({
          header: "ข้อ " + (i + 1) + " " + q.label,
          key: q.key,
          width: 14,
        })),
      )
      .concat([
        { header: "ค่าเฉลี่ย", key: "avg", width: 10 },
        { header: "ข้อเสนอแนะ", key: "suggestion", width: 40 },
        { header: "สนใจคอร์ส", key: "interest", width: 11 },
        { header: "ยินยอมให้ติดต่อ", key: "consent", width: 14 },
        { header: "ได้รางวัล", key: "prize", width: 22 },
      ]);

    result.rows.forEach(function (r) {
      const scores = QUESTIONS.map((q) => Number(r[q.key]) || 0);
      const row = {
        created_at: formatThaiDateTime(r.created_at),
        lucky_code: r.lucky_code,
        type: TYPES[r.respondent_type] || r.respondent_type,
        name: r.respondent_name,
        team_id: r.team_id || "",
        student_number: r.student_number || "",
        phone: r.phone || "",
        avg:
          Math.round(
            (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
          ) / 100,
        suggestion: r.suggestion || "",
        interest:
          r.interest_course === true
            ? "สนใจ"
            : r.interest_course === false
              ? "ไม่สนใจ"
              : "",
        consent: r.consent_contact ? "ยินยอม" : "",
        prize: r.is_winner ? r.prize || "ได้รางวัล" : "",
      };
      QUESTIONS.forEach((q) => {
        row[q.key] = Number(r[q.key]);
      });
      ws.addRow(row);
    });

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    };
    header.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    header.height = 42;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };

    const date = new Date().toISOString().slice(0, 10);
    const thaiName = `RCL_แบบประเมิน_${date}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="RCL_survey_${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(thaiName)}`,
    );

    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("Survey export error:", err);
    if (!res.headersSent) return res.status(500).send("ส่งออกไม่สำเร็จ");
  }
});

// ---------------- GET /board/survey/draw ----------------

adminRouter.get("/draw", async (req, res) => {
  try {
    await tableReady;

    const [countResult, winnersResult] = await Promise.all([
      query(
        `SELECT respondent_type, COUNT(*)::int AS cnt
         FROM survey_responses WHERE is_winner = FALSE
         GROUP BY respondent_type`,
        [],
      ),
      query(
        `SELECT id, lucky_code, respondent_type, respondent_name, phone, prize, won_at
         FROM survey_responses WHERE is_winner = TRUE
         ORDER BY won_at DESC`,
        [],
      ),
    ]);

    const remaining = {};
    countResult.rows.forEach((r) => {
      remaining[r.respondent_type] = r.cnt;
    });

    return res.render("survey/draw", {
      layout: false,
      types: TYPES,
      remaining,
      winners: winnersResult.rows.map((w) => ({
        id: w.id,
        code: w.lucky_code,
        type: TYPES[w.respondent_type] || w.respondent_type,
        name: w.respondent_name || "—",
        phoneTail: maskPhone(w.phone),
        prize: w.prize || "",
        wonAt: formatThaiDateTime(w.won_at),
      })),
    });
  } catch (err) {
    console.error("Survey draw page error:", err);
    req.flash("error", "โหลดหน้าสุ่มรางวัลไม่ได้");
    return res.redirect("/board/survey");
  }
});

// ---------------- POST /board/survey/draw (JSON) ----------------

function poolCondition(pool) {
  if (pool === "all") return { sql: "", params: [] };
  if (TYPE_KEYS.includes(pool)) {
    return { sql: " AND respondent_type = $1", params: [pool] };
  }
  // ค่าเริ่มต้น: ทุกกลุ่ม ยกเว้นสตาฟ
  return { sql: " AND respondent_type <> 'staff'", params: [] };
}

adminRouter.post("/draw", async (req, res) => {
  try {
    await tableReady;

    const pool = cleanText(req.body.pool, 20) || "all_no_staff";
    const prize = cleanText(req.body.prize, 200) || null;
    const cond = poolCondition(pool);

    for (let attempt = 0; attempt < 3; attempt++) {
      const eligible = await query(
        "SELECT id, lucky_code FROM survey_responses WHERE is_winner = FALSE" +
          cond.sql +
          " ORDER BY id",
        cond.params,
      );

      if (!eligible.rows.length) {
        return res.json({
          ok: false,
          error: "ไม่มีรายชื่อเหลือให้สุ่มในกลุ่มนี้",
        });
      }

      const pick = eligible.rows[crypto.randomInt(eligible.rows.length)];

      // ตัวอย่างรหัสสำหรับแอนิเมชันหมุน
      const sample = [];
      for (let i = 0; i < Math.min(40, eligible.rows.length); i++) {
        sample.push(
          eligible.rows[crypto.randomInt(eligible.rows.length)].lucky_code,
        );
      }

      const updated = await query(
        `UPDATE survey_responses
         SET is_winner = TRUE, prize = $2, won_at = NOW()
         WHERE id = $1 AND is_winner = FALSE
         RETURNING id, lucky_code, respondent_type, respondent_name, phone, prize, won_at`,
        [pick.id, prize],
      );

      // มีคนสุ่มตัวเดียวกันพร้อมกัน → สุ่มใหม่
      if (!updated.rows.length) continue;

      const w = updated.rows[0];

      return res.json({
        ok: true,
        sample,
        remaining: eligible.rows.length - 1,
        winner: {
          id: w.id,
          code: w.lucky_code,
          type: TYPES[w.respondent_type] || w.respondent_type,
          maskedName: displayName(w.respondent_name, w.phone),
          name: w.respondent_name || "—",
          phoneTail: maskPhone(w.phone),
          prize: w.prize || "",
          wonAt: formatThaiDateTime(w.won_at),
        },
      });
    }

    return res.json({ ok: false, error: "สุ่มไม่สำเร็จ กรุณากดอีกครั้ง" });
  } catch (err) {
    console.error("Survey draw error:", err);
    return res.status(500).json({ ok: false, error: "สุ่มไม่สำเร็จ" });
  }
});

// ---------------- POST /board/survey/winners/:id/cancel ----------------
// ยกเลิกสิทธิ์ (เช่น ผู้โชคดีไม่อยู่ในงาน) → กลับไปอยู่ในกลุ่มที่สุ่มได้

adminRouter.post("/winners/:id/cancel", async (req, res) => {
  try {
    await query(
      `UPDATE survey_responses SET is_winner = FALSE, prize = NULL, won_at = NULL
       WHERE id = $1`,
      [parseInt(req.params.id, 10) || 0],
    );
    req.flash("success", "ยกเลิกรางวัลแล้ว");
  } catch (err) {
    console.error("Survey cancel winner error:", err);
    req.flash("error", "ยกเลิกไม่สำเร็จ");
  }
  return res.redirect("/board/survey/draw");
});

module.exports = { publicRouter, adminRouter, QUESTIONS, TYPES };
