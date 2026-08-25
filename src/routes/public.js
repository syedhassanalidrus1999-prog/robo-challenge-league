const express = require("express");
const router = express.Router();
const { query } = require("../config/database");

function buildTiers(promoPercent) {
  var pct = promoPercent || 0;
  function makeItem(key, name, desc, price, hasDetail) {
    return {
      key: key,
      name: name,
      desc: desc,
      price: price,
      priceFormatted: price.toLocaleString(),
      promoPrice: Math.round(price * (1 - pct / 100)),
      promoPriceFormatted: Math.round(price * (1 - pct / 100)).toLocaleString(),
      hasDetail: hasDetail,
    };
  }
  return [
    {
      key: "beginner",
      label: "Beginner",
      emoji: "🌱",
      bg: "#F0FDF4",
      color: "#15803D",
      accent: "#16A34A",
      items: [
        makeItem(
          "beginner-full",
          "เซตสนาม Beginner",
          "สนามไวนิล 236x114 ซม. + ชิ้นส่วนภารกิจครบชุด",
          2500,
          true,
        ),
        makeItem(
          "beginner-mat",
          "สนามอย่างเดียว Beginner",
          "สนามไวนิล 236x114 ซม. ไม่รวมชิ้นส่วนภารกิจ",
          2400,
          true,
        ),
        makeItem(
          "beginner-field",
          "ไฟล์สนาม Beginner",
          "ไฟล์สำหรับพิมพ์เอง ส่งทางอีเมล",
          500,
          true,
        ),
        makeItem(
          "beginner-mission",
          "ชิ้นส่วนภารกิจ Beginner",
          "ชุดอุปกรณ์ภารกิจ (ไม่รวมสนาม)",
          500,
          false,
        ),
      ],
    },
    {
      key: "intermediate",
      label: "Intermediate",
      emoji: "🔥",
      bg: "#EFF6FF",
      color: "#1D4ED8",
      accent: "#2563EB",
      items: [
        makeItem(
          "intermediate-full",
          "เซตสนาม Intermediate",
          "สนามไวนิล 236x114 ซม. + ชิ้นส่วนภารกิจครบชุด",
          2500,
          true,
        ),
        makeItem(
          "intermediate-mat",
          "สนามอย่างเดียว Intermediate",
          "สนามไวนิล 236x114 ซม. ไม่รวมชิ้นส่วนภารกิจ",
          2400,
          true,
        ),
        makeItem(
          "intermediate-field",
          "ไฟล์สนาม Intermediate",
          "ไฟล์สำหรับพิมพ์เอง ส่งทางอีเมล",
          500,
          true,
        ),
        makeItem(
          "intermediate-mission",
          "ชิ้นส่วนภารกิจ Intermediate",
          "ชุดอุปกรณ์ภารกิจ (ไม่รวมสนาม)",
          500,
          false,
        ),
      ],
    },
    {
      key: "advance",
      label: "Advance",
      emoji: "🚀",
      bg: "#FFF7ED",
      color: "#C2410C",
      accent: "#EA580C",
      items: [
        makeItem(
          "advance-full",
          "เซตสนาม Advance",
          "สนามไวนิล 236x114 ซม. + ชิ้นส่วนภารกิจครบชุด",
          2500,
          true,
        ),
        makeItem(
          "advance-mat",
          "สนามอย่างเดียว Advance",
          "สนามไวนิล 236x114 ซม. ไม่รวมชิ้นส่วนภารกิจ",
          2400,
          true,
        ),
        makeItem(
          "advance-field",
          "ไฟล์สนาม Advance",
          "ไฟล์สำหรับพิมพ์เอง ส่งทางอีเมล",
          500,
          true,
        ),
        makeItem(
          "advance-mission",
          "ชิ้นส่วนภารกิจ Advance",
          "ชุดอุปกรณ์ภารกิจ (ไม่รวมสนาม)",
          500,
          false,
        ),
      ],
    },
  ];
}

