// src/utils/permissions.js
// สิทธิ์ของแต่ละ role — แก้ที่ไฟล์นี้ไฟล์เดียว มีผลทั้งระบบ
//
// role ในฐานข้อมูล:
//   admin          แอดมิน         ทำได้ทุกอย่าง
//   judge          กรรมการ        ลงคะแนนรุ่นของตัวเอง (users.tier)
//   staff_welfare  สตาฟสวัสดิการ   Check-in, สแกนคูปอง, ออกคูปองใบใหม่
//   staff_it       สตาฟไอที       ดูคะแนน, ควบคุมจอแสดงผล, พิมพ์ป้ายชื่อ / คูปอง / เกียรติบัตร
//   viewer         (บัญชีเก่า) ถือเป็นสตาฟสวัสดิการ

const ROLES = ["admin", "judge", "staff_welfare", "staff_it"];

const ROLE_LABEL = {
  admin: "แอดมิน",
  judge: "กรรมการ",
  staff_welfare: "สตาฟสวัสดิการ",
  staff_it: "สตาฟไอที",
};

const PERMS = {
  "teams.view": ["admin", "staff_welfare", "staff_it"],
  "teams.checkin": ["admin", "staff_welfare"],
  "teams.edit": ["admin"],

  "coupons.scan": ["admin", "staff_welfare"],
  "coupons.reissue": ["admin", "staff_welfare"],
  "coupons.print": ["admin", "staff_it"],
  "coupons.manage": ["admin"],

  "scores.enter": ["admin", "judge"],
  "scores.clear": ["admin"],

  "board.view": ["admin", "staff_it", "judge"],
  "board.allTiers": ["admin", "staff_it"],

  "screen.control": ["admin", "staff_it"],
  "survey.draw": ["admin", "staff_it"],

  "print.badges": ["admin", "staff_it"],
  "print.certs": ["admin", "staff_it"],

  "users.manage": ["admin"],
};

// หน้าแรกของแต่ละ role (ใช้ตอนไม่มีสิทธิ์ → พากลับหน้าที่เข้าได้)
const HOME = {
  admin: "/board",
  judge: "/scores",
  staff_welfare: "/teams",
  staff_it: "/board",
};

function roleOf(user) {
  const r = user && user.role;
  return r === "viewer" ? "staff_welfare" : r || null;
}

function can(user, perm) {
  const r = roleOf(user);
  return Boolean(r && PERMS[perm] && PERMS[perm].includes(r));
}

function homeFor(user) {
  return HOME[roleOf(user)] || "/auth/login";
}

function wantsJson(req) {
  return (
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json")
  );
}

// middleware: ต้องมีสิทธิ์ perm (ใช้แทน requireAdminOnly เดิมในแต่ละ route)
function requirePerm(perm) {
  return function (req, res, next) {
    const user = req.session && req.session.user;
    if (can(user, perm)) return next();

    if (!user) {
      if (wantsJson(req))
        return res.status(401).json({ ok: false, error: "กรุณาเข้าสู่ระบบ" });
      return res.redirect("/auth/login");
    }
    if (wantsJson(req))
      return res
        .status(403)
        .json({ ok: false, error: "ไม่มีสิทธิ์ใช้งานส่วนนี้" });
    if (typeof req.flash === "function")
      req.flash("error", "บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้");
    const home = homeFor(user);
    // กันวนซ้ำ: ถ้าหน้าแรกของ role เองก็เข้าไม่ได้ → ออกจากระบบ
    return res.redirect(
      req.originalUrl.split("?")[0] === home ? "/auth/logout" : home,
    );
  };
}

module.exports = {
  ROLES,
  ROLE_LABEL,
  PERMS,
  roleOf,
  can,
  homeFor,
  requirePerm,
};
