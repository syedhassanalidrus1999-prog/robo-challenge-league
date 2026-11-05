// public/js/admin-mobile.js — เปิด/ปิด sidebar บนมือถือ (โหลดจาก partials/topbar.ejs)
(function () {
  var btn = document.getElementById("mnavBtn");
  var overlay = document.getElementById("mnavOverlay");
  var sidebar = document.querySelector(".sidebar");
  if (!btn || !sidebar) return;

  function setOpen(open) {
    document.body.classList.toggle("mnav-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "ปิดเมนู" : "เปิดเมนู");
  }

  btn.addEventListener("click", function () {
    setOpen(!document.body.classList.contains("mnav-open"));
  });

  if (overlay) {
    overlay.addEventListener("click", function () {
      setOpen(false);
    });
  }

  // กดเมนูแล้วปิด sidebar
  sidebar.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 900) setOpen(false);
  });
})();
