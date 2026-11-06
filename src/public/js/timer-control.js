// public/js/timer-control.js — หน้าควบคุมนาฬิกา (มือถือเจ้าหน้าที่)
(function () {
  var T = window.RCLTimer;
  var body = document.body;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var statusEl = $("tcStatus");
  var busy = false;

  var sync = new T.TimerSync(function (s) {
    $("tcLabel").textContent = s.label || "ยังไม่ได้เริ่ม";
    $("tcBannerOn").hidden = !s.banner;
    $("tcBannerNow").textContent = s.banner
      ? s.banner + (s.bannerSub ? " — " + s.bannerSub : "")
      : "";
    if (
      document.activeElement !== $("tcNext") &&
      s.next !== undefined &&
      !$("tcNext").dataset.touched
    ) {
      $("tcNext").value = s.next || "";
    }
  });

  function show(text, ok) {
    statusEl.textContent = text;
    statusEl.className = "tc-status " + (ok ? "ok" : "bad");
    clearTimeout(show.t);
    show.t = setTimeout(function () {
      statusEl.className = "tc-status";
    }, 3500);
  }

  function send(params, okText) {
    if (busy) return Promise.resolve();
    busy = true;
    return T.postAction(params)
      .then(function (res) {
        if (res && res.ok) {
          if (res.state) sync.apply(res.state, Date.now(), Date.now());
          show(okText || "เรียบร้อย", true);
        } else {
          show((res && res.error) || "ไม่สำเร็จ", false);
        }
        return res;
      })
      .catch(function () {
        show("เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต", false);
      })
      .then(function (res) {
        busy = false;
        return res;
      });
  }

  function render() {
    var phase = sync.phase();
    var ms = sync.remaining();
    $("tcTime").textContent = sync.state ? T.formatMs(ms) : "--:--";
    $("tcSub").textContent =
      phase === "countdown"
        ? "นับถอยหลังก่อนเริ่ม: " +
          Math.ceil(sync.countdownRemaining() / 1000) +
          " วินาที"
        : phase === "paused"
          ? "หยุดพักอยู่"
          : phase === "finished"
            ? "หมดเวลาแล้ว"
            : phase === "running"
              ? "กำลังจับเวลา"
              : "รอเริ่ม";
    var cls = "tctl state-" + phase;
    var sec = Math.ceil(ms / 1000);
    if (phase === "running" && sec <= 60) cls += " is-danger";
    else if (phase === "running" && sec <= 300) cls += " is-warn";
    if (body.className !== cls) body.className = cls;

    $("tcPause").disabled = phase !== "running" && phase !== "countdown";
    $("tcResume").disabled = phase !== "paused";
  }

  function countdownSec() {
    var c = document.querySelector('input[name="tcCd"]:checked');
    return c ? c.value : "0";
  }

  function startTimer(label, minutes) {
    var phase = sync.phase();
    if (
      (phase === "running" || phase === "paused" || phase === "countdown") &&
      !window.confirm(
        'กำลังจับเวลา "' +
          (sync.state.label || "") +
          '" อยู่ ต้องการเริ่มใหม่เป็น "' +
          label +
          '" ใช่ไหม?',
      )
    ) {
      return;
    }
    var cd = countdownSec();
    send(
      { action: "start", label: label, minutes: minutes, countdown: cd },
      "เริ่ม " +
        label +
        " (" +
        minutes +
        " นาที)" +
        (cd !== "0" ? " · นับถอยหลัง " + cd + " วิ" : ""),
    );
  }

  document.querySelectorAll(".tc-preset").forEach(function (b) {
    b.addEventListener("click", function () {
      startTimer(b.getAttribute("data-label"), b.getAttribute("data-minutes"));
    });
  });

  $("tcCustomStart").addEventListener("click", function () {
    var label = $("tcCustomLabel").value.trim() || "จับเวลา";
    var min = parseFloat($("tcCustomMin").value);
    if (!(min > 0)) {
      show("กรุณาใส่จำนวนนาที", false);
      return;
    }
    startTimer(label, min);
  });

  $("tcPause").addEventListener("click", function () {
    send({ action: "pause" }, "พักแล้ว");
  });
  $("tcResume").addEventListener("click", function () {
    send({ action: "resume" }, "เดินต่อแล้ว");
  });

  document.querySelectorAll("[data-add]").forEach(function (b) {
    b.addEventListener("click", function () {
      var s = parseInt(b.getAttribute("data-add"), 10);
      send(
        { action: "add", seconds: s },
        (s > 0 ? "เพิ่ม " : "ลด ") + Math.abs(s) + " วินาที",
      );
    });
  });

  $("tcReset").addEventListener("click", function () {
    if (!window.confirm("หยุดจับเวลาและล้างจอ?")) return;
    send({ action: "reset" }, "รีเซ็ตแล้ว");
  });

  document.querySelectorAll("[data-banner]").forEach(function (b) {
    b.addEventListener("click", function () {
      send(
        {
          action: "banner",
          text: b.getAttribute("data-banner"),
          sub: $("tcBannerSub").value,
        },
        "แสดงประกาศแล้ว",
      );
    });
  });
  $("tcBannerSend").addEventListener("click", function () {
    send(
      {
        action: "banner",
        text: $("tcBannerText").value,
        sub: $("tcBannerSub").value,
      },
      "แสดงประกาศแล้ว",
    );
  });
  $("tcBannerClear").addEventListener("click", function () {
    send({ action: "bannerClear" }, "ปิดประกาศแล้ว");
  });

  $("tcMsgSend").addEventListener("click", function () {
    send({ action: "message", text: $("tcMsg").value }, "แสดงข้อความแล้ว");
  });
  $("tcMsgClear").addEventListener("click", function () {
    $("tcMsg").value = "";
    send({ action: "message", text: "" }, "ลบข้อความแล้ว");
  });

  $("tcNext").addEventListener("input", function () {
    $("tcNext").dataset.touched = "1";
  });
  $("tcNextSave").addEventListener("click", function () {
    send({ action: "next", text: $("tcNext").value }, "บันทึกแล้ว").then(
      function () {
        delete $("tcNext").dataset.touched;
      },
    );
  });

  $("tcPresetSave").addEventListener("click", function () {
    send(
      { action: "presets", text: $("tcPresetText").value },
      "บันทึกปุ่มแล้ว",
    ).then(function (res) {
      if (res && res.ok)
        setTimeout(function () {
          window.location.reload();
        }, 600);
    });
  });

  sync.start();
  setInterval(render, 250);
})();
