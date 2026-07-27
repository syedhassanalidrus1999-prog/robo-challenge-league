const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
})

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err)
})

// Helper: query แบบ promise
const query = (text, params) => pool.query(text, params)

// Helper: ดึง client สำหรับ transaction
const getClient = () => pool.connect()

module.exports = { pool, query, getClient }