async function getPromoSettings() {
  try {
    const settingsResult = await query("SELECT * FROM settings", []);
    const settings = {};
    settingsResult.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });
    var promoActive = settings.promo_active === "1";
    var promoPercent = parseInt(settings.promo_percent) || 10;
    var promoEndDate = settings.promo_end_date || null;
    if (promoEndDate && new Date(promoEndDate) < new Date())
      promoActive = false;
    return { promoActive, promoPercent, promoEndDate, settings };
  } catch (err) {
    return {
      promoActive: false,
      promoPercent: 0,
      promoEndDate: null,
      settings: {},
    };
  }
}

// ─── GET / ───────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const [teamsAll, scoresAll, settingsResult] = await Promise.all([
      query("SELECT COUNT(*) as cnt FROM teams", []),
      query("SELECT COUNT(DISTINCT team_id) as cnt FROM scores", []),
      query("SELECT * FROM settings", []),
    ]);
    const settings = {};
    settingsResult.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });
    return res.render("public/index", {
      layout: "layouts/public",
      title: "หน้าหลัก",
      teamCount: parseInt(teamsAll.rows[0].cnt),
      scoredCount: parseInt(scoresAll.rows[0].cnt),
      eventDate: settings.event_date || null,
      eventDateEnd: settings.event_date_end || null,
      eventDateLabel: settings.event_date_label || null,
      registrationOpenDate: settings.registration_open_date || null,
      registrationCloseDate: settings.registration_close_date || null,
    });
  } catch (err) {
    console.error(err);
    return res.render("public/index", {
      layout: "layouts/public",
      title: "หน้าหลัก",
      teamCount: 0,
      scoredCount: 0,
      eventDate: null,
      eventDateEnd: null,
      eventDateLabel: null,
      registrationOpenDate: null, // ← เพิ่ม
      registrationCloseDate: null, // ← เพิ่ม
    });
  }
});

// ─── GET /register ────────────────────────────────────────────────────────────
router.get("/register", async (req, res) => {
  try {
    const settingsResult = await query("SELECT * FROM settings", []);
    const settings = {};
    settingsResult.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: null,
      formData: {},
      errorMsg: null,
      registrationOpen: settings.registration_open !== "false",
    });
  } catch (err) {
    console.error(err);
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: null,
      formData: {},
      errorMsg: null,
      registrationOpen: true,
    });
  }
});

// ─── GET /register/:tier ──────────────────────────────────────────────────────
router.get("/register/:tier", async (req, res) => {
  const validTiers = ["beginner", "intermediate", "advance"];
  const tier = req.params.tier;
  if (!validTiers.includes(tier)) {
    return res.redirect("/register");
  }
  try {
    const settingsResult = await query("SELECT * FROM settings", []);
    const settings = {};
    settingsResult.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: tier,
      formData: {},
      errorMsg: null,
      registrationOpen: settings.registration_open !== "false",
    });
  } catch (err) {
    console.error(err);
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: tier,
      formData: {},
      errorMsg: null,
      registrationOpen: true,
    });
  }
});

