const express = require("express");
const router = express.Router();
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const { getRanked, getMaxScore } = require("./board");

// GET / — หน้าสาธารณะ
router.get("/", async (req, res) => {
  const tier = req.query.tier || "beginner";
  const view = req.query.view || "teams";

  try {
    const now = new Date();
    const timeStr =
      now.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }) +
      " เวลา " +
      now.getHours() +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      " น.";

    const [teamsAll, scoresAll, settingsResult] = await Promise.all([
      query("SELECT COUNT(*) as cnt FROM teams", []),
      query("SELECT COUNT(DISTINCT team_id) as cnt FROM scores", []),
      query("SELECT * FROM settings", []),
    ]);

    const settings = {};
    settingsResult.rows.forEach(function (r) {
      settings[r.key] = r.value;
    });

    let data = { teams: null, ranked: null, maxScore: 0 };

    if (view === "teams") {
      const result = await query(
        `SELECT id, name, institution, tier, student_1, student_2, student_3, status
   FROM teams WHERE tier = $1 AND status = 'approved' ORDER BY created_at ASC`,
        [tier],
      );
      data.teams = result.rows;
    } else {
      data.ranked = await getRanked(tier);
      data.maxScore = await getMaxScore(tier);
    }

    res.render("public/index", {
      layout: false,
      title: "Robo Challenge League",
      activeTier: tier,
      view,
      timeStr,
      teamCount: parseInt(teamsAll.rows[0].cnt),
      scoredCount: parseInt(scoresAll.rows[0].cnt),
      eventDate: settings.event_date || null,
      eventDateLabel: settings.event_date_label || null,
      eventDateEnd: settings.event_date_end || null,

      ...data,
    });
  } catch (err) {
    console.error(err);
    res.render("public/index", {
      layout: false,
      title: "Robo Challenge League",
      activeTier: tier,
      view: "teams",
      timeStr: "",
      teamCount: 0,
      scoredCount: 0,
      teams: [],
      ranked: null,
      maxScore: 0,
    });
  }
});

// GET /dashboard — redirect ตาม role
router.get("/dashboard", requireLogin, (req, res) => {
  if (req.session.user.role === "admin") return res.redirect("/teams");
  res.redirect("/scores");
});

// GET /register
router.get('/register', (req, res) => {
  res.render("register/index", {
    layout: false,
    success: true,
    teamId: id,
    teamName: name,
    tier,
    formData: req.body, // เพิ่มบรรทัดนี้
    errorMsg: null,
  });
})

// GET /register/:tier
router.get('/register/:tier', (req, res) => {
  const { tier } = req.params
  if (!['beginner','intermediate','advance'].includes(tier)) return res.redirect('/register')
  res.render('register/index', {
    layout: false,
    tier,
    success: false,
    teamId: '',
    teamName: '',
    formData: {},
    errorMsg: null
  })
})

// POST /register
router.post('/register', async (req, res) => {
  console.log(req.body);
  const { tier, name, institution, phone, coach, student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob } = req.body

  if (!name || !institution || !phone || !tier) {
    return res.render('register/index', {
      layout: false, tier, success: false, teamId: '', teamName: '',
      errorMsg: 'กรุณากรอกชื่อทีม สถาบัน และเบอร์โทรติดต่อ',
      formData: req.body
    })
  }

  try {
    const prefix = tier === 'beginner' ? 'B' : tier === 'intermediate' ? 'I' : 'A'
    const countResult = await query(
      "SELECT MAX(CAST(SUBSTRING(id FROM 2 FOR 3) AS INT)) as maxnum FROM teams WHERE tier = $1",
      [tier],
    );
    const num = (parseInt(countResult.rows[0].maxnum) || 0) + 1;
    const id = `T${String(num).padStart(3, "0")}_${prefix}`;

    await query(`
      INSERT INTO teams (id, name, institution, tier, phone, coach, student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
    `, [id, name.trim(), institution.trim(), tier,
        phone.trim(), coach?.trim()||null,
        student_1?.trim()||null, student_1_dob||null,
        student_2?.trim()||null, student_2_dob||null,
        student_3?.trim()||null, student_3_dob||null])

    res.render("register/index", {
      layout: false,
      success: true,
      teamId: id,
      teamName: name,
      tier,
      formData: {},
      formData: req.body, // ← มีบรรทัดนี้ไหม?
      errorMsg: null,
    });
  } catch (err) {
    console.error(err)
    res.render('register/index', {
      layout: false, tier, success: false, teamId: '', teamName: '',
      errorMsg: 'เกิดข้อผิดพลาด กรุณาลองใหม่',
      formData: req.body
    })
  }
})
// GET /docs
router.get('/docs', (req, res) => {
  res.render('public/docs', {
    layout: false,
    docs: {
      project:           null,  // ใส่ Google Drive link ตรงนี้
      invitation:        null,  // ใส่ Google Drive link ตรงนี้
      rules_beginner:    null,  // ใส่ Google Drive link ตรงนี้
      rules_intermediate: null, // ใส่ Google Drive link ตรงนี้
      rules_advance:     null   // ใส่ Google Drive link ตรงนี้
    }
  })
})

// GET /competition
router.get('/competition', async (req, res) => {
  const tier = req.query.tier || 'beginner'
  const view = req.query.view || 'teams'
  const now = new Date()
  const timeStr = now.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}) + ' เวลา ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2,'0') + ' น.'

  try {
    let data = { teams: null, ranked: null, maxScore: 0 }
    if (view === 'teams') {
      const result = await query(
        `SELECT id, name, institution, tier, status FROM teams WHERE tier = $1 AND status = 'approved' ORDER BY created_at ASC`, [tier]
      )
      data.teams = result.rows
    } else {
      data.ranked = await getRanked(tier)
      data.maxScore = await getMaxScore(tier)
    }
    return res.render('public/competition', {
      layout: false, activeTier: tier, view, timeStr, ...data
    })
  } catch (err) {
    console.error(err)
    return res.redirect('/')
  }
})

// GET /preorder
router.get('/preorder', (req, res) => {
  res.render('preorder/index', {
    layout: false,
    success: false,
    errorMsg: null,
    formData: {}
  })
})

router.post("/preorder", async (req, res) => {
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
  if (!school_name || !contact_name || !phone || !items_json) {
    return res.render("preorder/index", {
      layout: false,
      success: false,
      errorMsg: "กรุณากรอกข้อมูลให้ครบ",
      formData: req.body,
    });
  }
  var items = JSON.parse(items_json);
  var PRICES = {
    "beginner-full": 2500,
    "beginner-field": 500,
    "beginner-mission": 500,
    "intermediate-full": 2500,
    "intermediate-field": 500,
    "intermediate-mission": 500,
    "advance-full": 2500,
    "advance-field": 500,
    "advance-mission": 500,
  };
  var totalPrice = 0;
  Object.keys(items).forEach(function (k) {
    totalPrice += (PRICES[k] || 0) * items[k];
  });
  try {
    await query(
      `INSERT INTO preorders (school_name,contact_name,phone,email,address,district,province,zipcode,note,items_json,total_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        school_name,
        contact_name,
        phone,
        email || null,
        address || null,
        district || null,
        province || null,
        zipcode || null,
        note || null,
        items_json,
        totalPrice,
      ],
    );
    res.render("preorder/index", {
      layout: false,
      success: true,
      errorMsg: null,
      formData: {},
    });
  } catch (err) {
    console.error(err);
    res.render("preorder/index", {
      layout: false,
      success: false,
      errorMsg: "เกิดข้อผิดพลาด กรุณาลองใหม่",
      formData: req.body,
    });
  }
});
module.exports = router;
