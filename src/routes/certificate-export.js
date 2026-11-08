// src/routes/certificate-export.js
// ดาวน์โหลดเกียรติบัตรจากหลังบ้าน (Admin) — รวมเป็น PDF ไฟล์เดียว หน้าละ 1 ใบ
// ใช้ Template / ตำแหน่งชื่อ / ฟอนต์ ชุดเดียวกับหน้าดาวน์โหลดสาธารณะ (routes/certificate.js)
//
// ต้องเพิ่ม 1 บรรทัดท้ายไฟล์ src/routes/certificate.js (ต่อจาก module.exports = router;):
//   module.exports.helpers = { getStudentList, hasAnyStudentCheckedIn, getCoachName, getMaxScore, getBestScore, getRanking, getMedalType, getMedalLabel, loadBackground, getCanvasSize, createCertificateSvg, getFontProblems, FONT_FILES, FONT_FAMILY };
//
// app.js (ก่อน app.use("/board", ...)):
//   app.use("/board/cert-export", require("./routes/certificate-export"));

const express = require("express");
const PDFDocument = require("pdfkit");
const { Resvg } = require("@resvg/resvg-js");
const { query } = require("../config/database");
const { requireLogin } = require("../middleware/auth");
const certificate = require("./certificate");

const H = certificate.helpers;
const router = express.Router();

const TIERS = ["beginner", "intermediate", "advance"];
const TIER_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advance: "Advance",
};

const TYPES = [
  { key: "participation", label: "เกียรติบัตรเข้าร่วม (นักเรียน)" },
  { key: "coach", label: "เกียรติบัตรโค้ช" },
  { key: "rank_1", label: "ชนะเลิศ (อันดับ 1)" },
  { key: "rank_2", label: "รองชนะเลิศ อันดับ 1 (อันดับ 2)" },
  { key: "rank_3", label: "รองชนะเลิศ อันดับ 2 (อันดับ 3)" },
  { key: "gold", label: "เหรียญทอง" },
  { key: "silver", label: "เหรียญเงิน" },
  { key: "bronze", label: "เหรียญทองแดง" },
];
const TYPE_KEYS = TYPES.map((t) => t.key);

// ความละเอียดของภาพในไฟล์ (ด้านยาว px) — 300dpi ใหญ่มาก ใช้เมื่อส่งร้านพิมพ์
const QUALITY = { print: 3508, normal: 2339, light: 1754 }; // 300 / 200 / 150 dpi

function requireAdminOnly(req, res, next) {
  const user = req.session && req.session.user;
  if (user && user.role === "admin") return next();
  if (typeof req.flash === "function")
    req.flash("error", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return res.redirect("/board");
}

router.use(requireLogin, requireAdminOnly);

function cleanText(v, max) {
  return String(Array.isArray(v) ? v[0] : (v ?? ""))
    .trim()
    .slice(0, max);
}

// resvg (ตัวสร้างภาพเกียรติบัตร) วางสระอำ U+0E33 ผิด → ตัวถัดไปทับสระอา
// แยกเป็น นิคหิต + สระอา ก่อนสร้างภาพ (วรรณยุกต์ย้ายไปไว้ระหว่างกลาง เช่น น้ำ ค้ำ ช่ำ)
// ข้อมูลในฐานข้อมูลไม่ต้องแก้ ใช้เฉพาะตอนสร้างภาพ
function thaiForSvg(s) {
  return String(s == null ? "" : s).replace(
    /([\u0E48-\u0E4B]?)\u0E33/g,
    "\u0E4D$1\u0E32",
  );
}

function normalizeName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ");
}

// ============================================================================
// รายชื่อผู้ได้รับเกียรติบัตร ตามประเภท
// ============================================================================
//
// includeAll = false → ใช้เงื่อนไขเดียวกับหน้าสาธารณะ (ต้อง Check-in)
// includeAll = true  → รวมคนที่ยังไม่ Check-in (เช่น พิมพ์ล่วงหน้า)

