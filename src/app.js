require('dotenv').config()
const express = require('express')
const expressLayouts = require('express-ejs-layouts')
const session = require('express-session')
const flash = require('connect-flash')
const methodOverride = require('method-override')
const path = require('path')

const app = express()

// ── View engine ──────────────────────────────
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(expressLayouts)
app.set('layout', 'layouts/main')

// ── Static files ─────────────────────────────
app.use(express.static(path.join(__dirname, 'public')))

// ── Body parser ──────────────────────────────
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

// ── Method override (PUT/DELETE from forms) ──
app.use(methodOverride('_method'))

// ── Session ──────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    ccookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

// ── Flash messages ───────────────────────────
app.use(flash())

// ── Global locals (ใช้ใน EJS ได้ทุกหน้า) ───
app.use((req, res, next) => {
  res.locals.user = req.session.user || null
  res.locals.success = req.flash('success')
  res.locals.error = req.flash('error')
  res.locals.currentPath = req.path
  next()
})

// ── Routes ───────────────────────────────────
app.use('/', require('./routes/public'))
app.use('/auth', require('./routes/auth'))
app.use('/teams', require('./routes/teams'))
app.use('/scores', require('./routes/scores'))
app.use('/board', require('./routes/board'))

// ── 404 ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { layout: 'layouts/public', title: 'ไม่พบหน้านี้' })
})

// ── Error handler ────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).render('500', { layout: 'layouts/public', title: 'เกิดข้อผิดพลาด' })
})

// ── Start ────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🤖 Robo Challenge League running on http://localhost:${PORT}`)
})

module.exports = app
