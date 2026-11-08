// src/routes/users.js
// จัดการผู้ใช้ (Admin): เพิ่ม / แก้ role, รุ่น, ชื่อ / รีเซ็ตรหัสผ่าน / ปิดใช้งาน / ลบ
//
// app.js (ก่อน app.use("/board", ...)):
//   app.use("/board/users", require("./routes/users"));
//
// ตอนเริ่มทำงาน ระบบจะ:
//   - เพิ่มค่า staff_welfare / staff_it ใน enum user_role (ถ้าคอลัมน์ role เป็น enum)
//   - เพิ่มคอลัมน์ users.is_active
//   - เปลี่ยนบัญชี viewer เดิม → staff_welfare

const express = require("express");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const { ROLES, ROLE_LABEL, requirePerm } = require("../utils/permissions");
const { clearUserCache } = require("../middleware/viewer");

let bcrypt;
try {
  bcrypt = require("bcrypt");
} catch (e) {
  bcrypt = require("bcryptjs");
}

const router = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

// ============================================================================
// เตรียมตาราง
// ============================================================================

let PASSWORD_COL = "password";
let HAS_NAME = true;

async function prepare() {
  const cols = await query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_name = 'users'`,
    [],
  );
  const byName = {};
  cols.rows.forEach((c) => {
    byName[c.column_name] = c;
  });

  PASSWORD_COL = byName.password_hash ? "password_hash" : "password";
  HAS_NAME = Boolean(byName.name);

  // role เป็น enum → เพิ่มค่าใหม่ (ADD VALUE ต้องรันแยกทีละคำสั่ง)
  const roleCol = byName.role;
  if (roleCol && roleCol.data_type === "USER-DEFINED") {
    for (const v of ["staff_welfare", "staff_it"]) {
      await query(
        `ALTER TYPE ${roleCol.udt_name} ADD VALUE IF NOT EXISTS '${v}'`,
        [],
      );
    }
  }

  // role เป็นข้อความที่มี CHECK constraint → สร้าง constraint ใหม่ที่รวม role ใหม่
  if (roleCol && roleCol.data_type !== "USER-DEFINED") {
    const checks = await query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND contype = 'c'`,
      [],
    );
    for (const c of checks.rows) {
      if (/\brole\b/i.test(c.def) && !/staff_it/.test(c.def)) {
        await query(`ALTER TABLE users DROP CONSTRAINT "${c.conname}"`, []);
        await query(
          `ALTER TABLE users ADD CONSTRAINT users_role_check
           CHECK (role IN ('admin', 'judge', 'viewer', 'staff_welfare', 'staff_it'))`,
          [],
        );
        console.log("[users] ปรับ CHECK constraint ของ role แล้ว");
      }
    }
  }

  if (!byName.is_active) {
    await query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
      [],
    );
  }
  if (!HAS_NAME) {
    await query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(100)",
      [],
    );
    HAS_NAME = true;
  }

  const moved = await query(
    "UPDATE users SET role = 'staff_welfare' WHERE role = 'viewer' RETURNING id",
    [],
  );
  if (moved.rows.length)
    console.log(
      "[users] เปลี่ยนบัญชี viewer → staff_welfare:",
      moved.rows.length,
      "บัญชี",
    );

  console.log(
    "[users] ตาราง users พร้อมใช้งาน (รหัสผ่านเก็บที่คอลัมน์ " +
      PASSWORD_COL +
      ")",
  );
}

const ready = prepare().catch((err) => {
  console.error("[users] เตรียมตารางไม่สำเร็จ:", err.message);
});

router.use(requireLogin, requirePerm("users.manage"));

// ============================================================================
// HELPERS
// ============================================================================