async function buildList(tier, type, opts) {
  const teamId = opts.teamId || "";
  const includeAll = Boolean(opts.includeAll);

  const teamsResult = teamId
    ? await query("SELECT * FROM teams WHERE id = $1", [teamId])
    : await query(
        "SELECT * FROM teams WHERE tier = $1 AND status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
        [tier],
      );
  const teams = teamsResult.rows;
  if (!teams.length) return [];

  const teamTier = teams[0].tier;
  const [ranking, maxScore] = await Promise.all([
    H.getRanking(teamTier),
    H.getMaxScore(teamTier),
  ]);
  const rankMap = new Map(ranking.map((t) => [String(t.id), t]));

  const list = [];
  const seenCoach = new Set();

  for (const team of teams) {
    const r = rankMap.get(String(team.id)) || {};
    const best = parseFloat(r.best_score || 0);
    const rank = r.rank || null;
    const medal = H.getMedalType(best, maxScore);
    const base = {
      team,
      rank,
      medalLabel: H.getMedalLabel(medal),
      score: best,
      maxScore,
    };

    if (type === "coach") {
      const coach = H.getCoachName(team);
      if (!coach) continue;
      if (!includeAll && !H.hasAnyStudentCheckedIn(team)) continue;
      const key = normalizeName(coach).toLowerCase();
      if (seenCoach.has(key)) continue; // โค้ชดูแลหลายทีม → ใบเดียว
      seenCoach.add(key);
      list.push(Object.assign({}, base, { name: coach, role: "โค้ช" }));
      continue;
    }

    // ประเภทอันดับ / เหรียญ: เช็กว่าทีมนี้มีสิทธิ์
    if (type === "rank_1" && rank !== 1) continue;
    if (type === "rank_2" && rank !== 2) continue;
    if (type === "rank_3" && rank !== 3) continue;
    if (["gold", "silver", "bronze"].includes(type) && medal !== type) continue;

    for (const s of H.getStudentList(team)) {
      if (!includeAll && !s.checkedIn) continue;
      list.push(
        Object.assign({}, base, {
          name: s.name,
          role: "นักเรียนคนที่ " + s.number,
        }),
      );
    }
  }

  return list;
}

async function getTemplate(tier, type) {
  const r = await query(
    "SELECT * FROM certificate_templates WHERE tier = $1 AND cert_type = $2 LIMIT 1",
    [tier, type],
  );
  return r.rows[0] || null;
}

function renderPng(svg, zoom) {
  const problems = H.getFontProblems();
  if (problems.length)
    throw new Error("CERTIFICATE_FONT_MISSING " + problems.join(" | "));

  // ย่อขนาดภาพตามคุณภาพที่เลือก (ตำแหน่ง / ขนาดชื่อคงสัดส่วนเดิม)
  return new Resvg(svg, {
    fitTo: zoom < 1 ? { mode: "zoom", value: zoom } : { mode: "original" },
    font: {
      fontFiles: H.FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: H.FONT_FAMILY,
    },
  })
    .render()
    .asPng();
}

// ============================================================================
// GET /board/cert-export  (หน้าเลือก)
// ============================================================================

router.get("/", async (req, res) => {
  const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";
  try {
    const [teamsResult, templatesResult] = await Promise.all([
      query(
        "SELECT id, name FROM teams WHERE tier = $1 AND status IS DISTINCT FROM 'rejected' ORDER BY created_at ASC",
        [tier],
      ),
      query(
        "SELECT cert_type, background_url FROM certificate_templates WHERE tier = $1",
        [tier],
      ),
    ]);

    const hasTemplate = {};
    templatesResult.rows.forEach((t) => {
      hasTemplate[t.cert_type] = Boolean(t.background_url);
    });

    // จำนวนใบของแต่ละประเภท (ตามเงื่อนไข Check-in / รวมทั้งหมด)
    const counts = {};
    for (const t of TYPES) {
      const [checked, all] = await Promise.all([
        buildList(tier, t.key, { includeAll: false }),
        buildList(tier, t.key, { includeAll: true }),
      ]);
      counts[t.key] = { checked: checked.length, all: all.length };
    }

    return res.render("board/cert-export", {
      title: "ดาวน์โหลดเกียรติบัตร",
      pageTitle: "<span>ดาวน์โหลด</span>เกียรติบัตร",
      tierSelector: true,
      activeTier: tier,
      tier,
      tierLabel: TIER_LABEL[tier],
      types: TYPES,
      teams: teamsResult.rows,
      counts,
      hasTemplate,
    });
  } catch (err) {
    console.error("Cert export page error:", err);
    req.flash("error", "โหลดข้อมูลไม่สำเร็จ");
    return res.redirect("/board/certificates?tier=" + tier);
  }
});

