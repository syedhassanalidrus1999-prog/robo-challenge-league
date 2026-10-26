// src/middleware/viewer.js
// ตำแหน่ง Viewer (ผู้ดูข้อมูล): ดูได้แค่หน้าจัดการทีม + หน้าสรุปผลคะแนน
// และห้ามเพิ่ม / แก้ / ลบ ทุกอย่าง
//
// ใช้ใน app.js หลัง session + flash:  app.use(viewerGuard);
// ตรวจที่ server ทุกคำขอ → ซ่อนปุ่มอย่างเดียวไม่พอ (ส่ง POST ตรง ๆ ได้)

// หน้าหลังบ้านทั้งหมด (หน้าสาธารณะ เช่น /, /certificate, /docs ไม่เกี่ยว)
const ADMIN_PREFIXES = ["/board", "/teams", "/scores", "/documents"];

// หน้าที่ Viewer เปิดได้ (GET เท่านั้น)
const VIEWER_ALLOWED = [
  /^\/board\/?$/, //            สรุปผลคะแนน
  /^\/board\/export\/?$/, //     ดาวน์โหลด Excel
  /^\/teams\/?$/, //            จัดการทีม (รายการ)
  /^\/teams\/(export|pdf|print)(\/.*)?$/, // Export PDF (ปรับให้ตรง path จริง)
];

// path ที่ Viewer ส่งแบบ POST ได้ (ออกจากระบบ / เข้าสู่ระบบใหม่)
const VIEWER_POST_ALLOWED = [/^\/auth\//];

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

function deny(req, res, message) {
  if (wantsJson(req)) {
    return res.status(403).json({ error: message });
  }
  if (typeof req.flash === "function") req.flash("error", message);
  return res.redirect("/board");
}

function viewerGuard(req, res, next) {
  const user = req.session && req.session.user;
  const role = user ? user.role : null;

  // ใช้ใน view: <% if (!isViewer) { %> ปุ่มแก้ไข / ลบ <% } %>
  res.locals.isViewer = role === "viewer";
  res.locals.isAdmin = role === "admin";
  res.locals.userRole = role;

  if (role !== "viewer") return next();

  const method = req.method.toUpperCase();
  const path = req.path;

  // ---------------- ห้ามเขียนข้อมูล ----------------
  if (method !== "GET" && method !== "HEAD") {
    if (VIEWER_POST_ALLOWED.some((re) => re.test(path))) return next();
    return deny(
      req,
      res,
      "บัญชีผู้ดูข้อมูลไม่สามารถเพิ่ม แก้ไข หรือลบข้อมูลได้",
    );
  }

  // ---------------- จำกัดหน้าหลังบ้าน ----------------
  const isAdminArea = ADMIN_PREFIXES.some((p) => isUnder(path, p));
  if (!isAdminArea) return next();

  if (VIEWER_ALLOWED.some((re) => re.test(path))) return next();

  return deny(
    req,
    res,
    "บัญชีผู้ดูข้อมูลเข้าได้เฉพาะหน้าจัดการทีมและสรุปผลคะแนน",
  );
}

module.exports = { viewerGuard };
