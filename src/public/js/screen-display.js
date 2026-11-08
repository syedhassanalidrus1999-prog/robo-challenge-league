// public/js/screen-display.js — หน้าแสดงผล (จอโปรเจกเตอร์) และตัวอย่างในหน้าควบคุม (?preview=1)
(function () {
  var S = window.RCLScreen;
  var body = document.body;
  var PREVIEW = body.getAttribute("data-preview") === "1";
  var ch = S.channel();
  var $ = function (id) {
    return document.getElementById(id);
  };

  var state = null;
  var media = {}; // id → object URL
  var requested = {};

  // ======================================================================
  // เสียง
  // ======================================================================
  var audio = null;

  function tone(freq, start, dur, vol) {
    if (!audio || PREVIEW) return;
    var o = audio.createOscillator();
    var gn = audio.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    gn.gain.setValueAtTime(0, audio.currentTime + start);
    gn.gain.linearRampToValueAtTime(vol, audio.currentTime + start + 0.02);
    gn.gain.linearRampToValueAtTime(0, audio.currentTime + start + dur);
    o.connect(gn);
    gn.connect(audio.destination);
    o.start(audio.currentTime + start);
    o.stop(audio.currentTime + start + dur + 0.05);
  }

  var snd = {
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
    spin: function () {
      tone(600 + Math.random() * 500, 0, 0.04, 0.15);
    },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        tone(f, i * 0.12, 0.35, 0.45);
      });
    },
    reveal: function () {
      tone(440, 0, 0.12, 0.35);
      tone(660, 0.1, 0.25, 0.35);
    },
    champion: function () {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone(f, i * 0.14, 0.6, 0.5);
      });
    },
  };

  // ======================================================================
  // เสียงพูด AI (Web Speech API) — พูดเฉพาะจอหลัก ไม่พูดในตัวอย่าง
  // ======================================================================
  var synth = window.speechSynthesis || null;
  var voicesCache = [];

  function loadVoices() {
    if (synth) voicesCache = synth.getVoices() || [];
  }
  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  }

  function pickVoice(cfg) {
    if (!voicesCache.length) loadVoices();
    if (cfg.name) {
      var exact = voicesCache.filter(function (v) {
        return v.name === cfg.name;
      })[0];
      if (exact) return exact;
    }
    var th = voicesCache.filter(function (v) {
      return /^th/i.test(v.lang);
    });
    return (
      th.filter(function (v) {
        return /Natural|Premwadee|Niwat/i.test(v.name);
      })[0] ||
      th[0] ||
      null
    );
  }

  // ความหน่วงของเสียง (ms) = เวลาจากสั่งพูด → เริ่มได้ยินจริง
  // เสียง Online/Natural ต้องส่งไปสร้างเสียงที่ server จึงช้ากว่าเสียงในเครื่อง
  var lead = null;
  var leadVoice = null;

  function speechLead(cfg) {
    var v = pickVoice(cfg || (state && state.voice) || {});
    var name = v ? v.name : "";
    if (name !== leadVoice) {
      leadVoice = name;
      lead = /Online|Natural|Google/i.test(name) ? 650 : 200;
    }
    return lead;
  }

  function speak(text, done, opt) {
    opt = opt || {};
    var finished = false;
    function fin() {
      if (finished) return;
      finished = true;
      if (done) done();
    }
    var cfg = (state && state.voice) || {};
    if (PREVIEW || !synth || !cfg.enabled || !text) {
      fin();
      return;
    }

    var msg = String(text);
    if (cfg.particle === "ครับ")
      msg = msg.replace(/ค่ะ/g, "ครับ").replace(/คะ/g, "ครับ");

    var u = new SpeechSynthesisUtterance(msg);
    u.lang = "th-TH";
    var v = pickVoice(cfg);
    if (v) u.voice = v;
    u.rate = opt.fast ? Math.max(1.1, cfg.rate || 1) : cfg.rate || 0.95;
    var asked = Date.now();
    speechLead(cfg);
    u.onstart = function () {
      // วัดความหน่วงจริง แล้วปรับค่าเฉลี่ย (ใช้ชดเชยการนับถอยหลัง)
      var ms = Date.now() - asked;
      if (ms > 30 && ms < 2500) lead = Math.round(lead * 0.6 + ms * 0.4);
    };
    u.volume = cfg.volume === undefined ? 1 : cfg.volume;
    u.onend = fin;
    u.onerror = fin;
    // กันค้าง: ถ้าเสียงไม่ตอบ ให้ไปต่อเอง
    setTimeout(fin, Math.max(4000, msg.length * 130));
    try {
      if (opt.cancel) synth.cancel();
      synth.speak(u);
    } catch (e) {
      fin();
    }
  }

  // ======================================================================
  // เริ่มแสดงผล: เปิดเสียง + เต็มจอ (ถ้ามี 2 จอ → ส่งไปเต็มจอที่จอโปรเจกเตอร์)
  // ======================================================================
  // ต้องเรียก requestFullscreen ทันทีตอนคลิก (ถ้ารอ promise นาน เบราว์เซอร์จะไม่ยอม)
  var screenPermission = "prompt";
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions
      .query({ name: "window-management" })
      .then(function (p) {
        screenPermission = p.state;
      })
      .catch(function () {});
  }

  function plainFullscreen() {
    var root = document.documentElement;
    if (!root.requestFullscreen) return;
    root.requestFullscreen().catch(function () {
      showFsHint(true);
    });
  }

  function goFullscreen() {
    if (document.fullscreenElement) return;
    var root = document.documentElement;
    if (!root.requestFullscreen) return;

    // อนุญาต "จัดการหน้าต่าง" ไว้แล้ว → ส่งไปเต็มจอที่จอโปรเจกเตอร์ให้เอง
    if (window.getScreenDetails && screenPermission === "granted") {
      window
        .getScreenDetails()
        .then(function (d) {
          var other = d.screens.filter(function (x) {
            return x !== d.currentScreen;
          })[0];
          return root.requestFullscreen(other ? { screen: other } : undefined);
        })
        .catch(plainFullscreen);
      return;
    }

    // ยังไม่ได้อนุญาต → เต็มจอบนจอที่หน้าต่างนี้อยู่ (ลากหน้าต่างไปจอโปรเจกเตอร์ก่อนคลิก)
    plainFullscreen();
  }

  // ปุ่มเต็มจอมุมขวาบน (แสดงเมื่อยังไม่เต็มจอ)
  var fsBtn = document.getElementById("fsBtn");
  var fsHideTimer = null;

  function showFsHint(force) {
    if (PREVIEW || !fsBtn || document.fullscreenElement) return;
    fsBtn.hidden = false;
    clearTimeout(fsHideTimer);
    if (!force)
      fsHideTimer = setTimeout(function () {
        fsBtn.hidden = true;
      }, 4000);
  }

  if (!PREVIEW && fsBtn) {
    fsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      goFullscreen();
    });
    document.addEventListener("mousemove", function () {
      showFsHint(false);
    });
    document.addEventListener("fullscreenchange", function () {
      if (document.fullscreenElement) fsBtn.hidden = true;
      else showFsHint(true);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen();
        else goFullscreen();
      }
    });
  }

  if (!PREVIEW) {
    $("tdStartBtn").addEventListener("click", function () {
      try {
        audio =
          audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === "suspended") audio.resume();
      } catch (e) {}
      goFullscreen();
      $("tdStart").hidden = true;
    });
    document.addEventListener("dblclick", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else goFullscreen();
    });
  }

  // ======================================================================
  // รับข้อมูลจากหน้าควบคุม
  // ======================================================================
  ch.onmessage = function (e) {
    var m = e.data || {};
    if (m.type === "state") {
      state = m.state;
      $("scWait").hidden = true;
      apply();
    } else if (m.type === "speak") {
      if (m.cancel && synth) synth.cancel();
      speak(m.text);
    } else if (m.type === "media" && m.blob) {
      if (!media[m.id]) media[m.id] = URL.createObjectURL(m.blob);
      apply();
    }
  };

  function hello() {
    ch.postMessage({ type: "hello", preview: PREVIEW });
  }
  hello();
  var helloTimer = setInterval(function () {
    if (state) clearInterval(helloTimer);
    else hello();
  }, 1500);

  // จอหลักแจ้งหน้าควบคุมว่ายังเปิดอยู่
  if (!PREVIEW) {
    setInterval(function () {
      ch.postMessage({ type: "ping" });
    }, 2000);
  }

  function needMedia(id) {
    if (!id || media[id]) return;
    if (requested[id] && Date.now() - requested[id] < 3000) return;
    requested[id] = Date.now();
    ch.postMessage({ type: "needMedia", id: id });
  }

  // ======================================================================
  // วาดฉาก
  // ======================================================================
  var lastVideoId = null;
  var lastVideoSeq = null;
  var lastDrawSeq = null;
  var drawAnimating = false;
  var lastRevealed = null;
  var lastResultsKey = null;

  function apply() {
    if (!state) return;
    var scene = state.scene || "logo";

    // ฉากที่ไม่ได้แสดง: หยุดวิดีโอ
    var vid = $("vidEl");
    if (scene !== "video" && !vid.paused) vid.pause();

    // ประกาศ
    $("bnText").textContent = (state.banner && state.banner.text) || "";
    $("bnSub").textContent = (state.banner && state.banner.sub) || "";

    // นาฬิกา: ข้อความ
    var t = state.timer || {};
    $("tdLabel").textContent = t.label || "";
    $("tdCountLabel").textContent = t.label || "";
    $("tdOverLabel").textContent = t.label || "";
    $("tdNext").textContent = state.next ? "ถัดไป: " + state.next : "";
    if (state.message) {
      $("tdMsg").textContent = state.message;
      $("tdMsg").hidden = false;
    } else {
      $("tdMsg").hidden = true;
    }

    if (scene === "image") applyImage();
    if (scene === "video") applyVideo();
    if (scene === "draw") applyDraw();
    if (scene === "results") applyResults();

    render();
  }

  function applyImage() {
    var im = state.image || {};
    var el = $("imgEl");
    var url = media[im.id];
    if (!url) needMedia(im.id);
    $("imgMissing").hidden = !!url || !im.id;
    if (url && el.getAttribute("src") !== url) el.src = url;
    if (!url) el.removeAttribute("src");
    el.className = im.fit === "cover" ? "fit-cover" : "fit-contain";
  }

  function applyVideo() {
    var v = state.video || {};
    var el = $("vidEl");

    if (PREVIEW) {
      // ตัวอย่างไม่เล่นวิดีโอจริง (ประหยัดเครื่อง)
      el.hidden = true;
      $("vidPreview").hidden = false;
      $("vidPreview").textContent = v.name
        ? "▶ วิดีโอ: " + v.name
        : "ยังไม่ได้เลือกวิดีโอ";
      return;
    }

    var url = media[v.id];
    if (!url) needMedia(v.id);
    $("vidMissing").hidden = !!url || !v.id;
    if (!url) return;

    if (lastVideoId !== v.id) {
      lastVideoId = v.id;
      el.src = url;
      lastVideoSeq = null;
    }
    el.loop = !!v.loop;
    el.muted = !!v.muted;

    var cmd = v.cmd || {};
    if (cmd.seq !== lastVideoSeq) {
      lastVideoSeq = cmd.seq;
      if (cmd.action === "restart") {
        el.currentTime = 0;
        el.play().catch(function () {});
      } else if (cmd.action === "pause") {
        el.pause();
      } else {
        el.play().catch(function () {});
      }
    }
  }

  // ส่งสถานะวิดีโอกลับไปหน้าควบคุม
  if (!PREVIEW) {
    setInterval(function () {
      var el = $("vidEl");
      if (!state || state.scene !== "video" || !el.src) return;
      ch.postMessage({
        type: "videoStatus",
        t: el.currentTime || 0,
        d: el.duration || 0,
        paused: el.paused,
        ended: el.ended,
      });
    }, 500);
  }

  // ---------------- จับรางวัล ----------------
  function drawIdle(d) {
    $("drCode").textContent = d.winner ? d.winner.code : "RCL-????";
    $("drCode").className = "dr-code" + (d.winner ? " win" : "");
    $("drWho").innerHTML = d.winner
      ? S.esc(d.winner.maskedName) +
        "<small>" +
        S.esc(d.winner.type) +
        "</small>"
      : "";
  }

  function drawHistory(d) {
    var h = (d.history || []).slice(0, 5);
    $("drHistory").innerHTML = h.length
      ? '<div class="dr-h-title">ผู้ได้รับรางวัล</div>' +
        h
          .map(function (w) {
            return (
              '<div class="dr-h-item"><b>' +
              S.esc(w.code) +
              "</b> " +
              S.esc(w.maskedName) +
              (w.prize ? " <span>· " + S.esc(w.prize) + "</span>" : "") +
              "</div>"
            );
          })
          .join("")
      : "";
  }

  function applyDraw() {
    var d = state.draw || {};
    $("drPrize").textContent = d.prize || "";

    if (d.seq === lastDrawSeq || drawAnimating) {
      if (!drawAnimating) {
        drawIdle(d);
        drawHistory(d);
      }
      return;
    }
    lastDrawSeq = d.seq;

    // เพิ่งกดสุ่ม → หมุนรหัส (ถ้าเปิดจอหลังสุ่มไปนานแล้ว แสดงผลเลย)
    if (d.phase === "spinning" && d.winner && Date.now() - (d.at || 0) < 6000) {
      spin(d);
    } else {
      drawIdle(d);
      drawHistory(d);
    }
  }

  function spin(d) {
    drawAnimating = true;
    var codeEl = $("drCode");
    var sample = d.sample && d.sample.length ? d.sample : ["RCL-????"];
    var delays = [];
    var ms = 45;
    for (var i = 0; i < 44; i++) {
      delays.push(ms);
      if (i > 24) ms *= 1.12;
    }
    var step = 0;
    $("drWho").innerHTML = "";
    codeEl.className = "dr-code spinning";

    function tick() {
      if (step >= delays.length) {
        drawAnimating = false;
        codeEl.textContent = d.winner.code;
        codeEl.className = "dr-code win";
        $("drWho").innerHTML =
          S.esc(d.winner.maskedName) +
          "<small>" +
          S.esc(d.winner.type) +
          "</small>";
        drawHistory(d);
        snd.win();
        return;
      }
      codeEl.textContent = sample[step % sample.length];
      snd.spin();
      setTimeout(tick, delays[step]);
      step++;
    }
    tick();
  }

  // ---------------- ประกาศผล ----------------
  function teamCard(t, cls) {
    return (
      '<div class="rs-card ' +
      cls +
      '">' +
      '<div class="rs-rank">' +
      t.rank +
      "</div>" +
      '<div class="rs-info"><div class="rs-name">' +
      S.esc(t.name) +
      "</div>" +
      '<div class="rs-inst">' +
      S.esc(t.institution) +
      " · " +
      S.esc(t.id) +
      "</div></div>" +
      '<div class="rs-score"><b>' +
      S.esc(t.score) +
      "</b><span>คะแนน</span>" +
      (t.time ? "<em>" + S.esc(t.time) + "</em>" : "") +
      "</div></div>"
    );
  }

  function hiddenCard(rank, cls) {
    return (
      '<div class="rs-card rs-hidden ' +
      cls +
      '"><div class="rs-rank">' +
      rank +
      '</div><div class="rs-info"><div class="rs-name">?</div></div></div>'
    );
  }

  function applyResults() {
    var r = state.results || {};
    var teams = r.teams || [];
    var n = teams.length;
    var revealed = Math.max(0, Math.min(n, r.revealed || 0));
    var tier = r.tier || "beginner";
    var sec = $("scResults");

    $("rsTier").textContent = r.tierLabel || "";
    $("rsTier").className = "rs-tier t-" + tier;
    $("rsIntroTier").textContent = r.tierLabel || "";
    sec.setAttribute("data-tier", tier);

    // อันดับล่าสุดที่เพิ่งเปิด (เปิดจากอันดับสุดท้ายขึ้นไป)
    var newestRank = revealed ? n - revealed + 1 : null;
    var newest = newestRank ? teams[newestRank - 1] : null;

    var mode = !newest ? "intro" : newestRank >= 4 ? "spot" : "podium";
    sec.setAttribute("data-mode", mode);

    // ---------- อันดับ 10–4: ทีมเดียวเต็มจอ ----------
    if (mode === "spot") {
      $("rsSpotRank").textContent = newest.rank;
      $("rsSpotName").textContent = newest.name;
      $("rsSpotInst").textContent =
        newest.institution + (newest.institution ? " · " : "") + newest.id;
      $("rsSpotScore").innerHTML =
        "<b>" +
        S.esc(newest.score) +
        "</b> คะแนน" +
        (newest.time ? "<span>เวลา " + S.esc(newest.time) + "</span>" : "");
    }

    // ---------- อันดับ 3–1: โพเดียม ----------
    var isShown = function (t) {
      return t.rank > n - revealed;
    };
    $("rsPodium").innerHTML = [2, 1, 3]
      .map(function (rank) {
        var t = teams[rank - 1];
        if (!t)
          return '<div class="rs-slot rs-slot-' + rank + ' rs-empty"></div>';
        return (
          '<div class="rs-slot rs-slot-' +
          rank +
          '">' +
          (isShown(t)
            ? teamCard(t, "rs-podium-card")
            : hiddenCard(rank, "rs-podium-card")) +
          '<div class="rs-step">' +
          rank +
          "</div></div>"
        );
      })
      .join("");

    // ---------- เสียง + แอนิเมชันเมื่อเปิดอันดับใหม่ ----------
    var key = tier + ":" + n + ":" + (r.loadedAt || 0);
    var isNew =
      key === lastResultsKey &&
      lastRevealed !== null &&
      revealed !== lastRevealed;
    if (isNew && revealed > lastRevealed && newest) {
      if (newest.rank === 1) snd.champion();
      else snd.reveal();
    }
    if (isNew && mode === "spot") {
      var spot = $("rsSpot");
      spot.classList.remove("rs-spot-in");
      void spot.offsetWidth; // เริ่มแอนิเมชันใหม่
      spot.classList.add("rs-spot-in");
    }
    if (isNew && mode === "podium" && revealed > lastRevealed) {
      var cards = document.querySelectorAll(
        ".sc-results .rs-podium-card:not(.rs-hidden)",
      );
      for (var i = 0; i < cards.length; i++) {
        var rk = parseInt(cards[i].querySelector(".rs-rank").textContent, 10);
        if (rk === newest.rank) cards[i].classList.add("rs-pop");
      }
    }
    lastResultsKey = key;
    lastRevealed = revealed;
  }

  // ======================================================================
  // วนวาดทุก 200 ms (นาฬิกา / นับถอยหลัง / เสียงเตือน)
  // ======================================================================
  var WARN_SEC = 300;
  var DANGER_SEC = 60;
  var lastSec = null;
  var lastPhase = null;
  var lastCount = null;

  // ----------------------------------------------------------------------
  // เสียงประกาศตามนาฬิกา (จอแสดงผลเป็นคนพูด เพราะหน้าต่างนี้ไม่ถูกเบราว์เซอร์หน่วงเวลา)
  // ----------------------------------------------------------------------
  var vSeq; // undefined = ยังไม่เคยเห็นนาฬิกา (เพิ่งเปิดจอ)
  var vPhase = null;
  var vSec = null;
  var vCount = null;
  var vGo = false;

  function voiceTriggers(t, phase, sec, cdSec) {
    var v = t.voice || {};
    var seq = t.seq || 0;

    if (seq !== vSeq) {
      var firstLook = vSeq === undefined;
      vSeq = seq;
      vPhase = null;
      vSec = null;
      vCount = null;
      vGo = false;

      if (phase === "announce") {
        // หน้าควบคุมรอให้ประกาศจบ ก่อนเริ่มนับถอยหลัง
        speak(v.start, function () {
          if (!PREVIEW) ch.postMessage({ type: "announceDone", seq: seq });
        });
      } else if (!firstLook && phase === "running" && v.start) {
        speak(v.start); // เช่น เริ่มรวมหุ่นยนต์เอง (ไม่มีนับถอยหลัง)
      }
    }

    // นับถอยหลังด้วยเสียง: สิบ เก้า ... หนึ่ง
    // สั่งพูดล่วงหน้าเท่ากับความหน่วงของเสียง → ได้ยินตรงกับตัวเลขที่เปลี่ยนบนจอ
    var cfg = (state && state.voice) || {};
    var voiceCount =
      cfg.enabled && cfg.countMode !== "beep" && synth && !PREVIEW;
    if (phase === "countdown") {
      var rem = S.countdownRemaining(t, Date.now());
      var heard = voiceCount
        ? Math.ceil((rem - speechLead(cfg)) / 1000)
        : Math.ceil(rem / 1000);
      if (heard !== vCount) {
        var fresh = vCount !== null || vPhase === "announce";
        if (fresh && heard >= 1 && heard <= 10) {
          if (voiceCount)
            speak(S.thNum(heard), null, { fast: true, cancel: true });
          else if (cfg.enabled) snd.count();
        }
        if (fresh && heard <= 0 && !vGo) {
          vGo = true;
          speak(v.go, null, { cancel: true }); // เริ่มพูดก่อนเล็กน้อย → ได้ยินตอนนาฬิกาเริ่มเดินพอดี
        }
        vCount = heard;
      }
    }

    if (phase === "running" && vPhase === "countdown" && !vGo) {
      vGo = true;
      speak(v.go);
    }

    // เตือนเวลา
    if (
      phase === "running" &&
      vPhase === "running" &&
      vSec !== null &&
      sec < vSec
    ) {
      (v.warns || []).forEach(function (w) {
        if (vSec > w.sec && sec <= w.sec) speak(w.text);
      });
    }

    // หมดเวลา → พูด + แจ้งหน้าควบคุม (ต่อขั้นถัดไปอัตโนมัติ)
    if (phase === "finished" && vPhase === "running") {
      speak(v.end);
      if (!PREVIEW) ch.postMessage({ type: "timerEnded", seq: seq });
    }

    vPhase = phase;
    vSec = sec;
  }

  function render() {
    var now = Date.now();
    var d = new Date(now);
    $("tdClock").textContent =
      ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);

    if (!state) return;

    var scene = state.scene || "logo";
    var t = state.timer || { status: "idle" };
    var phase = S.timerPhase(t, now);
    var ms = S.timerRemaining(t, now);
    var sec = Math.ceil(ms / 1000);
    var cdSec = Math.ceil(S.countdownRemaining(t, now) / 1000);

    $("tdTime").textContent = S.formatMs(ms);
    var pct = t.durationMs
      ? Math.max(0, Math.min(100, (ms / t.durationMs) * 100))
      : 0;
    $("tdBar").style.width = (phase === "idle" ? 0 : pct) + "%";
    $("tdSub").textContent = phase === "paused" ? "หยุดพักชั่วคราว" : "";

    var cls = "tdisp scene-" + scene + " state-" + phase;
    if ((phase === "running" || phase === "paused") && scene === "timer") {
      if (sec <= DANGER_SEC) cls += " is-danger";
      else if (sec <= WARN_SEC) cls += " is-warn";
    }
    if (PREVIEW) cls += " is-preview";
    if (body.className !== cls) body.className = cls;

    var onTimer = scene === "timer";
    var preCount = phase === "countdown" || phase === "announce";
    $("tdCount").hidden = !(onTimer && preCount);
    $("tdOver").hidden = !(onTimer && phase === "finished");
    if (phase === "countdown") $("tdCountNum").textContent = String(cdSec);
    if (phase === "announce") $("tdCountNum").textContent = String(t.cd || "");

    voiceTriggers(t, phase, sec, cdSec);

    // ประกาศ: เวลาตัวเล็กด้านล่าง
    var bt = $("bnTimer");
    if (
      scene === "banner" &&
      (phase === "running" ||
        phase === "paused" ||
        phase === "countdown" ||
        phase === "announce")
    ) {
      bt.textContent =
        (t.label ? t.label + " · " : "") +
        (phase === "countdown"
          ? "เริ่มใน " + cdSec + " วินาที"
          : phase === "announce"
            ? "เตรียมพร้อม"
            : S.formatMs(ms));
      bt.hidden = false;
    } else {
      bt.hidden = true;
    }

    // เสียงนาฬิกา (เฉพาะฉากนาฬิกา / ประกาศ)
    var audible = scene === "timer" || scene === "banner";
    if (audible) {
      if (
        phase === "countdown" &&
        lastCount !== null &&
        cdSec < lastCount &&
        cdSec <= 10 &&
        !(state.voice && state.voice.enabled)
      )
        snd.count();
      if (
        phase === "running" &&
        lastPhase !== null &&
        lastPhase !== "running" &&
        lastPhase !== "paused"
      ) {
        if (lastPhase === "countdown") {
          if (!(state.voice && state.voice.enabled)) snd.go();
        } else snd.start();
      }
      if (
        phase === "running" &&
        lastPhase === "running" &&
        lastSec !== null &&
        sec < lastSec
      ) {
        if (lastSec > WARN_SEC && sec <= WARN_SEC) snd.warn();
        else if (lastSec > DANGER_SEC && sec <= DANGER_SEC) snd.danger();
        else if (sec <= 5 && sec >= 1) snd.tick();
      }
      if (phase === "finished" && lastPhase === "running") snd.end();
    }

    lastCount = phase === "countdown" ? cdSec : null;
    lastSec = sec;
    lastPhase = phase;
  }

  setInterval(render, 100);
})();
