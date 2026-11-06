// public/js/timer-display.js — หน้าแสดงผลบนโปรเจกเตอร์
(function () {
  var T = window.RCLTimer;
  var body = document.body;
  var el = {
    start: document.getElementById("tdStart"),
    startBtn: document.getElementById("tdStartBtn"),
    clock: document.getElementById("tdClock"),
    label: document.getElementById("tdLabel"),
    time: document.getElementById("tdTime"),
    bar: document.getElementById("tdBar"),
    sub: document.getElementById("tdSub"),
    next: document.getElementById("tdNext"),
    msg: document.getElementById("tdMsg"),
    over: document.getElementById("tdOver"),
    overLabel: document.getElementById("tdOverLabel"),
    net: document.getElementById("tdNet"),
    count: document.getElementById("tdCount"),
    countLabel: document.getElementById("tdCountLabel"),
    countNum: document.getElementById("tdCountNum"),
    banner: document.getElementById("tdBanner"),
    bannerText: document.getElementById("tdBannerText"),
    bannerSub: document.getElementById("tdBannerSub"),
    bannerTimer: document.getElementById("tdBannerTimer"),
  };

  var WARN_SEC = 300; // เหลือ 5 นาที → สีเหลือง
  var DANGER_SEC = 60; // เหลือ 1 นาที → สีแดง

  // ---------------- เสียง ----------------
  var audio = null;

  function tone(freq, start, dur, vol) {
    if (!audio) return;
    var o = audio.createOscillator();
    var g = audio.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, audio.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, audio.currentTime + start + 0.02);
    g.gain.linearRampToValueAtTime(0, audio.currentTime + start + dur);
    o.connect(g);
    g.connect(audio.destination);
    o.start(audio.currentTime + start);
    o.stop(audio.currentTime + start + dur + 0.05);
  }

  var sounds = {
    start: function () {
      tone(880, 0, 0.18, 0.4);
      tone(1320, 0.2, 0.3, 0.4);
    },
    warn: function () {
      tone(988, 0, 0.25, 0.45);
      tone(988, 0.35, 0.25, 0.45);
    },
    danger: function () {
      tone(1175, 0, 0.2, 0.5);
      tone(1175, 0.3, 0.2, 0.5);
      tone(1175, 0.6, 0.2, 0.5);
    },
    tick: function () {
      tone(1400, 0, 0.08, 0.3);
    },
    count: function () {
      tone(784, 0, 0.12, 0.45);
    },
    go: function () {
      tone(1046, 0, 0.5, 0.55);
      tone(1568, 0, 0.5, 0.3);
    },
    end: function () {
      for (var i = 0; i < 4; i++) tone(660, i * 0.55, 0.45, 0.6);
    },
  };

  function enable() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) {}
    var root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(function () {});
    }
    el.start.hidden = true;
  }

  el.startBtn.addEventListener("click", enable);
  // ดับเบิลคลิกจอ = เข้า/ออกเต็มจอ
  document.addEventListener("dblclick", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else enable();
  });

  // ---------------- สถานะ ----------------
  var sync = new T.TimerSync(onState, onNet);
  var lastSec = null;
  var lastPhase = null;
  var lastCount = null;

  function onNet(ok) {
    el.net.className = "td-net " + (ok ? "ok" : "bad");
  }

  function onState(s) {
    el.label.textContent = s.label || "";
    el.countLabel.textContent = s.label || "";

    if (s.banner) {
      el.bannerText.textContent = s.banner;
      el.bannerSub.textContent = s.bannerSub || "";
      el.banner.hidden = false;
    } else {
      el.banner.hidden = true;
    }
    el.overLabel.textContent = s.label || "";
    el.next.textContent = s.next ? "ถัดไป: " + s.next : "";

    if (s.message) {
      el.msg.textContent = s.message;
      el.msg.hidden = false;
    } else {
      el.msg.hidden = true;
    }
  }

  function render() {
    var now = new Date(sync.now());
    el.clock.textContent =
      ("0" + now.getHours()).slice(-2) +
      ":" +
      ("0" + now.getMinutes()).slice(-2);

    var s = sync.state;
    if (!s) return;

    var phase = sync.phase();
    var ms = sync.remaining();
    var sec = Math.ceil(ms / 1000);

    el.time.textContent = T.formatMs(ms);
    var pct = s.durationMs
      ? Math.max(0, Math.min(100, (ms / s.durationMs) * 100))
      : 0;
    el.bar.style.width = (phase === "idle" ? 0 : pct) + "%";

    var cls = "tdisp state-" + phase;
    if (phase === "running" || phase === "paused") {
      if (sec <= DANGER_SEC) cls += " is-danger";
      else if (sec <= WARN_SEC) cls += " is-warn";
    }
    if (body.className !== cls) body.className = cls;

    el.sub.textContent = phase === "paused" ? "หยุดพักชั่วคราว" : "";
    el.over.hidden = phase !== "finished" || !!s.banner;

    // นับถอยหลังก่อนเริ่ม
    var cdSec = Math.ceil(sync.countdownRemaining() / 1000);
    el.count.hidden = phase !== "countdown" || !!s.banner;
    if (phase === "countdown") {
      el.countNum.textContent = String(cdSec);
      if (lastCount !== null && cdSec < lastCount && cdSec <= 10)
        sounds.count();
    }
    lastCount = phase === "countdown" ? cdSec : null;

    // ประกาศเต็มจอ: แสดงเวลาที่เหลือตัวเล็กด้านล่าง ถ้ากำลังจับเวลา
    if (
      s.banner &&
      (phase === "running" || phase === "paused" || phase === "countdown")
    ) {
      el.bannerTimer.textContent =
        (s.label ? s.label + " · " : "") +
        (phase === "countdown"
          ? "เริ่มใน " + cdSec + " วินาที"
          : T.formatMs(ms));
      el.bannerTimer.hidden = false;
    } else {
      el.bannerTimer.hidden = true;
    }

    // เริ่มเดินจริง (หลังนับถอยหลัง หรือกดเริ่มทันที)
    if (
      phase === "running" &&
      lastPhase !== null &&
      lastPhase !== "running" &&
      lastPhase !== "paused"
    ) {
      if (lastPhase === "countdown") sounds.go();
      else sounds.start();
    }

    // เสียงเตือนเมื่อข้ามจุดเวลา (เฉพาะตอนที่จอเห็นการเปลี่ยนจริง ไม่ดังตอนเพิ่งเปิดหน้า)
    if (
      phase === "running" &&
      lastPhase === "running" &&
      lastSec !== null &&
      sec < lastSec
    ) {
      if (lastSec > WARN_SEC && sec <= WARN_SEC) sounds.warn();
      else if (lastSec > DANGER_SEC && sec <= DANGER_SEC) sounds.danger();
      else if (sec <= 5 && sec >= 1) sounds.tick();
    }
    if (phase === "finished" && lastPhase === "running") sounds.end();

    lastSec = sec;
    lastPhase = phase;
  }

  sync.start();
  setInterval(render, 200);
})();
