// public/js/score-form-mobile.js — หน้าลงคะแนน: ปุ่ม − / + และแถบคะแนนรวม + บันทึก ด้านล่างจอ
(function () {
  var form = document.getElementById("scoreForm");
  if (!form) return;

  // ---------- ปุ่ม − / + ข้างช่องจำนวนชิ้น ----------
  function clamp(input, v) {
    var min = input.min !== "" ? parseFloat(input.min) : 0;
    var max = input.max !== "" ? parseFloat(input.max) : Infinity;
    if (isNaN(min)) min = 0;
    if (isNaN(max)) max = Infinity;
    return Math.max(min, Math.min(max, v));
  }

  function refresh(input, minus, plus) {
    var v = parseFloat(input.value) || 0;
    minus.disabled = v <= clamp(input, -Infinity);
    plus.disabled = v >= clamp(input, Infinity);
  }

  var inputs = form.querySelectorAll(".score-num-input");
  for (var i = 0; i < inputs.length; i++) {
    (function (input) {
      if (input.parentNode.classList.contains("sf-step")) return;
      input.setAttribute("inputmode", "numeric");

      var wrap = document.createElement("div");
      wrap.className = "sf-step";
      var minus = document.createElement("button");
      minus.type = "button";
      minus.className = "sf-btn minus";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "ลด");
      var plus = document.createElement("button");
      plus.type = "button";
      plus.className = "sf-btn plus";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "เพิ่ม");

      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(minus);
      wrap.appendChild(input);
      wrap.appendChild(plus);

      function bump(d) {
        var v = clamp(input, (parseFloat(input.value) || 0) + d);
        input.value = String(v);
        // ให้ตัวคำนวณคะแนนเดิมทำงานเหมือนพิมพ์เอง
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        refresh(input, minus, plus);
      }

      minus.addEventListener("click", function () {
        bump(-1);
      });
      plus.addEventListener("click", function () {
        bump(1);
      });
      input.addEventListener("input", function () {
        refresh(input, minus, plus);
      });
      input.addEventListener("focus", function () {
        input.select();
      });
      refresh(input, minus, plus);
    })(inputs[i]);
  }

  // ---------- ย่อรูปสนามก่อนส่ง (รูปมือถือ 3–8 MB → ~0.5 MB อัปโหลดเร็วขึ้นมาก) ----------
  var MAX_SIDE = 1600;
  var photoInput = form.querySelector('input[type="file"][name="photo"]');
  var shrinking = false;

  function note(text, ok) {
    if (!photoInput) return;
    var el = document.getElementById("sfPhotoNote");
    if (!el) {
      el = document.createElement("div");
      el.id = "sfPhotoNote";
      el.className = "sf-photo-note";
      photoInput.parentNode.insertBefore(el, photoInput.nextSibling);
    }
    el.textContent = text;
    el.style.color = ok ? "#16A34A" : "#64748B";
  }

  function mb(n) {
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  if (photoInput && window.DataTransfer && window.FileReader) {
    photoInput.addEventListener("change", function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file || !/^image\//.test(file.type)) return;
      if (file.size < 700 * 1024) {
        note("รูป " + Math.round(file.size / 1024) + " KB", true);
        return;
      }

      shrinking = true;
      note("กำลังย่อรูป…", false);
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(
          function (blob) {
            shrinking = false;
            if (!blob || blob.size >= file.size) {
              note("รูป " + mb(file.size), true);
              return;
            }
            try {
              var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
              var small = new File([blob], name, { type: "image/jpeg" });
              var dt = new DataTransfer();
              dt.items.add(small);
              photoInput.files = dt.files;
              note(
                "ย่อรูปแล้ว " +
                  mb(file.size) +
                  " → " +
                  Math.round(blob.size / 1024) +
                  " KB",
                true,
              );
            } catch (e) {
              note(
                "รูป " + mb(file.size) + " (ย่อไม่ได้ อาจอัปโหลดช้า)",
                false,
              );
            }
          },
          "image/jpeg",
          0.82,
        );
      };
      img.onerror = function () {
        shrinking = false;
        URL.revokeObjectURL(url);
        note("รูป " + mb(file.size), false);
      };
      img.src = url;
    });
  }

  // ---------- ล็อกปุ่มบันทึกหลังกด (กันกดซ้ำ ระหว่างรออัปโหลด) ----------
  var submitting = false;
  form.addEventListener("submit", function (e) {
    if (e.defaultPrevented) return; // ตรวจเวลาไม่ผ่าน (โค้ดเดิม)
    if (shrinking) {
      e.preventDefault();
      alert("กำลังย่อรูปอยู่ รอสักครู่แล้วกดบันทึกอีกครั้ง");
      return;
    }
    if (submitting) {
      e.preventDefault();
      return;
    }
    submitting = true;
    var btns = document.querySelectorAll(
      '#scoreForm button[type="submit"], .sf-save',
    );
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = true;
      btns[i].setAttribute("data-label", btns[i].innerHTML);
      btns[i].innerHTML = "กำลังบันทึก… อย่าปิดหน้านี้";
    }
  });
  // กดย้อนกลับมาหน้านี้ (bfcache) → ปลดล็อก
  window.addEventListener("pageshow", function () {
    submitting = false;
    var btns = document.querySelectorAll(
      '#scoreForm button[type="submit"], .sf-save',
    );
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-label"))
        btns[i].innerHTML = btns[i].getAttribute("data-label");
      btns[i].disabled = false;
    }
  });

  // ---------- แถบด้านล่าง: คะแนนรวม + ปุ่มบันทึก ----------
  var totalEl = document.getElementById("totalScore");
  var origBtn =
    form.querySelector('button[type="submit"].btn-primary') ||
    form.querySelector('button[type="submit"]');
  if (!totalEl || !origBtn) return;

  var maxText = "";
  var maxNode = totalEl.nextElementSibling;
  if (maxNode) {
    var m = maxNode.textContent.match(/(\d+(?:\.\d+)?)/);
    if (m) maxText = m[1];
  }

  var bar = document.createElement("div");
  bar.className = "sf-bar";
  bar.innerHTML =
    '<div class="sf-total"><small>คะแนนรวม</small><b><em id="sfTotal" style="font-style:normal">0.0</em>' +
    (maxText ? "<span> / " + maxText + "</span>" : "") +
    "</b></div>" +
    '<button type="button" class="sf-save"></button>';
  document.body.appendChild(bar);
  document.body.classList.add("sf-has-bar");

  var save = bar.querySelector(".sf-save");
  save.innerHTML = origBtn.innerHTML;
  // กดปุ่มในแถบ = กดปุ่มบันทึกเดิม (ใช้การตรวจสอบ / เตรียมลายเซ็นชุดเดียวกัน)
  save.addEventListener("click", function () {
    if (!origBtn.disabled) origBtn.click();
  });

  var sfTotal = document.getElementById("sfTotal");
  function syncTotal() {
    sfTotal.textContent = totalEl.textContent.trim();
  }
  syncTotal();
  if (window.MutationObserver) {
    new MutationObserver(syncTotal).observe(totalEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  } else {
    setInterval(syncTotal, 300);
  }
})();
