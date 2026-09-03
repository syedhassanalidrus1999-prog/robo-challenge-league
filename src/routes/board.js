const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

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

// ─── GET /board ───────────────────────────────────────────────────────────────
router.get("/", requireLogin, async (req, res) => {
  const user = req.session.user;
  const tier = user.role === "admin" ? req.query.tier || "beginner" : user.tier;
  try {
    const ranked = await getRanked(tier);
    const maxScore = await getMaxScore(tier);
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
    req.flash("error", "ไม่สามารถโหลดผลคะแนนได้");
    res.redirect("/board");
  }
});

// Helper: ดึง ranked teams
async function getRanked(tier) {
  const result = await query(
    `SELECT
      t.id, t.name, t.institution, t.status, t.tier,
      s1.total_score AS r1_score, s1.time_seconds AS r1_time, s1.is_published AS r1_published,
      s2.total_score AS r2_score, s2.time_seconds AS r2_time, s2.is_published AS r2_published,
      GREATEST(COALESCE(s1.total_score,0), COALESCE(s2.total_score,0)) AS best_score,
      CASE
        WHEN COALESCE(s1.total_score,0) >= COALESCE(s2.total_score,0) THEN s1.time_seconds
        ELSE s2.time_seconds
      END AS best_time
    FROM teams t
    LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
    LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
    WHERE t.tier = $1
    ORDER BY best_score DESC, best_time ASC`,
    [tier],
  );
  return result.rows;
}

async function getMaxScore(tier) {
  const result = await query(
    "SELECT SUM(max_score) as total FROM criteria WHERE tier = $1",
    [tier],
  );
  return parseFloat(result.rows[0]?.total || 0);
}

