const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const ExcelJS = require("exceljs");

const certStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "robo-league/certificates",
    allowed_formats: ["jpg", "jpeg", "png"],
  },
});
const certUpload = multer({
  storage: certStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ============================================================================
// CONSTANTS / HELPERS
// ============================================================================

const TIERS = ["beginner", "intermediate", "advance"];

const CERT_TYPES = [
  "participation",
  "coach",
  "rank_1",
  "rank_2",
  "rank_3",
  "gold",
  "silver",
  "bronze",
];

const FONT_SIZE_MIN = 20;
const FONT_SIZE_MAX = 400;

function safeTier(value) {
  return TIERS.includes(value) ? value : "beginner";
}

// หน้าจัดการระบบ (เกณฑ์ / ตั้งค่า / pre-order / เกียรติบัตร / เผยแพร่คะแนน)
// ให้เฉพาะ admin — กรรมการเข้าได้แค่หน้าสรุปผล
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") {
    return next();
  }
  req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

// ============================================================================
// RANKING / MAX SCORE (ใช้ร่วมกับไฟล์อื่นผ่าน module.exports)
// ============================================================================
//
// 1. คะแนนสูงสุดมาก่อน
// 2. คะแนนเท่ากัน → เวลาน้อยกว่ามาก่อน (ถ้า R1 = R2 ใช้เวลาที่ดีที่สุด)
// 3. ยังเท่ากัน → team id (ผลคงที่ทุกครั้ง)
// ตรงกับ getRanking ใน certificate.js
// ============================================================================

async function getRanked(tier) {
  const result = await query(
    `SELECT
      t.id, t.name, t.institution, t.status, t.tier,
      s1.total_score AS r1_score, s1.time_seconds AS r1_time, s1.is_published AS r1_published,
      s2.total_score AS r2_score, s2.time_seconds AS r2_time, s2.is_published AS r2_published,
      GREATEST(COALESCE(s1.total_score, 0), COALESCE(s2.total_score, 0)) AS best_score,
      CASE
        WHEN COALESCE(s1.total_score, -1) > COALESCE(s2.total_score, -1) THEN s1.time_seconds
        WHEN COALESCE(s2.total_score, -1) > COALESCE(s1.total_score, -1) THEN s2.time_seconds
        ELSE LEAST(s1.time_seconds, s2.time_seconds)
      END AS best_time
    FROM teams t
    LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
    LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
    WHERE t.tier = $1
    ORDER BY best_score DESC, best_time ASC NULLS LAST, t.id ASC`,
    [tier],
  );
  return result.rows;
}

// คะแนนเต็ม = max_score × max_pieces ของทุกเกณฑ์
async function getMaxScore(tier) {
  const result = await query(
    `SELECT COALESCE(SUM(COALESCE(max_score, 0) * COALESCE(max_pieces, 1)), 0) AS total
     FROM criteria
     WHERE tier = $1`,
    [tier],
  );
  return parseFloat(result.rows[0]?.total || 0);
}

// ============================================================================
// GET /board
// ============================================================================

router.get("/", requireLogin, async (req, res) => {
  const user = req.session.user;
  const tier = user.role === "admin" ? safeTier(req.query.tier) : user.tier;

  try {
    const [ranked, maxScore] = await Promise.all([
      getRanked(tier),
      getMaxScore(tier),
    ]);

    res.render("board/index", {
      title: "สรุปผลคะแนน",
      pageTitle: "<span>สรุปผล</span>การแข่งขัน",
      tierSelector: true,
      activeTier: tier,
      ranked,
      maxScore,
      tier,
    });
  } catch (err) {
    console.error(err);
    // ห้าม redirect กลับ /board (จะวนไม่จบ)
    res.status(500).send("ไม่สามารถโหลดผลคะแนนได้");
  }
});

// ============================================================================
// GET /board/export?tier=beginner
// ดาวน์โหลดสรุปผลเป็น Excel
// สิทธิ์เหมือนหน้า board: admin เลือก tier ได้ / กรรมการได้แค่ tier ของตัวเอง
// ============================================================================

// ปรับ key ให้ตรงกับค่าจริงใน teams.status
const TEAM_STATUS_LABEL = {
  approved: "เสร็จสิ้น",
  pending: "รอพิจารณา",
};

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function publishLabel(score, published) {
  if (score === null) return "";
  return published ? "เผยแพร่" : "ซ่อนอยู่";
}

router.get("/export", requireLogin, async (req, res) => {
  const user = req.session.user;
  const tier = user.role === "admin" ? safeTier(req.query.tier) : user.tier;

  try {
    const [ranked, maxScore] = await Promise.all([
      getRanked(tier),
      getMaxScore(tier),
    ]);

    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Robo Challenge League";
    const ws = wb.addWorksheet(tierLabel);

    ws.columns = [
      { header: "อันดับ", key: "rank", width: 8 },
      { header: "ชื่อทีม", key: "name", width: 34 },
      { header: "โรงเรียน/สังกัด", key: "institution", width: 32 },
      { header: "รอบที่ 1 (คะแนน)", key: "r1_score", width: 16 },
      { header: "รอบที่ 1 (เวลา วิ)", key: "r1_time", width: 16 },
      { header: "รอบที่ 1 สถานะ", key: "r1_pub", width: 14 },
      { header: "รอบที่ 2 (คะแนน)", key: "r2_score", width: 16 },
      { header: "รอบที่ 2 (เวลา วิ)", key: "r2_time", width: 16 },
      { header: "รอบที่ 2 สถานะ", key: "r2_pub", width: 14 },
      { header: "คะแนนที่ดีที่สุด", key: "best_score", width: 16 },
      { header: "เวลาที่ใช้ (วิ)", key: "best_time", width: 14 },
      { header: "คะแนนเต็ม", key: "max_score", width: 12 },
      { header: "สถานะทีม", key: "status", width: 14 },
    ];

    ranked.forEach(function (r, i) {
      const r1 = toNum(r.r1_score);
      const r2 = toNum(r.r2_score);
      const hasScore = r1 !== null || r2 !== null;

      ws.addRow({
        rank: i + 1,
        name: r.name,
        institution: r.institution || "",
        r1_score: r1,
        r1_time: toNum(r.r1_time),
        r1_pub: publishLabel(r1, r.r1_published),
        r2_score: r2,
        r2_time: toNum(r.r2_time),
        r2_pub: publishLabel(r2, r.r2_published),
        // GREATEST(COALESCE(...,0)) ให้ 0 เสมอ → ถ้ายังไม่มีคะแนนเลยให้เว้นว่าง
        best_score: hasScore ? toNum(r.best_score) : null,
        best_time: hasScore ? toNum(r.best_time) : null,
        max_score: maxScore,
        status: TEAM_STATUS_LABEL[r.status] || r.status || "",
      });
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
    header.height = 28;

    ws.getColumn("rank").alignment = { horizontal: "center" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "M1" };

    const date = new Date().toISOString().slice(0, 10);
    const asciiName = `RCL_${tierLabel}_${date}.xlsx`;
    const thaiName = `RCL_สรุปผล_${tierLabel}_${date}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(thaiName)}`,
    );

    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("Export board error:", err);
    if (!res.headersSent) {
      return res.status(500).send("ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
  }
});

// ============================================================================
// CRITERIA
// ============================================================================

router.get("/criteria", requireLogin, requireAdmin, async (req, res) => {
  const tier = safeTier(req.query.tier);

  try {
    const result = await query(
      "SELECT * FROM criteria ORDER BY tier, mission, id",
      [],
    );

    res.render("board/criteria", {
      title: "จัดการเกณฑ์คะแนน",
      pageTitle: "<span>จัดการ</span>เกณฑ์คะแนน",
      tierSelector: true,
      activeTier: tier,
      criteria: result.rows,
      tier,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    res.redirect("/board");
  }
});

function parseCriteriaBody(body) {
  const sType = body.score_type === "both" ? "both" : "full_only";

  return {
    name: String(body.name || "").trim(),
    maxScore: parseFloat(body.max_score),
    scoreType: sType,
    scorePartial: sType === "both" ? parseFloat(body.score_partial) || 0 : 0,
    maxPieces: Math.max(1, parseInt(body.max_pieces, 10) || 1),
  };
}

router.post("/criteria", requireLogin, requireAdmin, async (req, res) => {
  const tier = safeTier(req.body.tier);
  const back = "/board/criteria?tier=" + tier;

  try {
    const c = parseCriteriaBody(req.body);

    if (!c.name || !Number.isFinite(c.maxScore)) {
      req.flash("error", "กรุณากรอกชื่อภารกิจและคะแนนให้ถูกต้อง");
      return res.redirect(back);
    }

    const missionResult = await query(
      "SELECT COALESCE(MAX(mission), 0) AS max_mission FROM criteria WHERE tier = $1",
      [tier],
    );

    const nextMission = parseInt(missionResult.rows[0].max_mission, 10) + 1;

    await query(
      `INSERT INTO criteria
         (tier, mission, name, max_score, score_type, score_partial, max_pieces)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tier,
        nextMission,
        c.name,
        c.maxScore,
        c.scoreType,
        c.scorePartial,
        c.maxPieces,
      ],
    );

    req.flash("success", "เพิ่มภารกิจแล้ว");
    res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash("error", "เพิ่มภารกิจไม่ได้");
    res.redirect(back);
  }
});

async function updateCriteria(req, res) {
  const tier = safeTier(req.body.tier);
  const back = "/board/criteria?tier=" + tier;

  try {
    const c = parseCriteriaBody(req.body);

    if (!c.name || !Number.isFinite(c.maxScore)) {
      req.flash("error", "กรุณากรอกชื่อภารกิจและคะแนนให้ถูกต้อง");
      return res.redirect(back);
    }

    await query(
      `UPDATE criteria
       SET name = $1, max_score = $2, score_type = $3, score_partial = $4, max_pieces = $5
       WHERE id = $6`,
      [
        c.name,
        c.maxScore,
        c.scoreType,
        c.scorePartial,
        c.maxPieces,
        req.params.id,
      ],
    );

    req.flash("success", "อัปเดตภารกิจแล้ว");
    res.redirect(back);
  } catch (err) {
    console.error(err);
    req.flash("error", "อัปเดตไม่ได้");
    res.redirect(back);
  }
}

router.post("/criteria/:id", requireLogin, requireAdmin, updateCriteria);
router.put("/criteria/:id", requireLogin, requireAdmin, updateCriteria);

router.delete("/criteria/:id", requireLogin, requireAdmin, async (req, res) => {
  const tier = safeTier(req.query.tier);

  try {
    await query("DELETE FROM criteria WHERE id = $1", [req.params.id]);
    req.flash("success", "ลบภารกิจแล้ว");
  } catch (err) {
    console.error(err);
    req.flash("error", "ลบไม่ได้");
  }

  res.redirect("/board/criteria?tier=" + tier);
});

// ============================================================================
// SETTINGS
// ============================================================================

router.get("/settings", requireLogin, requireAdmin, async (req, res) => {
  try {
    const result = await query("SELECT * FROM settings", []);
    const settings = {};
    result.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });

    res.render("board/settings", {
      title: "ตั้งค่า",
      pageTitle: "<span>ตั้งค่า</span>ระบบ",
      tierSelector: false,
      activeTier: "",
      settings,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    res.redirect("/board");
  }
});

const SETTING_KEYS = [
  "event_date",
  "event_date_end",
  "event_date_label",
  "promo_active",
  "promo_end_date",
  "registration_open_date",
  "registration_close_date",
  // ราคาสินค้า Pre-order
  "price_full",
  "price_mat",
  "price_field",
  "price_mission",
  // ส่วนลดแยกต่อสินค้า
  "discount_full",
  "discount_mat",
  "discount_field",
  "discount_mission",
  // สถานะสินค้าหมด ("1" = หมด, "0" = มีสินค้า)
  "soldout_full",
  "soldout_mat",
  "soldout_field",
  "soldout_mission",
];

router.post("/settings", requireLogin, requireAdmin, async (req, res) => {
  try {
    const existingResult = await query("SELECT * FROM settings", []);
    const existing = {};
    existingResult.rows.forEach(function (r) {
      existing[r.key] = r.value;
    });

    const val = (key, formVal) =>
      formVal !== undefined ? formVal || null : existing[key] || null;

    for (const k of SETTING_KEYS) {
      await query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
        [k, val(k, req.body[k])],
      );
    }

    req.flash("success", "บันทึกการตั้งค่าแล้ว");
  } catch (err) {
    console.error(err);
    req.flash("error", "บันทึกการตั้งค่าไม่ได้");
  }

  res.redirect("/board/settings");
});

// ============================================================================
// PRE-ORDERS
// ============================================================================

router.get("/preorders", requireLogin, requireAdmin, async (req, res) => {
  const status = req.query.status || "";

  try {
    let sql = "SELECT * FROM preorders";
    const params = [];

    if (status) {
      sql += " WHERE status = $1";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";

    const result = await query(sql, params);

    res.render("board/preorders", {
      title: "Pre-order สนาม",
      pageTitle: "<span>Pre-order</span> สนามแข่งขัน",
      tierSelector: false,
      activeTier: "",
      preorders: result.rows,
      status,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    res.redirect("/board");
  }
});

router.post(
  "/preorders/:id/status",
  requireLogin,
  requireAdmin,
  async (req, res) => {
    try {
      await query("UPDATE preorders SET status = $1 WHERE id = $2", [
        req.body.status,
        req.params.id,
      ]);
      req.flash("success", "อัปเดตสถานะแล้ว");
    } catch (err) {
      console.error(err);
      req.flash("error", "อัปเดตสถานะไม่ได้");
    }

    res.redirect("/board/preorders");
  },
);

router.delete(
  "/preorders/:id",
  requireLogin,
  requireAdmin,
  async (req, res) => {
    try {
      await query("DELETE FROM preorders WHERE id = $1", [req.params.id]);
      req.flash("success", "ลบ Pre-order แล้ว");
    } catch (err) {
      console.error(err);
      req.flash("error", "ลบไม่ได้");
    }

    res.redirect("/board/preorders");
  },
);

// ============================================================================
// POST /board/scores/:teamId/:round/publish
// ============================================================================

router.post(
  "/scores/:teamId/:round/publish",
  requireLogin,
  requireAdmin,
  async (req, res) => {
    const { teamId } = req.params;
    const round = parseInt(req.params.round, 10);
    const tier = safeTier(req.query.tier);

    try {
      // toggle ในคำสั่งเดียว
      const result = await query(
        `UPDATE scores
         SET is_published = NOT COALESCE(is_published, false)
         WHERE team_id = $1 AND round = $2
         RETURNING is_published`,
        [teamId, round],
      );

      if (!result.rows.length) {
        req.flash("error", "ยังไม่มีคะแนนของรอบนี้");
      } else {
        req.flash(
          "success",
          result.rows[0].is_published ? "เผยแพร่คะแนนแล้ว" : "ซ่อนคะแนนแล้ว",
        );
      }
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
    }

    res.redirect("/board?tier=" + tier);
  },
);

// ============================================================================
// POST /board/scores/:teamId/:round/clear
// ล้างคะแนนของทีม 1 รอบ (เฉพาะ admin)
// ส่ง ?back=scores เพื่อกลับไปหน้า /scores, ไม่ส่ง = กลับหน้า /board
// ============================================================================

router.post(
  "/scores/:teamId/:round/clear",
  requireLogin,
  requireAdmin,
  async (req, res) => {
    // team id เป็นข้อความ เช่น T007_B
    const teamId = String(req.params.teamId || "").trim();
    const round = parseInt(req.params.round, 10);
    const tier = safeTier(req.query.tier);
    const back =
      (req.query.back === "scores" ? "/scores" : "/board") + "?tier=" + tier;

    if (!teamId || (round !== 1 && round !== 2)) {
      req.flash("error", "ข้อมูลไม่ถูกต้อง");
      return res.redirect(back);
    }

    try {
      const result = await query(
        `DELETE FROM scores
         WHERE team_id = $1 AND round = $2
         RETURNING id`,
        [teamId, round],
      );

      if (!result.rows.length) {
        req.flash("error", "ทีมนี้ยังไม่มีคะแนนรอบที่ " + round);
      } else {
        req.flash("success", "ล้างคะแนนรอบที่ " + round + " แล้ว");
      }
    } catch (err) {
      console.error("Clear score error:", err);
      req.flash("error", "ล้างคะแนนไม่สำเร็จ");
    }

    return res.redirect(back);
  },
);

// ============================================================================
// GET /board/certificates
// ============================================================================

router.get("/certificates", requireLogin, requireAdmin, async (req, res) => {
  const activeTier = safeTier(req.query.tier);

  try {
    const result = await query(
      "SELECT * FROM certificate_templates WHERE tier = $1 ORDER BY cert_type",
      [activeTier],
    );

    return res.render("board/certificates", {
      title: "จัดการเกียรติบัตร",
      pageTitle: "<span>จัดการ</span>เกียรติบัตร",
      tierSelector: true,
      activeTier,
      tier: activeTier,
      templates: result.rows,
    });
  } catch (err) {
    console.error("Load certificate templates error:", err);
    req.flash("error", "โหลดข้อมูลเกียรติบัตรไม่ได้");
    return res.redirect("/board");
  }
});

// ============================================================================
// POST /board/certificates/upload
// อัปโหลด Background + บันทึกตำแหน่ง / ขนาด / สีของชื่อ
// ถ้ายังไม่มี Template ของประเภทนี้ → สร้างใหม่
// ============================================================================

function handleCertUpload(req, res, next) {
  certUpload.single("background")(req, res, function (err) {
    if (err) {
      console.error("Certificate upload error:", err);
      req.flash("error", err.message || "อัปโหลดไฟล์ไม่ได้");
      return res.redirect(
        "/board/certificates?tier=" + safeTier(req.body && req.body.tier),
      );
    }
    next();
  });
}

router.post(
  "/certificates/upload",
  requireLogin,
  requireAdmin,
  handleCertUpload,
  async (req, res) => {
    const tier = safeTier(req.body.tier);
    const certType = req.body.cert_type;
    const back = "/board/certificates?tier=" + tier;

    try {
      if (!TIERS.includes(req.body.tier) || !CERT_TYPES.includes(certType)) {
        req.flash("error", "ข้อมูลประเภทเกียรติบัตรไม่ถูกต้อง");
        return res.redirect(back);
      }

      // ---------------- อ่านค่าจากฟอร์ม ----------------

      const backgroundUrl =
        req.file?.secure_url || req.file?.path || req.file?.url || null;

      const x = parseFloat(req.body.name_x);
      const y = parseFloat(req.body.name_y);

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 100 ||
        y < 0 ||
        y > 100
      ) {
        req.flash("error", "ตำแหน่ง X / Y ต้องอยู่ระหว่าง 0–100");
        return res.redirect(back);
      }

      // เว้นว่าง = อัตโนมัติ (NULL)
      let fontSize = null;
      const sizeRaw = String(req.body.name_font_size ?? "").trim();

      if (sizeRaw !== "") {
        fontSize = parseInt(sizeRaw, 10);

        if (
          !Number.isInteger(fontSize) ||
          fontSize < FONT_SIZE_MIN ||
          fontSize > FONT_SIZE_MAX
        ) {
          req.flash(
            "error",
            `ขนาดตัวอักษรต้องอยู่ระหว่าง ${FONT_SIZE_MIN}–${FONT_SIZE_MAX} px`,
          );
          return res.redirect(back);
        }
      }

      const color = /^#[0-9a-fA-F]{6}$/.test(req.body.name_color || "")
        ? req.body.name_color
        : null;

      // ---------------- บันทึก ----------------

      const existing = await query(
        "SELECT id FROM certificate_templates WHERE tier = $1 AND cert_type = $2 LIMIT 1",
        [tier, certType],
      );

      if (existing.rows.length) {
        await query(
          `UPDATE certificate_templates
           SET background_url = COALESCE($1, background_url),
               name_x = $2,
               name_y = $3,
               name_font_size = $4,
               name_color = $5
           WHERE id = $6`,
          [backgroundUrl, x, y, fontSize, color, existing.rows[0].id],
        );
      } else {
        if (!backgroundUrl) {
          req.flash("error", "กรุณาเลือกไฟล์ Background ก่อนบันทึกครั้งแรก");
          return res.redirect(back);
        }

        await query(
          `INSERT INTO certificate_templates
             (tier, cert_type, background_url, name_x, name_y, name_font_size, name_color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tier, certType, backgroundUrl, x, y, fontSize, color],
        );
      }

      req.flash("success", "บันทึกเกียรติบัตรเรียบร้อยแล้ว");
      return res.redirect(back);
    } catch (err) {
      console.error("Save certificate template error:", err);
      req.flash("error", "เกิดข้อผิดพลาดในการบันทึกเกียรติบัตร");
      return res.redirect(back);
    }
  },
);

module.exports = router;
module.exports.getRanked = getRanked;
module.exports.getMaxScore = getMaxScore;