// ============================================================================
// GET /board/cert-export/pdf?tier=&type=&team=&all=1&quality=normal
// ============================================================================

router.get("/pdf", async (req, res) => {
  const tier = TIERS.includes(req.query.tier) ? req.query.tier : "beginner";
  const type = TYPE_KEYS.includes(req.query.type)
    ? req.query.type
    : "participation";
  const teamId = cleanText(req.query.team, 20);
  const includeAll = req.query.all === "1";
  const longSide = QUALITY[req.query.quality] || QUALITY.normal;
  const back = "/board/cert-export?tier=" + tier;

  try {
    const list = await buildList(tier, type, { teamId, includeAll });
    if (!list.length) {
      req.flash(
        "error",
        "ไม่มีผู้ได้รับเกียรติบัตรประเภทนี้" +
          (includeAll ? "" : ' (ลองติ๊ก "รวมคนที่ยังไม่ Check-in")'),
      );
      return res.redirect(back);
    }

    const realTier = list[0].team.tier;
    const template = await getTemplate(realTier, type);
    if (!template || !template.background_url) {
      req.flash(
        "error",
        "ยังไม่มี Template (Background) ของเกียรติบัตรประเภทนี้ ในรุ่น " +
          TIER_LABEL[realTier],
      );
      return res.redirect(back);
    }

    const background = await H.loadBackground(template.background_url);
    const canvas = H.getCanvasSize(background);
    const zoom = Math.min(1, longSide / Math.max(canvas.width, canvas.height));

    const date = new Date().toISOString().slice(0, 10);
    const label = teamId ? teamId : TIER_LABEL[realTier];
    const filename = `RCL_certificate_${label}_${type}_${date}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    // ส่งทีละหน้า (stream) → ไฟล์ใหญ่ก็ไม่ค้าง
    const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      info: { Title: "RCL Certificates" },
    });
    doc.pipe(res);

    for (const item of list) {
      // ข้อความทุกตัวที่อาจไปอยู่บนเกียรติบัตร ผ่าน thaiForSvg ก่อน
      const teamForSvg = Object.assign({}, item.team, {
        name: thaiForSvg(item.team.name),
        institution: thaiForSvg(item.team.institution),
        coach: thaiForSvg(item.team.coach),
      });
      const svg = H.createCertificateSvg({
        background,
        canvas,
        template,
        name: thaiForSvg(item.name),
        team: teamForSvg,
        type,
        rank: item.rank,
        medalLabel: thaiForSvg(item.medalLabel),
        score: item.score,
        maxScore: item.maxScore,
      });
      const png = renderPng(svg, zoom);

      doc.addPage({
        size: "A4",
        layout: canvas.isPortrait ? "portrait" : "landscape",
        margin: 0,
      });
      doc.image(png, 0, 0, {
        fit: [doc.page.width, doc.page.height],
        align: "center",
        valign: "center",
      });

      // ปล่อยให้ event loop ทำงาน ระหว่างสร้างหลายใบ
      await new Promise((r) => setImmediate(r));
    }

    doc.end();
    console.log(
      "[cert-export]",
      list.length,
      "ใบ",
      realTier,
      type,
      teamId || "ทั้งรุ่น",
      "โดย",
      req.session.user.username,
    );
  } catch (err) {
    console.error("Cert export error:", err);
    if (!res.headersSent) {
      req.flash(
        "error",
        String(err.message).startsWith("CERTIFICATE_FONT_MISSING")
          ? "สร้างไม่ได้: ไม่พบไฟล์ฟอนต์"
          : "สร้างเกียรติบัตรไม่สำเร็จ",
      );
      return res.redirect(back);
    }
    res.end();
  }
});

module.exports = router;