// ─── GET /board/criteria ──────────────────────────────────────────────────────
router.get("/criteria", requireLogin, async (req, res) => {
  const tier = req.query.tier || "beginner";
  try {
    const result = await query(
      "SELECT * FROM criteria ORDER BY tier, mission",
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

router.post("/criteria", requireLogin, async (req, res) => {
  const { tier, name, max_score, score_type, score_partial } = req.body;
  try {
    const countResult = await query(
      "SELECT COUNT(*) as cnt FROM criteria WHERE tier = $1",
      [tier],
    );
    const nextMission = parseInt(countResult.rows[0].cnt) + 1;
    const sType = score_type === "both" ? "both" : "full_only";
    const sPartial = sType === "both" ? parseFloat(score_partial) || 0 : 0;
    await query(
      "INSERT INTO criteria (tier, mission, name, max_score, score_type, score_partial) VALUES ($1,$2,$3,$4,$5,$6)",
      [tier, nextMission, name.trim(), parseFloat(max_score), sType, sPartial],
    );
    req.flash("success", "เพิ่มภารกิจแล้ว");
    res.redirect("/board/criteria?tier=" + tier);
  } catch (err) {
    console.error(err);
    req.flash("error", "เพิ่มภารกิจไม่ได้");
    res.redirect("/board/criteria?tier=" + tier);
  }
});

router.put("/criteria/:id", requireLogin, async (req, res) => {
  const { name, max_score, tier, score_type, score_partial } = req.body;
  try {
    const sType = score_type === "both" ? "both" : "full_only";
    const sPartial = sType === "both" ? parseFloat(score_partial) || 0 : 0;
    await query(
      "UPDATE criteria SET name=$1, max_score=$2, score_type=$3, score_partial=$4 WHERE id=$5",
      [name.trim(), parseFloat(max_score), sType, sPartial, req.params.id],
    );
    req.flash("success", "อัปเดตภารกิจแล้ว");
    res.redirect("/board/criteria?tier=" + tier);
  } catch (err) {
    console.error(err);
    req.flash("error", "อัปเดตไม่ได้");
    res.redirect("/board/criteria?tier=" + tier);
  }
});

router.delete("/criteria/:id", requireLogin, async (req, res) => {
  const { tier } = req.query;
  try {
    await query("DELETE FROM criteria WHERE id=$1", [req.params.id]);
    req.flash("success", "ลบภารกิจแล้ว");
    res.redirect("/board/criteria?tier=" + tier);
  } catch (err) {
    console.error(err);
    req.flash("error", "ลบไม่ได้");
    res.redirect("/board/criteria?tier=" + tier);
  }
});

// ─── GET /board/settings ──────────────────────────────────────────────────────
router.get("/settings", requireLogin, async (req, res) => {
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

router.post("/settings", requireLogin, async (req, res) => {
  const existingResult = await query("SELECT * FROM settings", []);
  const existing = {};
  existingResult.rows.forEach(function (r) {
    existing[r.key] = r.value;
  });
  const val = (key, formVal) =>
    formVal !== undefined ? formVal || null : existing[key] || null;

  const keys = [
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
  ];
  for (var k of keys) {
    await query(
      "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
      [k, val(k, req.body[k])],
    );
  }
  req.flash("success", "บันทึกการตั้งค่าแล้ว");
  res.redirect("/board/settings");
});
 
// ─── GET /board/preorders ─────────────────────────────────────────────────────
router.get("/preorders", requireLogin, async (req, res) => {
  const status = req.query.status || "";
  try {
    var sql = "SELECT * FROM preorders";
    var params = [];
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

router.post("/preorders/:id/status", requireLogin, async (req, res) => {
  const { status } = req.body;
  await query("UPDATE preorders SET status=$1 WHERE id=$2", [
    status,
    req.params.id,
  ]);
  req.flash("success", "อัปเดตสถานะแล้ว");
  res.redirect("/board/preorders");
});

router.delete("/preorders/:id", requireLogin, async (req, res) => {
  try {
    await query("DELETE FROM preorders WHERE id=$1", [req.params.id]);
    req.flash("success", "ลบ Pre-order แล้ว");
  } catch (err) {
    console.error(err);
    req.flash("error", "ลบไม่ได้");
  }
  res.redirect("/board/preorders");
});

// ─── POST /board/scores/:teamId/:round/publish ────────────────────────────────
router.post(
  "/scores/:teamId/:round/publish",
  requireLogin,
  async (req, res) => {
    const { teamId, round } = req.params;
    const tier = req.query.tier || "beginner";
    try {
      const current = await query(
        "SELECT is_published FROM scores WHERE team_id = $1 AND round = $2",
        [teamId, parseInt(round)],
      );
      const currentVal = current.rows[0] ? current.rows[0].is_published : false;
      await query(
        "UPDATE scores SET is_published = $1 WHERE team_id = $2 AND round = $3",
        [!currentVal, teamId, parseInt(round)],
      );
      req.flash("success", !currentVal ? "เผยแพร่คะแนนแล้ว" : "ซ่อนคะแนนแล้ว");
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
    }
    res.redirect("/board?tier=" + tier);
  },
);

// ─── GET /board/certificates ──────────────────────────────────────────────────
router.get("/certificates", requireLogin, async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM certificate_templates ORDER BY tier, cert_type",
      [],
    );
    const templates = {};
    result.rows.forEach(function (r) {
      if (!templates[r.tier]) templates[r.tier] = {};
      templates[r.tier][r.cert_type] = r;
    });
    res.render("board/certificates", {
      title: "จัดการเกียรติบัตร",
      pageTitle: "<span>จัดการ</span>เกียรติบัตร",
      tierSelector: false,
      activeTier: "",
      templates,
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "โหลดข้อมูลไม่ได้");
    res.redirect("/board");
  }
});

// ─── POST /board/certificates/:id ────────────────────────────────────────────
router.post(
  "/certificates/:id",
  requireLogin,
  function (req, res, next) {
    certUpload.single("background")(req, res, function (err) {
      if (err) {
        console.error("Upload error:", err.message);
        req.flash("error", "อัปโหลดไฟล์ไม่ได้");
        return res.redirect("/board/certificates");
      }
      next();
    });
  },
  async (req, res) => {
    const { id } = req.params;
    const { name_x, name_y, name_font_size, name_color } = req.body;
    try {
      var backgroundUrl = req.file ? req.file.path : null;
      var updateFields = [];
      var params = [];
      var idx = 1;

      if (backgroundUrl) {
        updateFields.push("background_url=$" + idx);
        params.push(backgroundUrl);
        idx++;
      }
      if (name_x) {
        updateFields.push("name_x=$" + idx);
        params.push(parseFloat(name_x));
        idx++;
      }
      if (name_y) {
        updateFields.push("name_y=$" + idx);
        params.push(parseFloat(name_y));
        idx++;
      }
      if (name_font_size) {
        updateFields.push("name_font_size=$" + idx);
        params.push(parseInt(name_font_size));
        idx++;
      }
      if (name_color) {
        updateFields.push("name_color=$" + idx);
        params.push(name_color);
        idx++;
      }

      if (updateFields.length > 0) {
        params.push(parseInt(id));
        await query(
          "UPDATE certificate_templates SET " +
            updateFields.join(", ") +
            " WHERE id=$" +
            idx,
          params,
        );
      }
      req.flash("success", "บันทึกแล้ว");
    } catch (err) {
      console.error(err);
      req.flash("error", "เกิดข้อผิดพลาด");
    }
    res.redirect("/board/certificates");
  },
);

module.exports = router;
module.exports.getRanked = getRanked;
module.exports.getMaxScore = getMaxScore;
