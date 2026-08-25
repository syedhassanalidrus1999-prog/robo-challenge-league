const cloudinary = require("cloudinary").v2;
// ไม่ต้อง config อะไร CLOUDINARY_URL จะถูกอ่านอัตโนมัติ
console.log("☁️ Cloudinary cloud_name:", cloudinary.config().cloud_name);
module.exports = cloudinary;
