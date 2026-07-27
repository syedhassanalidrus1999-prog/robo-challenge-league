require('dotenv').config()
const bcrypt = require('bcryptjs')
const { query } = require('./database')

async function seed() {
  console.log('🌱 Seeding users...')

  const users = [
    { username: 'admin',   password: 'admin1234',  role: 'admin', tier: null,           name: 'Administrator' },
    { username: 'judge_b', password: 'judge1234',  role: 'judge', tier: 'beginner',     name: 'กรรมการ Beginner' },
    { username: 'judge_i', password: 'judge1234',  role: 'judge', tier: 'intermediate', name: 'กรรมการ Intermediate' },
    { username: 'judge_a', password: 'judge1234',  role: 'judge', tier: 'advance',      name: 'กรรมการ Advance' },
  ]

  try {
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10)
      await query(`
        INSERT INTO users (username, password_hash, role, tier, name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (username) DO NOTHING
      `, [u.username, hash, u.role, u.tier, u.name])
      console.log(`  ✅ ${u.username} (${u.role}${u.tier ? ' · ' + u.tier : ''})`)
    }

    console.log('\n✅ Seed complete!')
    console.log('\n📋 Login credentials:')
    console.log('   admin    / admin1234')
    console.log('   judge_b  / judge1234  (Beginner)')
    console.log('   judge_i  / judge1234  (Intermediate)')
    console.log('   judge_a  / judge1234  (Advance)')
    process.exit(0)
  } catch (err) {
    console.error('❌ Seed failed:', err.message)
    process.exit(1)
  }
}

seed()
