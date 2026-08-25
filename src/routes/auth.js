const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { query } = require('../config/database')

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/board')
  res.render('login', {
    layout: 'layouts/public',
    title: 'เข้าสู่ระบบ'
  })
})

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    req.flash('error', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
    return res.redirect('/auth/login')
  }

  try {
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username.trim()]
    )

    const user = result.rows[0]
    if (!user) {
      req.flash('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      return res.redirect('/auth/login')
    }

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      req.flash('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      return res.redirect('/auth/login')
    }

    // บันทึก session (ไม่เก็บ password_hash)
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      tier: user.tier
    }

    req.flash('success', `ยินดีต้อนรับ ${user.name}`)
    res.redirect('/board')
  } catch (err) {
    console.error('Login error:', err)
    req.flash('error', 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    res.redirect('/auth/login')
  }
})

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login')
  })
})

module.exports = router
