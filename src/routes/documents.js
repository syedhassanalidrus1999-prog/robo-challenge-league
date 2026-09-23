const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { query } = require("../config/database"); // ปรับตามจริง
const { requireAdmin } = require("../middleware/auth"); // ปรับตามจริง
const https = require("https");

const router = express.Router();
const MAX_MB = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype !== "application/pdf") return cb(new Error("ONLY_PDF"));
    cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single("file")(req, res, function (err) {
    if (err) {
      var msg = "อัปโหลดไม่สำเร็จ";
      if (err.code === "LIMIT_FILE_SIZE") msg = "ไฟล์ใหญ่เกิน " + MAX_MB + "MB";
      if (err.message === "ONLY_PDF") msg = "รองรับเฉพาะไฟล์ PDF";
      return res.redirect("/board/documents?err=" + encodeURIComponent(msg));
    }
    next();
  });
}

function uploadPdf(buffer, docKey) {
  return new Promise(function (resolve, reject) {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "rcl/docs",
        public_id: docKey + "_" + Date.now() + ".pdf", // raw ต้องใส่นามสกุลเอง
      },
      function (err, result) {
        if (err) reject(err);
        else resolve(result);
      },
    );
    stream.end(buffer);
  });
}

async function destroyOld(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
  } catch (e) {
    console.error("Cloudinary destroy failed:", e.message);
  }
}

async function getDoc(key) {
  const r = await query(
    "SELECT * FROM competition_documents WHERE doc_key = $1",
    [key],
  );
  return r.rows[0];
}

