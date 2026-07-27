const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { requireLogin, requireJudge, requireTierAccess } = require('../middleware/auth')
const cloudinary = require('../config/cloudinary')
const multer = require('multer')
const { CloudinaryStorage } = require('multer-storage-cloudinary')

// Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'robo-league/scores', allowed_formats: ['jpg', 'jpeg', 'png'] }
})
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } })

// GET /scores — แสดงรายชื่อทีมพร้อมคะแนน
router.get('/', requireLogin, requireJudge, async (req, res) => {
  const user = req.session.user
  const tier = user.role === 'admin' ? (req.query.tier || 'beginner') : user.tier

  try {
    const [teamsResult, criteriaResult] = await Promise.all([
      query(`
        SELECT t.*,
          s1.total_score as r1_score, s1.time_seconds as r1_time,
          s2.total_score as r2_score, s2.time_seconds as r2_time
        FROM teams t
        LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
        LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
        WHERE t.tier = $1
        ORDER BY t.created_at ASC
      `, [tier]),
      query(`SELECT * FROM criteria WHERE tier = $1 ORDER BY mission`, [tier])
    ])

    const maxScore = criteriaResult.rows.reduce((s, c) => s + parseFloat(c.max_score), 0)

    res.render('scores/index', {
      title: 'ลงคะแนน',
      pageTitle: '<span>ลงคะแนน</span>การแข่งขัน',
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      criteria: criteriaResult.rows,
      maxScore,
      tier
    })
  } catch (err) {
    console.error(err)
    req.flash('error', 'ไม่สามารถโหลดข้อมูลได้')
    res.redirect('/dashboard')
  }
})

// GET /scores/:teamId/:round — ฟอร์มลงคะแนน
router.get('/:teamId/:round', requireLogin, requireJudge, requireTierAccess, async (req, res) => {
  const { teamId, round } = req.params
  const user = req.session.user

  try {
    const [teamResult, criteriaResult, existingResult] = await Promise.all([
      query('SELECT * FROM teams WHERE id = $1', [teamId]),
      query('SELECT * FROM criteria WHERE tier = (SELECT tier FROM teams WHERE id = $1) ORDER BY mission', [teamId]),
      query('SELECT * FROM scores WHERE team_id = $1 AND round = $2', [teamId, round])
    ])

    const team = teamResult.rows[0]
    if (!team) { req.flash('error', 'ไม่พบทีมนี้'); return res.redirect('/scores') }

    // ตรวจสิทธิ์ judge
    if (user.role === 'judge' && user.tier !== team.tier) {
      req.flash('error', `คุณเป็นกรรมการรุ่น ${user.tier} เท่านั้น`)
      return res.redirect('/scores')
    }

    const existing = existingResult.rows[0] || null
    const maxScore = criteriaResult.rows.reduce((s, c) => s + parseFloat(c.max_score), 0)

    res.render('scores/form', {
      layout: 'layouts/main',
      title: `ลงคะแนน ${team.name} รอบ ${round}`,
      pageTitle: `<span>ลงคะแนน</span> — รอบที่ ${round}`,
      tierSelector: false,
      activeTier: team.tier,
      team,
      round: parseInt(round),
      criteria: criteriaResult.rows,
      existing,
      maxScore
    })
  } catch (err) {
    console.error(err)
    req.flash('error', 'เกิดข้อผิดพลาด')
    res.redirect('/scores')
  }
})

// POST /scores/:teamId/:round — บันทึกคะแนน
router.post('/:teamId/:round', requireLogin, requireJudge,
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'signature', maxCount: 1 }]),
  async (req, res) => {
    const { teamId, round } = req.params
    const user = req.session.user
    const { time_seconds } = req.body

    try {
      const teamResult = await query('SELECT * FROM teams WHERE id = $1', [teamId])
      const team = teamResult.rows[0]
      if (!team) { req.flash('error', 'ไม่พบทีมนี้'); return res.redirect('/scores') }

      if (user.role === 'judge' && user.tier !== team.tier) {
        req.flash('error', `คุณไม่มีสิทธิ์ลงคะแนนรุ่นนี้`)
        return res.redirect('/scores')
      }

      const criteriaResult = await query(
        'SELECT * FROM criteria WHERE tier = $1 ORDER BY mission', [team.tier]
      )

      const missions = criteriaResult.rows.map((c, i) => {
        const val = parseFloat(req.body[`mission_${i + 1}`]) || 0
        return Math.min(Math.max(val, 0), parseFloat(c.max_score))
      })

      const photoUrl = req.files?.photo?.[0]?.path || null
      const signatureUrl = req.files?.signature?.[0]?.path || null

      await query(`
        INSERT INTO scores (team_id, judge_id, round, mission_1, mission_2, mission_3, mission_4, mission_5, time_seconds, photo_url, signature_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (team_id, round) DO UPDATE SET
          judge_id=$2, mission_1=$4, mission_2=$5, mission_3=$6, mission_4=$7, mission_5=$8,
          time_seconds=$9,
          photo_url = COALESCE($10, scores.photo_url),
          signature_url = COALESCE($11, scores.signature_url),
          scored_at=NOW()
      `, [teamId, user.id, parseInt(round),
          missions[0] || 0, missions[1] || 0, missions[2] || 0, missions[3] || 0, missions[4] || 0,
          time_seconds ? parseFloat(time_seconds) : null,
          photoUrl, signatureUrl])

      req.flash('success', `บันทึกคะแนนรอบ ${round} ของทีม "${team.name}" สำเร็จ`)
      res.redirect('/scores')
    } catch (err) {
      console.error(err)
      req.flash('error', 'ไม่สามารถบันทึกคะแนนได้')
      res.redirect('/scores')
    }
  }
)

module.exports = router
