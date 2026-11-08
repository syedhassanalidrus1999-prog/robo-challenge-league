// src/routes/judges.js
// มอบหมายทีมให้กรรมการ (Admin)
// - ทีมแต่ละทีมมีกรรมการผู้ดูแล 1 คน (teams.judge_id)
// - กรรมการเห็น "ทีมที่ดูแล" ก่อนในหน้าลงคะแนน
//
// app.js (ก่อน app.use("/board", ...)):
//   app.use("/board/judges", require("./routes/judges"));
//
// คอลัมน์ teams.judge_id สร้างให้อัตโนมัติ

const express = require("express");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

async function ensureColumn() {
  await query(
    "ALTER TABLE teams ADD COLUMN IF NOT EXISTS judge_id INTEGER",
    [],
  );
  console.log("[judges] คอลัมน์ teams.judge_id พร้อมใช้งาน");
}
const columnReady = ensureColumn().catch((err) => {
  console.error("[judges] สร้างคอลัมน์ไม่สำเร็จ:", err.message);
});

function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  if (typeof req.flash === "function")
    req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

router.use(requireLogin, requireAdminOnly);

function safeTier(v) {
  return TIERS.includes(v) ? v : "beginner";
}

function displayName(u) {
  return u.name || u.username || "กรรมการ #" + u.id;
}

async function getJudges(tier) {
  const r = await query(
    "SELECT * FROM users WHERE role = 'judge' AND tier = $1 ORDER BY id ASC",
    [tier],
  );
  return r.rows.map((u) => ({
    id: u.id,
    name: displayName(u),
    username: u.username,
  }));
}

async function getTeams(tier) {
  const r = await query(
    `SELECT id, name, institution, judge_id, status
     FROM teams
     WHERE tier = $1 AND status IS DISTINCT FROM 'rejected'
     ORDER BY created_at ASC`,
    [tier],
  );
  return r.rows;
}

// ---------------- GET /board/judges ----------------

router.get("/", async (req, res) => {
  const tier = safeTier(req.query.tier);
  try {
    await columnReady;
    const [judges, teams] = await Promise.all([
      getJudges(tier),
      getTeams(tier),
    ]);

    const judgeIds = new Set(judges.map((j) => j.id));
    const counts = {};
    judges.forEach((j) => {
      counts[j.id] = 0;
    });
    let unassigned = 0;
    teams.forEach((t) => {
      if (t.judge_id && judgeIds.has(t.judge_id)) counts[t.judge_id]++;
      else unassigned++;
    });

    return res.render("board/judges", {
      title: "มอบหมายกรรมการ",
      pageTitle: "<span>มอบหมาย</span>กรรมการ",
      tierSelector: true,
      activeTier: tier,
      tier,
      tierLabel: TIER_LABEL[tier],
      judges,
      teams,
      counts,
      unassigned,
    });
  } catch (err) {
    console.error("Judges page error:", err);
    req.flash("error", "โหลดข้อมูลไม่สำเร็จ");
    return res.redirect("/board");
  }
});

// ---------------- POST /board/judges/assign ----------------
// body: judge_<teamId> = judgeId | ""

router.post("/assign", async (req, res) => {
  const tier = safeTier(req.query.tier);
  try {
    await columnReady;
    const [judges, teams] = await Promise.all([
      getJudges(tier),
      getTeams(tier),
    ]);
    const valid = new Set(judges.map((j) => String(j.id)));

    let changed = 0;
    for (const t of teams) {
      const raw = req.body["judge_" + t.id];
      if (raw === undefined) continue;
      const v = String(Array.isArray(raw) ? raw[0] : raw);
      const next = valid.has(v) ? parseInt(v, 10) : null;
      if ((t.judge_id || null) !== next) {
        await query("UPDATE teams SET judge_id = $2 WHERE id = $1", [
          t.id,
          next,
        ]);
        changed++;
      }
    }

    req.flash(
      "success",
      changed
        ? "บันทึกการมอบหมายแล้ว (" + changed + " ทีม)"
        : "ไม่มีการเปลี่ยนแปลง",
    );
  } catch (err) {
    console.error("Judges assign error:", err);
    req.flash("error", "บันทึกไม่สำเร็จ");
  }
  return res.redirect("/board/judges?tier=" + tier);
});

// ---------------- POST /board/judges/auto ----------------
// mode=unassigned : แบ่งเฉพาะทีมที่ยังไม่มีกรรมการ ให้คนที่ดูแลน้อยที่สุดก่อน
// mode=all        : แบ่งใหม่ทั้งหมด วนตามลำดับทีม (ทีม 1 → กรรมการ A, ทีม 2 → B, ...)

router.post("/auto", async (req, res) => {
  const tier = safeTier(req.query.tier);
  const mode = req.body.mode === "all" ? "all" : "unassigned";
  try {
    await columnReady;
    const [judges, teams] = await Promise.all([
      getJudges(tier),
      getTeams(tier),
    ]);
    if (!judges.length) {
      req.flash("error", "ยังไม่มีบัญชีกรรมการรุ่น " + TIER_LABEL[tier]);
      return res.redirect("/board/judges?tier=" + tier);
    }

    const ids = judges.map((j) => j.id);
    const valid = new Set(ids);
    let changed = 0;

    if (mode === "all") {
      for (let i = 0; i < teams.length; i++) {
        const next = ids[i % ids.length];
        if (teams[i].judge_id !== next) {
          await query("UPDATE teams SET judge_id = $2 WHERE id = $1", [
            teams[i].id,
            next,
          ]);
          changed++;
        }
      }
    } else {
      const load = {};
      ids.forEach((id) => {
        load[id] = 0;
      });
      teams.forEach((t) => {
        if (valid.has(t.judge_id)) load[t.judge_id]++;
      });

      for (const t of teams) {
        if (valid.has(t.judge_id)) continue;
        const next = ids.slice().sort((a, b) => load[a] - load[b] || a - b)[0];
        await query("UPDATE teams SET judge_id = $2 WHERE id = $1", [
          t.id,
          next,
        ]);
        load[next]++;
        changed++;
      }
    }

    req.flash(
      "success",
      changed
        ? "แบ่งทีมให้กรรมการแล้ว (" + changed + " ทีม)"
        : "ทุกทีมมีกรรมการดูแลแล้ว",
    );
  } catch (err) {
    console.error("Judges auto error:", err);
    req.flash("error", "แบ่งทีมไม่สำเร็จ");
  }
  return res.redirect("/board/judges?tier=" + tier);
});

module.exports = router;
