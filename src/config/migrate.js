require('dotenv').config()
const { query } = require('./database')

async function migrate() {
  console.log('🔄 Running migrations...')

  try {
    // ── ENUM types ──────────────────────────────
    await query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'judge');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await query(`
      DO $$ BEGIN
        CREATE TYPE tier_type AS ENUM ('beginner', 'intermediate', 'advance');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await query(`
      DO $$ BEGIN
        CREATE TYPE team_status AS ENUM ('pending', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    // ── Table: users ────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        username     VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role         user_role NOT NULL DEFAULT 'judge',
        tier         tier_type,
        name         VARCHAR(100) NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `)
    console.log('  ✅ users table')

    // ── Table: teams ────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS teams (
        id          VARCHAR(20) PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        institution VARCHAR(150),
        tier        tier_type NOT NULL,
        student_1   VARCHAR(100),
        student_2   VARCHAR(100),
        student_3   VARCHAR(100),
        coach       VARCHAR(100),
        status      team_status NOT NULL DEFAULT 'pending',
        note        TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `)
    console.log('  ✅ teams table')

    // ── Table: scores ───────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS scores (
        id            SERIAL PRIMARY KEY,
        team_id       VARCHAR(20) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        judge_id      INT REFERENCES users(id),
        round         INT NOT NULL CHECK (round IN (1, 2)),
        mission_1     NUMERIC(5,2) DEFAULT 0,
        mission_2     NUMERIC(5,2) DEFAULT 0,
        mission_3     NUMERIC(5,2) DEFAULT 0,
        mission_4     NUMERIC(5,2) DEFAULT 0,
        mission_5     NUMERIC(5,2) DEFAULT 0,
        total_score   NUMERIC(6,2) GENERATED ALWAYS AS
                        (mission_1 + mission_2 + mission_3 + mission_4 + mission_5) STORED,
        time_seconds  NUMERIC(8,2),
        photo_url     VARCHAR(500),
        signature_url VARCHAR(500),
        scored_at     TIMESTAMP DEFAULT NOW(),
        UNIQUE (team_id, round)
      );
    `)
    console.log('  ✅ scores table')

    // ── Table: criteria (mission config per tier) ─
    await query(`
      CREATE TABLE IF NOT EXISTS criteria (
        id        SERIAL PRIMARY KEY,
        tier      tier_type NOT NULL,
        mission   INT NOT NULL CHECK (mission BETWEEN 1 AND 5),
        name      VARCHAR(100) NOT NULL,
        max_score NUMERIC(5,2) NOT NULL,
        UNIQUE (tier, mission)
      );
    `)
    console.log('  ✅ criteria table')

    // ── Seed default criteria ──────────────────
    await query(`
      INSERT INTO criteria (tier, mission, name, max_score) VALUES
        ('beginner',     1, 'ภารกิจที่ 1', 10),
        ('beginner',     2, 'ภารกิจที่ 2', 10),
        ('beginner',     3, 'ภารกิจที่ 3', 15),
        ('beginner',     4, 'ภารกิจที่ 4', 15),
        ('intermediate', 1, 'ภารกิจที่ 1', 15),
        ('intermediate', 2, 'ภารกิจที่ 2', 20),
        ('intermediate', 3, 'ภารกิจที่ 3', 15),
        ('intermediate', 4, 'ภารกิจที่ 4', 25),
        ('intermediate', 5, 'ภารกิจที่ 5', 25),
        ('advance',      1, 'ภารกิจที่ 1', 20),
        ('advance',      2, 'ภารกิจที่ 2', 20),
        ('advance',      3, 'ภารกิจที่ 3', 20),
        ('advance',      4, 'ภารกิจที่ 4', 20),
        ('advance',      5, 'ภารกิจที่ 5', 20)
      ON CONFLICT (tier, mission) DO NOTHING;
    `)
    console.log('  ✅ default criteria seeded')

    // ── Index ──────────────────────────────────
    await query(`CREATE INDEX IF NOT EXISTS idx_teams_tier ON teams(tier);`)
    await query(`CREATE INDEX IF NOT EXISTS idx_scores_team ON scores(team_id);`)
    console.log('  ✅ indexes created')

    console.log('\n✅ Migration complete!')
    process.exit(0)
  } catch (err) {
    console.error('❌ Migration failed:', err.message)
    process.exit(1)
  }
}

migrate()
