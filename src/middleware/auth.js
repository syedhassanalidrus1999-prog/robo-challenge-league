// requireLogin — ทุก route ที่ต้อง login ก่อน
function requireLogin(req, res, next) {
  if (req.session.user) return next()
  req.flash('error', 'กรุณาเข้าสู่ระบบก่อน')
  res.redirect('/auth/login')
}

// requireAdmin — เฉพาะ admin เท่านั้น
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next()
  req.flash('error', 'ไม่มีสิทธิ์เข้าถึงหน้านี้')
  res.redirect('/dashboard')
}

// requireJudge — admin หรือ judge ก็ได้ (แต่ judge เห็นเฉพาะรุ่นตัวเอง)
function requireJudge(req, res, next) {
  const user = req.session.user
  if (!user) {
    req.flash('error', 'กรุณาเข้าสู่ระบบก่อน')
    return res.redirect('/auth/login')
  }
  if (user.role === 'admin' || user.role === 'judge') return next()
  req.flash('error', 'ไม่มีสิทธิ์เข้าถึงหน้านี้')
  res.redirect('/auth/login')
}

// requireTierAccess — judge เข้าได้เฉพาะรุ่นตัวเอง, admin เข้าได้ทุกรุ่น
function requireTierAccess(req, res, next) {
  const user = req.session.user
  if (!user) return res.redirect('/auth/login')
  if (user.role === 'admin') return next()

  const requestedTier = req.params.tier || req.query.tier || req.body.tier
  if (requestedTier && user.tier !== requestedTier) {
    req.flash('error', `คุณเป็นกรรมการรุ่น ${user.tier} เท่านั้น`)
    return res.redirect('/scores')
  }
  next()
}

module.exports = { requireLogin, requireAdmin, requireJudge, requireTierAccess }