// ─── POST /register ───────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  console.log(req.body);
  const {
    tier,
    name,
    institution,
    phone,
    coach,
    student_1,
    student_1_dob,
    student_2,
    student_2_dob,
    student_3,
    student_3_dob,
  } = req.body;

  if (!tier || !name || !institution || !phone) {
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: tier || null,
      formData: req.body,
      errorMsg: "กรุณากรอกข้อมูลให้ครบถ้วน",
      registrationOpen: true,
    });
  }

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
      `INSERT INTO teams (id, name, institution, phone, coach, tier, student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob, status)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        name.trim(),
        institution.trim(),
        phone.trim(),
        coach ? coach.trim() : null,
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

    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: true,
      teamId: id,
      teamName: name,
      tier: tier,
      formData: req.body,
      errorMsg: null,
      registrationOpen: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("register/index", {
      layout: false,
      title: "สมัครแข่งขัน",
      success: false,
      teamId: null,
      teamName: null,
      tier: tier || null,
      formData: req.body,
      errorMsg: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
      registrationOpen: true,
    });
  }
});

// ─── GET /teams-list ──────────────────────────────────────────────────────────
router.get("/teams-list", async (req, res) => {
  const tier = req.query.tier || "beginner";
  try {
    const result = await query(
      "SELECT * FROM teams WHERE status = 'approved' AND tier = $1 ORDER BY created_at ASC",
      [tier],
    );
    return res.render("public/teams", {
      layout: "layouts/public",
      title: "ทีมแข่งขัน",
      teams: result.rows,
      activeTier: tier,
    });
  } catch (err) {
    console.error(err);
    return res.render("public/teams", {
      layout: "layouts/public",
      title: "ทีมแข่งขัน",
      teams: [],
      activeTier: tier,
    });
  }
});

// ─── GET /scoreboard ──────────────────────────────────────────────────────────
router.get("/scoreboard", async (req, res) => {
  const tier = req.query.tier || "beginner";
  try {
    const [ranked, maxScoreResult] = await Promise.all([
      query(
        `SELECT t.id, t.name, t.institution, t.tier,
          s1.total_score as r1_score, s1.time_seconds as r1_time,
          s2.total_score as r2_score, s2.time_seconds as r2_time,
          GREATEST(COALESCE(s1.total_score,0), COALESCE(s2.total_score,0)) as best_score,
          LEAST(COALESCE(s1.time_seconds, 999999), COALESCE(s2.time_seconds, 999999)) as best_time
        FROM teams t
        LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
        LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
        WHERE t.tier = $1 AND t.status = 'approved'
        ORDER BY best_score DESC, best_time ASC`,
        [tier],
      ),
      query("SELECT SUM(max_score) as total FROM criteria WHERE tier = $1", [
        tier,
      ]),
    ]);
    const maxScore = parseFloat(maxScoreResult.rows[0].total) || 0;
    return res.render("public/scoreboard", {
      layout: "layouts/public",
      title: "ผลคะแนน",
      teams: ranked.rows,
      activeTier: tier,
      maxScore,
    });
  } catch (err) {
    console.error(err);
    return res.render("public/scoreboard", {
      layout: "layouts/public",
      title: "ผลคะแนน",
      teams: [],
      activeTier: tier,
      maxScore: 0,
    });
  }
});

// ─── GET /competition ─────────────────────────────────────────────────────────
router.get("/competition", async (req, res) => {
  const view = req.query.view || "board";
  const activeTier = req.query.tier || "beginner";
  const timeStr = new Date().toLocaleTimeString("th-TH");

  try {
    if (view === "teams") {
      const result = await query(
        "SELECT * FROM teams WHERE status = 'approved' AND tier = $1 ORDER BY created_at ASC",
        [activeTier],
      );
      return res.render("public/competition", {
        layout: false,
        title: "การแข่งขัน",
        view,
        activeTier,
        timeStr,
        teams: result.rows,
        ranked: null,
        maxScore: 0,
      });
    } else {
      const [ranked, maxScoreResult] = await Promise.all([
        query(
  `SELECT t.id, t.name, t.institution, t.tier,
    CASE WHEN s1.is_published = true THEN s1.total_score ELSE NULL END as r1_score,
    CASE WHEN s1.is_published = true THEN s1.time_seconds ELSE NULL END as r1_time,
    CASE WHEN s2.is_published = true THEN s2.total_score ELSE NULL END as r2_score,
    CASE WHEN s2.is_published = true THEN s2.time_seconds ELSE NULL END as r2_time,
    GREATEST(
      CASE WHEN s1.is_published = true THEN COALESCE(s1.total_score,0) ELSE 0 END,
      CASE WHEN s2.is_published = true THEN COALESCE(s2.total_score,0) ELSE 0 END
    ) as best_score,
    LEAST(
      CASE WHEN s1.is_published = true THEN COALESCE(s1.time_seconds,999999) ELSE 999999 END,
      CASE WHEN s2.is_published = true THEN COALESCE(s2.time_seconds,999999) ELSE 999999 END
    ) as best_time
  FROM teams t
  LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
  LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
  WHERE t.tier = $1 AND t.status = 'approved'
  ORDER BY best_score DESC, best_time ASC`,
  [activeTier],
),
        query("SELECT SUM(max_score) as total FROM criteria WHERE tier = $1", [activeTier]),
      ]);
      return res.render("public/competition", {
        layout: false,
        title: "การแข่งขัน",
        view,
        activeTier,
        timeStr,
        teams: null,
        ranked: ranked.rows,
        maxScore: parseFloat(maxScoreResult.rows[0].total) || 0,
      });
    }
  } catch (err) {
    console.error(err);
    return res.render("public/competition", {
      layout: false,
      title: "การแข่งขัน",
      view,
      activeTier,
      timeStr,
      teams: [],
      ranked: [],
      maxScore: 0,
    });
  }
});

// ─── GET /docs ────────────────────────────────────────────────────────────────
router.get("/docs", (req, res) => {
  return res.render("public/docs", {
    layout: "layouts/public",
    title: "เอกสาร",
    docs: [], // ← เพิ่ม
  });
});

// ─── GET /preorder ────────────────────────────────────────────────────────────
router.get("/preorder", async (req, res) => {
  const promo = await getPromoSettings();
  return res.render("preorder/index", {
    layout: false,
    success: false,
    errorMsg: null,
    formData: {},
    promoActive: promo.promoActive,
    promoPercent: promo.promoPercent,
    promoEndDate: promo.promoEndDate,
    tiers: buildTiers(promo.promoPercent),
  });
});

// ─── POST /preorder ───────────────────────────────────────────────────────────
router.post("/preorder", async (req, res) => {
  const promo = await getPromoSettings();
  const {
    school_name,
    contact_name,
    phone,
    email,
    address,
    district,
    province,
    zipcode,
    note,
    items_json,
  } = req.body;

  var renderData = {
    layout: false,
    success: false,
    errorMsg: null,
    formData: req.body,
    promoActive: promo.promoActive,
    promoPercent: promo.promoPercent,
    promoEndDate: promo.promoEndDate,
    tiers: buildTiers(promo.promoPercent),
  };

  if (!school_name || !contact_name || !phone || !items_json) {
    renderData.errorMsg = "กรุณากรอกข้อมูลให้ครบถ้วน";
    return res.render("preorder/index", renderData);
  }

  var PRICES = {
    "beginner-full": 2500,
    "beginner-mat": 2400,
    "beginner-field": 500,
    "beginner-mission": 500,
    "intermediate-full": 2500,
    "intermediate-mat": 2400,
    "intermediate-field": 500,
    "intermediate-mission": 500,
    "advance-full": 2500,
    "advance-mat": 2400,
    "advance-field": 500,
    "advance-mission": 500,
  };

  var items = {};
  try {
    items = JSON.parse(items_json);
  } catch (e) {
    items = {};
  }

  var totalPrice = 0;
  Object.keys(items).forEach(function (k) {
    var origPrice = PRICES[k] || 0;
    var finalPrice = promo.promoActive
      ? Math.round(origPrice * (1 - promo.promoPercent / 100))
      : origPrice;
    totalPrice += finalPrice * (parseInt(items[k]) || 1);
  });

  try {
    await query(
      `INSERT INTO preorders (school_name, contact_name, phone, email, address, district, province, zipcode, note, items_json, total_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        school_name.trim(),
        contact_name.trim(),
        phone.trim(),
        email ? email.trim() : null,
        address ? address.trim() : null,
        district ? district.trim() : null,
        province ? province.trim() : null,
        zipcode ? zipcode.trim() : null,
        note ? note.trim() : null,
        items_json,
        totalPrice,
      ],
    );
    return res.render("preorder/index", {
      layout: false,
      success: true,
      errorMsg: null,
      formData: {},
      promoActive: promo.promoActive,
      promoPercent: promo.promoPercent,
      promoEndDate: promo.promoEndDate,
      tiers: buildTiers(promo.promoPercent),
    });
  } catch (err) {
    console.error(err);
    renderData.errorMsg = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
    return res.render("preorder/index", renderData);
  }
});



module.exports = router;