function cleanText(v, max) {
  return String(Array.isArray(v) ? v[0] : (v ?? ""))
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function cleanUsername(v) {
  return String(Array.isArray(v) ? v[0] : (v ?? ""))
    .trim()
    .toLowerCase();
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function readForm(body) {
  const role = ROLES.includes(body.role) ? body.role : null;
  const tier = role === "judge" && TIERS.includes(body.tier) ? body.tier : null;
  return {
    name: cleanText(body.name, 100),
    username: cleanUsername(body.username),
    password: String(
      Array.isArray(body.password) ? body.password[0] : body.password || "",
    ),
    role,
    tier,
  };
}

async function adminCount(exceptId) {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active IS DISTINCT FROM FALSE AND id <> $1",
    [exceptId || 0],
  );
  return r.rows[0].n;
}

function back(res) {
  return res.redirect("/board/users");
}

// ============================================================================
// GET /board/users
// ============================================================================

router.get("/", async (req, res) => {
  try {
    await ready;
    const [usersResult, teamCount] = await Promise.all([
      query("SELECT * FROM users ORDER BY id ASC", []),
      query(
        "SELECT judge_id, COUNT(*)::int AS n FROM teams WHERE judge_id IS NOT NULL GROUP BY judge_id",
        [],
      ).catch(() => ({ rows: [] })),
    ]);

    const teamsByJudge = {};
    teamCount.rows.forEach((r) => {
      teamsByJudge[r.judge_id] = r.n;
    });

    const users = usersResult.rows.map((u) => ({
      id: u.id,
      name: u.name || "",
      username: u.username,
      role: u.role === "viewer" ? "staff_welfare" : u.role,
      tier: u.tier || "",
      active: u.is_active !== false,
      teams: teamsByJudge[u.id] || 0,
      isMe: String(u.id) === String(req.session.user.id),
    }));

    const groups = ROLES.map((r) => ({
      role: r,
      label: ROLE_LABEL[r],
      users: users.filter((u) => u.role === r),
    }));

    return res.render("board/users", {
      title: "จัดการผู้ใช้",
      pageTitle: "<span>จัดการ</span>ผู้ใช้",
      tierSelector: false,
      groups,
      roles: ROLES,
      roleLabel: ROLE_LABEL,
      tiers: TIERS,
      tierLabel: TIER_LABEL,
    });
  } catch (err) {
    console.error("Users page error:", err);
    req.flash("error", "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
    return res.redirect("/board");
  }
});

// ============================================================================
// POST /board/users  (เพิ่มผู้ใช้)
// ============================================================================

router.post("/", async (req, res) => {
  try {
    await ready;
    const f = readForm(req.body);

    if (!f.name) {
      req.flash("error", "กรุณาใส่ชื่อที่แสดง");
      return back(res);
    }
    if (!USERNAME_RE.test(f.username)) {
      req.flash("error", "Username ใช้ a–z, 0–9, จุด, ขีด ความยาว 3–30 ตัว");
      return back(res);
    }
    if (f.password.length < 6) {
      req.flash("error", "รหัสผ่านอย่างน้อย 6 ตัว");
      return back(res);
    }
    if (!f.role) {
      req.flash("error", "กรุณาเลือกตำแหน่ง");
      return back(res);
    }
    if (f.role === "judge" && !f.tier) {
      req.flash("error", "กรรมการต้องเลือกรุ่น");
      return back(res);
    }

    const dup = await query("SELECT 1 FROM users WHERE LOWER(username) = $1", [
      f.username,
    ]);
    if (dup.rows.length) {
      req.flash("error", 'Username "' + f.username + '" มีอยู่แล้ว');
      return back(res);
    }

    const hash = await bcrypt.hash(f.password, 10);
    await query(
      `INSERT INTO users (username, name, role, tier, ${PASSWORD_COL}, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [f.username, f.name, f.role, f.tier, hash],
    );

    req.flash(
      "success",
      "เพิ่ม " +
        f.name +
        " (" +
        ROLE_LABEL[f.role] +
        ") แล้ว · username: " +
        f.username,
    );
  } catch (err) {
    console.error("User create error:", err);
    req.flash("error", "เพิ่มผู้ใช้ไม่สำเร็จ: " + err.message);
  }
  return back(res);
});

// ============================================================================
// POST /board/users/:id  (แก้ชื่อ / role / รุ่น / รหัสผ่าน)
// ============================================================================

router.post("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await ready;
    const cur = (await query("SELECT * FROM users WHERE id = $1", [id]))
      .rows[0];
    if (!cur) {
      req.flash("error", "ไม่พบผู้ใช้");
      return back(res);
    }

    const f = readForm(req.body);
    const isMe = String(id) === String(req.session.user.id);
    const curRole = cur.role === "viewer" ? "staff_welfare" : cur.role;

    if (!f.name) {
      req.flash("error", "กรุณาใส่ชื่อที่แสดง");
      return back(res);
    }
    if (!f.role) {
      req.flash("error", "กรุณาเลือกตำแหน่ง");
      return back(res);
    }
    if (f.role === "judge" && !f.tier) {
      req.flash("error", "กรรมการต้องเลือกรุ่น");
      return back(res);
    }

    if (curRole === "admin" && f.role !== "admin") {
      if (isMe) {
        req.flash(
          "error",
          "เปลี่ยนตำแหน่งของตัวเองไม่ได้ (กันล็อกตัวเองออกจากระบบ)",
        );
        return back(res);
      }
      if ((await adminCount(id)) === 0) {
        req.flash("error", "ต้องมีแอดมินอย่างน้อย 1 คน");
        return back(res);
      }
    }

    await query(
      "UPDATE users SET name = $2, role = $3, tier = $4 WHERE id = $1",
      [id, f.name, f.role, f.tier],
    );

    // กรรมการเปลี่ยนรุ่น / ไม่เป็นกรรมการแล้ว → ปลดทีมที่เคยมอบหมาย
    let released = 0;
    if (curRole === "judge" && (f.role !== "judge" || f.tier !== cur.tier)) {
      const r = await query(
        "UPDATE teams SET judge_id = NULL WHERE judge_id = $1 RETURNING id",
        [id],
      ).catch(() => ({ rows: [] }));
      released = r.rows.length;
    }

    if (f.password) {
      if (f.password.length < 6) {
        req.flash(
          "error",
          "บันทึกข้อมูลแล้ว แต่รหัสผ่านใหม่สั้นเกินไป (อย่างน้อย 6 ตัว) — ยังไม่ได้เปลี่ยนรหัสผ่าน",
        );
        clearUserCache(id);
        return back(res);
      }
      const hash = await bcrypt.hash(f.password, 10);
      await query(`UPDATE users SET ${PASSWORD_COL} = $2 WHERE id = $1`, [
        id,
        hash,
      ]);
    }

    clearUserCache(id);
    req.flash(
      "success",
      "บันทึก " +
        f.name +
        " แล้ว" +
        (f.password ? " · เปลี่ยนรหัสผ่านแล้ว" : "") +
        (released
          ? " · ปลดทีมที่เคยดูแล " +
            released +
            " ทีม (มอบหมายใหม่ได้ที่เมนูมอบหมายกรรมการ)"
          : ""),
    );
  } catch (err) {
    console.error("User update error:", err);
    req.flash("error", "บันทึกไม่สำเร็จ: " + err.message);
  }
  return back(res);
});

// ============================================================================
// POST /board/users/:id/active  (เปิด / ปิดใช้งาน)
// ============================================================================

router.post("/:id/active", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await ready;
    const cur = (await query("SELECT * FROM users WHERE id = $1", [id]))
      .rows[0];
    if (!cur) {
      req.flash("error", "ไม่พบผู้ใช้");
      return back(res);
    }

    const activate = req.body.active === "1";
    if (!activate) {
      if (String(id) === String(req.session.user.id)) {
        req.flash("error", "ปิดใช้งานบัญชีตัวเองไม่ได้");
        return back(res);
      }
      if (cur.role === "admin" && (await adminCount(id)) === 0) {
        req.flash("error", "ต้องมีแอดมินอย่างน้อย 1 คน");
        return back(res);
      }
    }

    await query("UPDATE users SET is_active = $2 WHERE id = $1", [
      id,
      activate,
    ]);
    clearUserCache(id);
    req.flash(
      "success",
      (cur.name || cur.username) +
        (activate ? " เปิดใช้งานแล้ว" : " ปิดใช้งานแล้ว (ออกจากระบบทันที)"),
    );
  } catch (err) {
    console.error("User active error:", err);
    req.flash("error", "ไม่สำเร็จ: " + err.message);
  }
  return back(res);
});

// ============================================================================
// POST /board/users/:id/delete
// ============================================================================

router.post("/:id/delete", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await ready;
    const cur = (await query("SELECT * FROM users WHERE id = $1", [id]))
      .rows[0];
    if (!cur) {
      req.flash("error", "ไม่พบผู้ใช้");
      return back(res);
    }
    if (String(id) === String(req.session.user.id)) {
      req.flash("error", "ลบบัญชีตัวเองไม่ได้");
      return back(res);
    }
    if (cur.role === "admin" && (await adminCount(id)) === 0) {
      req.flash("error", "ต้องมีแอดมินอย่างน้อย 1 คน");
      return back(res);
    }

    // กรรมการที่เคยลงคะแนนแล้ว ลบไม่ได้ (คะแนนอ้างอิงบัญชีนี้) → ให้ปิดใช้งานแทน
    const used = await query(
      "SELECT 1 FROM scores WHERE judge_id = $1 LIMIT 1",
      [id],
    ).catch(() => ({ rows: [] }));
    if (used.rows.length) {
      req.flash(
        "error",
        (cur.name || cur.username) +
          ' เคยลงคะแนนแล้ว ลบไม่ได้ — ใช้ "ปิดใช้งาน" แทน',
      );
      return back(res);
    }

    await query("UPDATE teams SET judge_id = NULL WHERE judge_id = $1", [
      id,
    ]).catch(() => {});
    await query("DELETE FROM users WHERE id = $1", [id]);
    clearUserCache(id);
    req.flash("success", "ลบ " + (cur.name || cur.username) + " แล้ว");
  } catch (err) {
    console.error("User delete error:", err);
    req.flash("error", "ลบไม่สำเร็จ: " + err.message);
  }
  return back(res);
});

module.exports = router;
