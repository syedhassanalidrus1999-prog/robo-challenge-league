const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { requireLogin } = require('../middleware/auth')

// GET /board — บอร์ดสรุปคะแนน (admin/judge)
router.get('/', requireLogin, async (req, res) => {
  const user = req.session.user
  const tier = user.role === 'admin' ? (req.query.tier || 'beginner') : user.tier

  try {
    const ranked = await getRanked(tier);
    console.log("ranked[0]:", ranked[0]); // เพิ่มบรรทัดนี้
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
    console.error(err)
    req.flash('error', 'ไม่สามารถโหลดผลคะแนนได้')
    res.redirect('/dashboard')
  }
})

// Helper: ดึง ranked teams
async function getRanked(tier) {
  const result = await query(
    `
    SELECT
      t.id, t.name, t.institution, t.status, t.tier,
      s1.total_score  AS r1_score, s1.time_seconds AS r1_time,
      s2.total_score  AS r2_score, s2.time_seconds AS r2_time,
      GREATEST(COALESCE(s1.total_score,0), COALESCE(s2.total_score,0)) AS best_score,
      CASE
        WHEN COALESCE(s1.total_score,0) >= COALESCE(s2.total_score,0) THEN s1.time_seconds
        ELSE s2.time_seconds
      END AS best_time
    FROM teams t
    LEFT JOIN scores s1 ON s1.team_id = t.id AND s1.round = 1
    LEFT JOIN scores s2 ON s2.team_id = t.id AND s2.round = 2
    WHERE t.tier = $1
    ORDER BY best_score DESC, best_time ASC
  `,
    [tier],
  );
  return result.rows;
}

async function getMaxScore(tier) {
  const result = await query(`SELECT SUM(max_score) as total FROM criteria WHERE tier = $1`, [tier])
  return parseFloat(result.rows[0]?.total || 0)
}

// GET /board/criteria — หน้าจัดการเกณฑ์
router.get('/criteria', requireLogin, async (req, res) => {
  const { requireAdmin } = require('../middleware/auth')
  const tier = req.query.tier || 'beginner'
  try {
    const result = await query('SELECT * FROM criteria ORDER BY tier, mission', [])
    res.render('board/criteria', {
      title: 'จัดการเกณฑ์คะแนน',
      pageTitle: '<span>จัดการ</span>เกณฑ์คะแนน',
      tierSelector: true,
      activeTier: tier,
      criteria: result.rows,
      tier
    })
  } catch (err) {
    console.error(err)
    req.flash('error', 'โหลดข้อมูลไม่ได้')
    res.redirect('/board')
  }
})

// POST /board/criteria — เพิ่มภารกิจ
router.post('/criteria', requireLogin, async (req, res) => {
  const { tier, name, max_score } = req.body
  try {
    const countResult = await query('SELECT COUNT(*) as cnt FROM criteria WHERE tier = $1', [tier])
    const nextMission = parseInt(countResult.rows[0].cnt) + 1
    await query('INSERT INTO criteria (tier, mission, name, max_score) VALUES ($1,$2,$3,$4)',
      [tier, nextMission, name.trim(), parseFloat(max_score)])
    req.flash('success', 'เพิ่มภารกิจแล้ว')
    res.redirect('/board/criteria?tier=' + tier)
  } catch (err) {
    console.error(err)
    req.flash('error', 'เพิ่มภารกิจไม่ได้')
    res.redirect('/board/criteria?tier=' + tier)
  }
})

// PUT /board/criteria/:id — แก้ไขภารกิจ
router.put('/criteria/:id', requireLogin, async (req, res) => {
  const { name, max_score, tier } = req.body
  try {
    await query('UPDATE criteria SET name=$1, max_score=$2 WHERE id=$3',
      [name.trim(), parseFloat(max_score), req.params.id])
    req.flash('success', 'อัปเดตภารกิจแล้ว')
    res.redirect('/board/criteria?tier=' + tier)
  } catch (err) {
    console.error(err)
    req.flash('error', 'อัปเดตไม่ได้')
    res.redirect('/board/criteria?tier=' + tier)
  }
})

// DELETE /board/criteria/:id — ลบภารกิจ
router.delete('/criteria/:id', requireLogin, async (req, res) => {
  const { tier } = req.query
  try {
    await query('DELETE FROM criteria WHERE id=$1', [req.params.id])
    req.flash('success', 'ลบภารกิจแล้ว')
    res.redirect('/board/criteria?tier=' + tier)
  } catch (err) {
    console.error(err)
    req.flash('error', 'ลบไม่ได้')
    res.redirect('/board/criteria?tier=' + tier)
  }
})

module.exports = router
module.exports.getRanked = getRanked
module.exports.getMaxScore = getMaxScore
