// utils/time.js
// แปลงเวลาระหว่าง "วินาที" (เก็บใน DB เป็น NUMERIC(8,3))
// กับรูปแบบที่แสดงผล "นาที.วินาที.มิลลิวินาที" เช่น 1.23.456

// วินาที (45.12 / "83.456") → "1.23.456"
function formatTime(value) {
  if (value === null || value === undefined || value === "") return "";
  var n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";

  var totalMs = Math.round(n * 1000);
  var minutes = Math.floor(totalMs / 60000);
  var seconds = Math.floor((totalMs % 60000) / 1000);
  var ms = totalMs % 1000;

  return (
    minutes +
    "." +
    String(seconds).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  );
}

// รับค่า นาที / วินาที / มิลลิวินาที แยกกัน → วินาที (ทศนิยม 3 ตำแหน่ง)
// คืน null ถ้าว่างทั้งหมด, คืน NaN ถ้าข้อมูลไม่ถูกต้อง
function partsToSeconds(min, sec, ms) {
  var m = String(min ?? "").trim();
  var s = String(sec ?? "").trim();
  var x = String(ms ?? "").trim();

  if (m === "" && s === "" && x === "") return null;

  var mi = m === "" ? 0 : Number(m);
  var si = s === "" ? 0 : Number(s);
  var xi = x === "" ? 0 : Number(x);

  if (
    !Number.isInteger(mi) ||
    mi < 0 ||
    !Number.isInteger(si) ||
    si < 0 ||
    si > 59 ||
    !Number.isInteger(xi) ||
    xi < 0 ||
    xi > 999
  ) {
    return NaN;
  }

  return Math.round((mi * 60 + si + xi / 1000) * 1000) / 1000;
}

// แยกวินาทีกลับเป็นส่วน ๆ เพื่อเติมค่าเดิมในฟอร์มตอนแก้ไข
function secondsToParts(value) {
  if (value === null || value === undefined || value === "") {
    return { min: "", sec: "", ms: "" };
  }
  var totalMs = Math.round(Number(value) * 1000);
  if (!Number.isFinite(totalMs)) return { min: "", sec: "", ms: "" };

  return {
    min: Math.floor(totalMs / 60000),
    sec: Math.floor((totalMs % 60000) / 1000),
    ms: totalMs % 1000,
  };
}

module.exports = { formatTime, partsToSeconds, secondsToParts };