// ---------- หน้าจัดการ ----------
router.get('/board/documents', requireAdmin, async function (req, res) {
  try {
    const r = await query('SELECT * FROM competition_documents ORDER BY sort_order', []);

    var docs = r.rows.map(function (d) {
      var size = d.file_size || 0;
      d.sizeText = !size ? '' : (size < 1048576
        ? Math.round(size / 1024) + ' KB'
        : (size / 1048576).toFixed(2) + ' MB');
      d.dateText = d.updated_at
        ? new Date(d.updated_at).toLocaleString('th-TH', {
            dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
          })
        : '';
      return d;
    });

    return res.render('board/documents', {
      // ไม่ใส่ layout → ใช้ layout default แบบเดียวกับ /board/settings
      title: 'จัดการเอกสาร',
      sections: [
        { label: 'เอกสารทั่วไป', docs: docs.filter(function (d) { return d.section === 'general'; }) },
        { label: 'กติกาการแข่งขัน (แยกรุ่น)', docs: docs.filter(function (d) { return d.section === 'rules'; }) }
      ],
      ok: req.query.ok || null,
      err: req.query.err || null,
      maxMb: MAX_MB
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error');
  }
});

// ---------- อัปโหลด / เปลี่ยนไฟล์ ----------
router.post(
  "/board/documents/:key/upload",
  requireAdmin,
  handleUpload,
  async function (req, res) {
    try {
      const doc = await getDoc(req.params.key);
      if (!doc)
        return res.redirect(
          "/board/documents?err=" + encodeURIComponent("ไม่พบรายการเอกสาร"),
        );
      if (!req.file)
        return res.redirect(
          "/board/documents?err=" + encodeURIComponent("กรุณาเลือกไฟล์"),
        );

      // เช็ก magic bytes กันไฟล์ปลอม mimetype
      if (req.file.buffer.slice(0, 4).toString() !== "%PDF") {
        return res.redirect(
          "/board/documents?err=" + encodeURIComponent("ไฟล์ไม่ใช่ PDF จริง"),
        );
      }

      const result = await uploadPdf(req.file.buffer, doc.doc_key);
      const originalName = Buffer.from(
        req.file.originalname,
        "latin1",
      ).toString("utf8"); // ชื่อไฟล์ภาษาไทย

      await query(
        `UPDATE competition_documents
         SET file_url = $1, public_id = $2, original_name = $3, file_size = $4, updated_at = NOW()
       WHERE doc_key = $5`,
        [
          result.secure_url,
          result.public_id,
          originalName,
          req.file.size,
          doc.doc_key,
        ],
      );

      await destroyOld(doc.public_id);
      return res.redirect(
        "/board/documents?ok=" +
          encodeURIComponent('อัปโหลด "' + doc.title + '" แล้ว'),
      );
    } catch (e) {
      console.error(e);
      var msg = "อัปโหลดไม่สำเร็จ";
      if (
        e &&
        e.http_code === 400 &&
        /File size too large/i.test(e.message || "")
      ) {
        msg = "ไฟล์ใหญ่เกิน " + MAX_MB + "MB กรุณาบีบอัด PDF ก่อนอัปโหลด";
      }
      return res.redirect("/board/documents?err=" + encodeURIComponent(msg));
    }
  },
);

// ---------- แก้ชื่อ / คำอธิบาย ----------
router.post(
  "/board/documents/:key/meta",
  requireAdmin,
  async function (req, res) {
    try {
      const title = (req.body.title || "").trim();
      if (!title)
        return res.redirect(
          "/board/documents?err=" + encodeURIComponent("ชื่อเอกสารห้ามว่าง"),
        );
      await     query(
        "UPDATE competition_documents SET title = $1, description = $2, updated_at = NOW() WHERE doc_key = $3",
        [title, (req.body.description || "").trim(), req.params.key],
      );
      return res.redirect(
        "/board/documents?ok=" + encodeURIComponent("บันทึกแล้ว"),
      );
    } catch (e) {
      console.error(e);
      return res.redirect(
        "/board/documents?err=" + encodeURIComponent("บันทึกไม่สำเร็จ"),
      );
    }
  },
);

// ---------- ลบไฟล์ ----------
router.post(
  "/board/documents/:key/delete",
  requireAdmin,
  async function (req, res) {
    try {
      const doc = await getDoc(req.params.key);
      if (!doc) return res.redirect("/board/documents");
      await     query(
        `UPDATE competition_documents
         SET file_url = NULL, public_id = NULL, original_name = NULL, file_size = NULL, updated_at = NOW()
       WHERE doc_key = $1`,
        [doc.doc_key],
      );
      await destroyOld(doc.public_id);
      return res.redirect(
        "/board/documents?ok=" + encodeURIComponent("ลบไฟล์แล้ว"),
      );
    } catch (e) {
      console.error(e);
      return res.redirect(
        "/board/documents?err=" + encodeURIComponent("ลบไม่สำเร็จ"),
      );
    }
  },
);

// ---------- ส่งไฟล์ให้หน้าเว็บ พร้อมตั้งชื่อไฟล์ ----------
router.get('/docs/file/:key', async function (req, res) {
  try {
    const doc = await getDoc(req.params.key);
    if (!doc || !doc.file_url) return res.status(404).send('ไม่พบเอกสาร');

    var filename = (doc.title || doc.doc_key)
      .replace(/[\\/:*?"<>|]/g, '')
      .trim() + '.pdf';

    https.get(doc.file_url, function (upstream) {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        return res.status(502).send('ไม่สามารถโหลดไฟล์ได้ กรุณาลองใหม่');
      }
      res.setHeader('Content-Type', 'application/pdf');
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }
      // inline = เปิดดูในเบราว์เซอร์, filename* = รองรับชื่อภาษาไทย
      res.setHeader(
        'Content-Disposition',
        'inline; filename="document.pdf"; filename*=UTF-8\'\'' + encodeURIComponent(filename)
      );
      res.setHeader('Cache-Control', 'public, max-age=300');
      upstream.pipe(res);
    }).on('error', function (e) {
      console.error(e);
      if (!res.headersSent) res.status(502).send('ไม่สามารถโหลดไฟล์ได้ กรุณาลองใหม่');
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).send('Server error');
  }
});

module.exports = router;
