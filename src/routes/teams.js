const express = require('express')
const router = express.Router()
const { query } = require('../config/database')
const { requireLogin, requireAdmin } = require('../middleware/auth')

// ─── GET /teams ───────────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res) => {
  const tier = req.query.tier || 'beginner'
  try {
    const [teamsResult, countsResult] = await Promise.all([
      query('SELECT * FROM teams WHERE tier = $1 ORDER BY created_at ASC', [tier]),
      query('SELECT tier, COUNT(*) as cnt FROM teams GROUP BY tier', []),
    ])
    const counts = { beginner: 0, intermediate: 0, advance: 0 }
    countsResult.rows.forEach(function (r) { counts[r.tier] = parseInt(r.cnt) })
    res.render('teams/index', {
      title: 'จัดการทีม',
      pageTitle: '<span>จัดการ</span>ทีมที่สมัคร',
      tierSelector: true,
      activeTier: tier,
      teams: teamsResult.rows,
      counts,
    })
  } catch (err) {
    console.error(err)
    req.flash('error', 'โหลดข้อมูลไม่ได้')
    res.redirect('/board')
  }
})

// ─── POST /teams ──────────────────────────────────────────────────────────────
router.post('/', requireLogin, requireAdmin, async (req, res) => {
  const { name, institution, phone, coach, tier,
    student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob } = req.body
  try {
    const prefix = tier === 'beginner' ? 'B' : tier === 'intermediate' ? 'I' : 'A'
    const countResult = await query(
      "SELECT MAX(CAST(SUBSTRING(id FROM 2 FOR 3) AS INT)) as maxnum FROM teams WHERE tier = $1", [tier])
    const num = (parseInt(countResult.rows[0].maxnum) || 0) + 1
    const id = 'T' + String(num).padStart(3, '0') + '_' + prefix
    await query(
      `INSERT INTO teams (id, name, institution, phone, coach, tier,
        student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, name.trim(), institution.trim(), phone ? phone.trim() : null,
        coach ? coach.trim() : null, tier,
        student_1 ? student_1.trim() : null, student_1_dob || null,
        student_2 ? student_2.trim() : null, student_2_dob || null,
        student_3 ? student_3.trim() : null, student_3_dob || null,
        'pending'],
    )
    req.flash('success', 'เพิ่มทีมแล้ว')
    res.redirect('/teams?tier=' + tier)
  } catch (err) {
    console.error(err)
    req.flash('error', 'เพิ่มทีมไม่ได้')
    res.redirect('/teams?tier=' + (req.body.tier || 'beginner'))
  }
})

// ─── PUT /teams/:id ───────────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireAdmin, async (req, res) => {
  const { id } = req.params
  const tier = req.body.tier || req.query.tier || 'beginner'
  const { name, institution, phone, coach, status, note,
    student_1, student_1_dob, student_2, student_2_dob, student_3, student_3_dob } = req.body
  try {
    await query(
      `UPDATE teams SET name=$1, institution=$2, phone=$3, coach=$4, tier=$5, status=$6, note=$7,
        student_1=$8, student_1_dob=$9, student_2=$10, student_2_dob=$11,
        student_3=$12, student_3_dob=$13 WHERE id=$14`,
      [name.trim(), institution.trim(), phone ? phone.trim() : null,
        coach ? coach.trim() : null, tier, status, note ? note.trim() : null,
        student_1 ? student_1.trim() : null, student_1_dob || null,
        student_2 ? student_2.trim() : null, student_2_dob || null,
        student_3 ? student_3.trim() : null, student_3_dob || null,
        id],
    )
    req.flash('success', 'อัปเดตทีมแล้ว')
    res.redirect('/teams?tier=' + tier)
  } catch (err) {
    console.error(err)
    req.flash('error', 'อัปเดตไม่ได้')
    res.redirect('/teams?tier=' + tier)
  }
})

// ─── DELETE /teams/:id ────────────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireAdmin, async (req, res) => {
  const tier = req.query.tier || 'beginner'
  try {
    await query('DELETE FROM scores WHERE team_id = $1', [req.params.id])
    await query('DELETE FROM teams WHERE id = $1', [req.params.id])
    req.flash('success', 'ลบทีมแล้ว')
  } catch (err) {
    console.error(err)
    req.flash('error', 'ลบไม่ได้')
  }
  res.redirect('/teams?tier=' + tier)
})

// ─── POST /teams/:id/checkin/:studentNum ──────────────────────────────────────
router.post('/:id/checkin/:studentNum', requireLogin, requireAdmin, async (req, res) => {
  const { id, studentNum } = req.params
  const tier = req.query.tier || 'beginner'
  const validNums = ['1', '2', '3']
  if (!validNums.includes(studentNum)) {
    req.flash('error', 'ข้อมูลไม่ถูกต้อง')
    return res.redirect('/teams?tier=' + tier)
  }
  const col = 'student_' + studentNum + '_checked_in'
  try {
    const current = await query('SELECT ' + col + ' FROM teams WHERE id = $1', [id])
    const currentVal = current.rows[0] ? current.rows[0][col] : false
    await query('UPDATE teams SET ' + col + ' = $1 WHERE id = $2', [!currentVal, id])
    req.flash('success', !currentVal ? 'เช็คชื่อแล้ว' : 'ยกเลิกเช็คชื่อแล้ว')
  } catch (err) {
    console.error(err)
    req.flash('error', 'เกิดข้อผิดพลาด')
  }
  res.redirect('/teams?tier=' + tier)
})

module.exports = router
