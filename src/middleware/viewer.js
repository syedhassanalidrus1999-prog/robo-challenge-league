// src/middleware/viewer.js
// ตรวจสิทธิ์ตาม role ทุกคำขอ (ชื่อไฟล์ / ฟังก์ชันเดิม เพื่อไม่ต้องแก้ app.js)
//
//   userSync    อ่าน role / รุ่น / ชื่อ ล่าสุดจากฐานข้อมูล → เปลี่ยน role ในหน้าจัดการผู้ใช้แล้วมีผลทันที
//               บัญชีที่ถูกปิดใช้งานหรือถูกลบ → ออกจากระบบทันที
//   viewerGuard สตาฟเข้าได้เฉพาะหน้าที่กำหนดด้านล่าง (ตรวจที่ server — ซ่อนปุ่มอย่างเดียวไม่พอ)
//
// app.js หลัง session + flash:
//   const { userSync, viewerGuard } = require("./middleware/viewer");
//   app.use(userSync);
//   app.use(viewerGuard);

const { query } = require("../config/database");
const { roleOf, can, homeFor, ROLE_LABEL } = require("../utils/permissions");

// ============================================================================
// userSync
// ============================================================================

const cache = new Map(); // id → { at, row }
const CACHE_MS = 5000;

async function loadUser(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  const r = await query("SELECT * FROM users WHERE id = $1", [id]);
  const row = r.rows[0] || null;
  cache.set(id, { at: Date.now(), row });
  return row;
}

function clearUserCache(id) {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}

async function userSync(req, res, next) {
  const user = req.session && req.session.user;
  if (!user || !user.id || req.path.startsWith("/auth/")) return next();

  try {
    const row = await loadUser(user.id);

    if (!row || row.is_active === false) {
      const msg = row ? "บัญชีนี้ถูกปิดใช้งาน" : "ไม่พบบัญชีนี้แล้ว";
      return req.session.regenerate(function () {
        if (typeof req.flash === "function")
          req.flash("error", msg + " กรุณาติดต่อผู้ดูแลระบบ");
        return res.redirect("/auth/login");
      });
    }

    user.role = row.role;
    user.tier = row.tier || null;
    if (row.name) user.name = row.name;
  } catch (err) {
    console.error("[userSync]", err.message);
  }
  return next();
}

// ============================================================================
// viewerGuard
// ============================================================================

// หน้าหลังบ้าน (นอกเหนือจากนี้คือหน้าสาธารณะ เช่น /, /certificate, /survey, /screen)
const AREAS = [
  "/board",
  "/teams",
  "/scores",
  "/documents",
  "/coupons",
  "/screen/control",
  "/screen/api",
  "/timer",
];

const COMMON_POST = [
  /^\/auth\//, //                 เข้า / ออกจากระบบ
  /^\/survey\/?$/, //             ส่งแบบประเมิน (หน้าสาธารณะ)
];

const RULES = {
  staff_welfare: {
    get: [
      /^\/teams\/?$/, //                                จัดการทีม (ดู + Check-in)
      /^\/teams\/(export|pdf|print)(\/.*)?$/,
      /^\/coupons(\/.*)?$/, //                          สแกนคูปอง + พิมพ์ใบใหม่ของทีม
      /^\/board\/coupons\/?$/, //                       ตารางคูปอง (ดูอย่างเดียว)
      /^\/board\/coupons\/export\/?$/, //                ดาวน์โหลด Excel
    ],
    post: [
      /^\/teams\/[^/]+\/checkin(\/[1-3])?\/?$/, //      Check-in
      /^\/coupons\/(redeem|reissue-team)\/?$/, //       แลกคูปอง / ออกใบใหม่
    ],
  },
  staff_it: {
    get: [
      /^\/board\/?$/, //                                สรุปผลคะแนน
      /^\/board\/export\/?$/,
      /^\/board\/announce\/?$/, //                     ใบประกาศผลสำหรับพิธีกร
      /^\/teams\/?$/, //                                ดูรายชื่อทีม
      /^\/teams\/(export|pdf|print)(\/.*)?$/,
      /^\/board\/badges(\/.*)?$/, //                    ป้ายชื่อ
      /^\/board\/cert-export(\/.*)?$/, //               ดาวน์โหลดเกียรติบัตร
      /^\/board\/coupons\/?$/, //                       คูปอง (ดู + พิมพ์)
      /^\/board\/coupons\/(print|export)\/?$/,
      /^\/board\/survey\/draw\/?$/, //                  หน้าสุ่มรางวัล
      /^\/screen\/(control|api)(\/.*)?$/, //            ควบคุมจอแสดงผล
      /^\/timer(\/.*)?$/,
    ],
    post: [
      /^\/board\/survey\/draw\/?$/, //                  สุ่มรางวัล
      /^\/board\/coupons\/generate\/?$/, //             สร้างคูปองที่ยังขาด (ก่อนพิมพ์)
    ],
  },
};

function hasMethodOverride(req) {
  const q = req.query && req.query._method;
  const b = req.body && req.body._method;
  return Boolean(q || b);
}

function isUnder(path, prefix) {
  return path === prefix || path.startsWith(prefix + "/");
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json")
  );
}

function deny(req, res, user, message) {
  if (wantsJson(req))
    return res.status(403).json({ ok: false, error: message });
  // หลัง login ระบบพาไป /board → สตาฟสวัสดิการไปหน้าแรกของตัวเองเงียบ ๆ (ไม่ขึ้นข้อความเตือน)
  const silent =
    req.method === "GET" && (req.path === "/board" || req.path === "/board/");
  if (!silent && typeof req.flash === "function") req.flash("error", message);
  const home = homeFor(user);
  return res.redirect(req.path === home ? "/auth/logout" : home);
}

function viewerGuard(req, res, next) {
  const user = req.session && req.session.user;
  const role = roleOf(user);

  // ใช้ใน view
  res.locals.userRole = role;
  res.locals.roleLabel = ROLE_LABEL[role] || "";
  res.locals.isAdmin = role === "admin";
  res.locals.isJudge = role === "judge";
  res.locals.isStaff = role === "staff_welfare" || role === "staff_it";
  res.locals.isViewer = res.locals.isStaff; // view เดิมใช้ isViewer = โหมดอ่านอย่างเดียว
  res.locals.can = function (perm) {
    return can(user, perm);
  };
  res.locals.canCheckin = can(user, "teams.checkin");

  const rules = RULES[role];
  if (!rules) return next(); // admin / judge / ยังไม่ login → ให้ route ตรวจเอง

  const method = req.method.toUpperCase();
  const path = req.path;

  if (method !== "GET" && method !== "HEAD") {
    const ok =
      method === "POST" &&
      !hasMethodOverride(req) &&
      COMMON_POST.concat(rules.post).some((re) => re.test(path));
    return ok
      ? next()
      : deny(req, res, user, "บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้");
  }

  if (!AREAS.some((p) => isUnder(path, p))) return next();
  if (rules.get.some((re) => re.test(path))) return next();

  return deny(
    req,
    res,
    user,
    "บัญชี" + (ROLE_LABEL[role] || "") + "ไม่มีสิทธิ์เข้าหน้านี้",
  );
}

module.exports = { userSync, viewerGuard, clearUserCache };
