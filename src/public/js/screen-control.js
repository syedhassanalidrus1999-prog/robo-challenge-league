// public/js/screen-control.js — หน้าควบคุมจอแสดงผล (จอโน้ตบุ๊ก)
// เป็นเจ้าของสถานะทั้งหมด แล้วส่งให้หน้าแสดงผลผ่าน BroadcastChannel
(function () {
  var S = window.RCLScreen;
  if (!document.getElementById("vcCount")) {
    console.warn(
      "[screen] control.ejs เป็นเวอร์ชันเก่า — วางไฟล์ control.ejs ใหม่ทับ",
    );
  }
  var ch = S.channel();
  var $ = function (id) {
    return document.getElementById(id);
  };
  var STORE = "rcl-screen-state";
  var PRESET_STORE = "rcl-screen-presets";

  var SCENE_NAME = {
    timer: "นาฬิกา",
    banner: "ประกาศ",
    image: "รูปภาพ",
    video: "วิดีโอ",
    draw: "จับรางวัล",
    results: "ประกาศผล",
    logo: "โลโก้",
    blank: "จอดำ",
  };

  var DEFAULT_PRESETS = [
    { label: "ซ้อมรอบที่ 1", minutes: 30 },
    { label: "ซ้อมรอบที่ 2", minutes: 30 },
  ];

  // ======================================================================
  // สถานะ (เก็บใน localStorage → refresh หน้านี้แล้วนาฬิกายังเดินต่อ)
  // ======================================================================
  function defaultState() {
    return {
      scene: "logo",
      timer: {
        status: "idle",
        label: "",
        durationMs: 0,
        startAt: null,
        endAt: null,
        remainingMs: 0,
      },
      banner: { text: "", sub: "" },
      message: "",
      next: "",
      image: { id: null, name: "", fit: "contain" },
      video: {
        id: null,
        name: "",
        loop: false,
        muted: false,
        cmd: { action: "pause", seq: 0 },
      },
      draw: {
        seq: 0,
        phase: "idle",
        prize: "",
        sample: [],
        winner: null,
        at: 0,
        history: [],
      },
      results: {
        tier: "beginner",
        tierLabel: "",
        teams: [],
        revealed: 0,
        loadedAt: 0,
      },
      voice: {
        enabled: true,
        name: "",
        particle: "ค่ะ",
        rate: 0.95,
        volume: 1,
        countMode: "voice",
      },
      program: { day: 0, current: null, done: [[], []] },
      v: 0,
    };
  }

  var state = (function () {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || "null");
      if (s && s.timer) {
        var d = defaultState();
        Object.keys(d).forEach(function (k) {
          if (s[k] === undefined) s[k] = d[k];
        });
        // ไฟล์รูป/วิดีโอหายเมื่อ refresh → ถ้ากำลังแสดงอยู่ ให้กลับไปโลโก้
        if (s.scene === "image" || s.scene === "video") s.scene = "logo";
        s.image = d.image;
        s.video = d.video;
        return s;
      }
    } catch (e) {}
    return defaultState();
  })();

  var files = {}; // id → File
  var fileUrls = {}; // id → object URL (รูปตัวอย่างในหน้านี้)

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) {}
  }

  function broadcast() {
    ch.postMessage({ type: "state", state: state });
  }

  function commit(msg) {
    state.v = (state.v || 0) + 1;
    save();
    broadcast();
    renderUI();
    if (msg) toast(msg, true);
  }

  function setScene(scene) {
    state.scene = scene;
  }

  function sendMedia(id) {
    if (id && files[id])
      ch.postMessage({ type: "media", id: id, blob: files[id] });
  }

  // ======================================================================
  // ข้อความแจ้ง
  // ======================================================================
  var toastTimer = null;
  function toast(text, ok) {
    var el = $("ctStatus");
    el.textContent = text;
    el.className = "ct-status " + (ok ? "ok" : "bad");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = "ct-status";
    }, 2600);
  }

  // ======================================================================
  // ช่องทางสื่อสารกับจอ
  // ======================================================================
  var lastPing = 0;
  var videoStatus = null;

  ch.onmessage = function (e) {
    var m = e.data || {};
    if (m.type === "hello") {
      broadcast();
      sendMedia(state.image.id);
      sendMedia(state.video.id);
    } else if (m.type === "needMedia") {
      sendMedia(m.id);
    } else if (m.type === "ping") {
      lastPing = Date.now();
    } else if (m.type === "announceDone") {
      finishAnnounce(m.seq);
    } else if (m.type === "timerEnded") {
      lastPing = Date.now();
      handleStepEnd(m.seq);
    } else if (m.type === "videoStatus") {
      videoStatus = m;
      lastPing = Date.now();
    }
  };

  var displayWin = null;
  $("ctOpen").addEventListener("click", function () {
    if (displayWin && !displayWin.closed) {
      displayWin.focus();
      return;
    }
    displayWin = window.open(
      "/screen",
      "rcl-screen-display",
      "popup,width=1280,height=720",
    );
    if (!displayWin)
      toast(
        "เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต Pop-up สำหรับเว็บนี้",
        false,
      );
  });

  // ======================================================================
  // ตัวอย่างจอ: ย่อ iframe 1920×1080 ให้พอดีกรอบ
  // ======================================================================
  function fitPreview() {
    var wrap = $("ctPreviewWrap");
    $("ctPreview").style.transform = "scale(" + wrap.clientWidth / 1920 + ")";
  }
  window.addEventListener("resize", fitPreview);
  fitPreview();

  // ======================================================================
  // แท็บ + ปุ่มด่วน
  // ======================================================================
  var activeTab = "timer";
  document.querySelectorAll(".ct-tab").forEach(function (b) {
    b.addEventListener("click", function () {
      activeTab = b.getAttribute("data-tab");
      document.querySelectorAll(".ct-tab").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      document.querySelectorAll(".ct-panel").forEach(function (p) {
        p.classList.toggle(
          "active",
          p.getAttribute("data-panel") === activeTab,
        );
      });
    });
  });

  document.querySelectorAll("#ctQuick button").forEach(function (b) {
    b.addEventListener("click", function () {
      var sc = b.getAttribute("data-scene");
      if (sc === "banner" && !state.banner.text) {
        toast("ยังไม่มีข้อความประกาศ — เลือกในแท็บประกาศ", false);
        return;
      }
      setScene(sc);
      commit("ขึ้นจอ: " + SCENE_NAME[sc]);
    });
  });

  // ======================================================================
  // นาฬิกา
  // ======================================================================
  function loadPresets() {
    try {
      var p = JSON.parse(localStorage.getItem(PRESET_STORE) || "null");
      if (Array.isArray(p) && p.length) return p;
    } catch (e) {}
    return DEFAULT_PRESETS;
  }

  var presets = loadPresets();

  function renderPresets() {
    $("tmPresets").innerHTML = presets
      .map(function (p, i) {
        return (
          '<button type="button" class="ct-btn preset" data-i="' +
          i +
          '"><b>' +
          S.esc(p.label) +
          "</b><span>" +
          S.esc(p.minutes) +
          " นาที</span></button>"
        );
      })
      .join("");
    $("tmPresetText").value = presets
      .map(function (p) {
        return p.label + " | " + p.minutes;
      })
      .join("\n");
  }
  renderPresets();

  $("tmPresets").addEventListener("click", function (e) {
    var b = e.target.closest("[data-i]");
    if (!b) return;
    var p = presets[parseInt(b.getAttribute("data-i"), 10)];
    startTimer(p.label, p.minutes);
  });

  function cdSeconds() {
    var c = document.querySelector('input[name="tmCd"]:checked');
    return c ? parseInt(c.value, 10) : 0;
  }

  function startTimer(label, minutes) {
    var now = Date.now();
    var phase = S.timerPhase(state.timer, now);
    if (
      (phase === "running" || phase === "paused" || phase === "countdown") &&
      !confirm(
        'กำลังจับเวลา "' +
          (state.timer.label || "") +
          '" อยู่ เริ่มใหม่เป็น "' +
          label +
          '" ใช่ไหม?',
      )
    ) {
      return;
    }
    var ms = Math.round(parseFloat(minutes) * 60000);
    if (!(ms > 0)) {
      toast("จำนวนนาทีไม่ถูกต้อง", false);
      return;
    }
    var cd = cdSeconds();
    state.program.current = null;
    launchTimer({
      label: label || "จับเวลา",
      ms: ms,
      cd: cd,
      voice: {},
      stepRef: null,
    });
    commit(
      "เริ่ม " + state.timer.label + (cd ? " · นับถอยหลัง " + cd + " วิ" : ""),
    );
  }

  $("tmStart").addEventListener("click", function () {
    startTimer($("tmLabel").value.trim() || "จับเวลา", $("tmMin").value);
  });

  $("tmPause").addEventListener("click", function () {
    var t = state.timer;
    var now = Date.now();
    var p = S.timerPhase(t, now);
    if (p === "countdown" || p === "announce") {
      t.remainingMs = t.durationMs;
    } else if (p === "running") {
      t.remainingMs = t.endAt - now;
    } else {
      return;
    }
    t.status = "paused";
    t.startAt = null;
    t.endAt = null;
    commit("พักแล้ว");
  });

  $("tmResume").addEventListener("click", function () {
    var t = state.timer;
    if (t.status !== "paused") return;
    t.status = "running";
    t.startAt = null;
    t.endAt = Date.now() + t.remainingMs;
    t.remainingMs = 0;
    commit("เดินต่อแล้ว");
  });

  document.querySelectorAll("[data-add]").forEach(function (b) {
    b.addEventListener("click", function () {
      var sec = parseInt(b.getAttribute("data-add"), 10);
      var t = state.timer;
      var now = Date.now();
      var p = S.timerPhase(t, now);
      if (p === "announce") {
        t.durationMs = Math.max(1000, t.durationMs + sec * 1000);
      } else if (p === "countdown") {
        t.durationMs = Math.max(1000, t.durationMs + sec * 1000);
        t.endAt = t.startAt + t.durationMs;
      } else if (p === "running") {
        t.endAt = Math.max(now + 1000, t.endAt + sec * 1000);
        t.durationMs = Math.max(t.durationMs + sec * 1000, t.endAt - now);
      } else if (p === "paused") {
        t.remainingMs = Math.max(1000, t.remainingMs + sec * 1000);
        t.durationMs = Math.max(t.durationMs + sec * 1000, t.remainingMs);
      } else if (p === "finished" && sec > 0) {
        t.endAt = now + sec * 1000;
        t.durationMs = sec * 1000;
      } else {
        toast("ยังไม่ได้เริ่มจับเวลา", false);
        return;
      }
      commit((sec > 0 ? "เพิ่ม " : "ลด ") + Math.abs(sec) + " วินาที");
    });
  });

  $("tmReset").addEventListener("click", function () {
    if (!confirm("หยุดจับเวลาและล้างนาฬิกา?")) return;
    state.timer = defaultState().timer;
    state.program.current = null;
    commit("รีเซ็ตแล้ว");
  });

  $("tmMsgSend").addEventListener("click", function () {
    state.message = $("tmMsg").value.trim();
    commit("แสดงข้อความแล้ว");
  });
  $("tmMsgClear").addEventListener("click", function () {
    $("tmMsg").value = "";
    state.message = "";
    commit("ลบข้อความแล้ว");
  });
  $("tmNext").value = state.next || "";
  $("tmMsg").value = state.message || "";
  $("tmNextSave").addEventListener("click", function () {
    state.next = $("tmNext").value.trim();
    commit("บันทึกแล้ว");
  });

  $("tmPresetSave").addEventListener("click", function () {
    var list = [];
    var lines = $("tmPresetText")
      .value.split(/\r?\n/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    for (var i = 0; i < lines.length && list.length < 8; i++) {
      var m = lines[i].match(/^(.+?)\s*[|,]\s*(\d+(?:\.\d+)?)\s*$/);
      if (!m) {
        toast('รูปแบบไม่ถูกต้อง: "' + lines[i] + '" (ใช้ ชื่อ | นาที)', false);
        return;
      }
      list.push({
        label: m[1].slice(0, 60),
        minutes: Math.min(600, parseFloat(m[2])),
      });
    }
    presets = list.length ? list : DEFAULT_PRESETS;
    try {
      localStorage.setItem(PRESET_STORE, JSON.stringify(presets));
    } catch (e) {}
    renderPresets();
    toast("บันทึกปุ่มแล้ว", true);
  });

  // ======================================================================
  // ประกาศ
  // ======================================================================
  function showBanner(text) {
    text = String(text || "").trim();
    if (!text) {
      toast("กรุณาใส่ข้อความประกาศ", false);
      return;
    }
    state.banner = { text: text, sub: $("bnSub").value.trim() };
    setScene("banner");
    commit("ประกาศ: " + text);
  }
  document.querySelectorAll("[data-banner]").forEach(function (b) {
    b.addEventListener("click", function () {
      showBanner(b.getAttribute("data-banner"));
    });
  });
  $("bnSend").addEventListener("click", function () {
    showBanner($("bnText").value);
  });

  // ======================================================================
  // รูปภาพ / วิดีโอ (ไฟล์จากเครื่อง)
  // ======================================================================
  var images = [];
  var videos = [];

  function addFiles(list, kind) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var id =
        kind +
        "-" +
        Date.now().toString(36) +
        "-" +
        i +
        "-" +
        Math.random().toString(36).slice(2, 6);
      files[id] = f;
      fileUrls[id] = URL.createObjectURL(f);
      (kind === "img" ? images : videos).push({ id: id, name: f.name });
    }
    renderMedia();
  }

  $("imgFiles").addEventListener("change", function () {
    addFiles(this.files, "img");
    this.value = "";
  });
  $("vidFiles").addEventListener("change", function () {
    addFiles(this.files, "vid");
    this.value = "";
  });

  function renderMedia() {
    $("imgList").innerHTML =
      images
        .map(function (m) {
          var on = state.scene === "image" && state.image.id === m.id;
          return (
            '<button type="button" data-img="' +
            m.id +
            '" class="' +
            (on ? "on" : "") +
            '"><img src="' +
            fileUrls[m.id] +
            '" alt=""><span class="nm">' +
            S.esc(m.name) +
            "</span></button>"
          );
        })
        .join("") || '<span class="ct-small">ยังไม่ได้เลือกรูป</span>';

    $("vidList").innerHTML =
      videos
        .map(function (m) {
          var on = state.video.id === m.id;
          return (
            '<button type="button" data-vid="' +
            m.id +
            '" class="' +
            (on ? "on" : "") +
            '"><span class="vthumb"><i class="ti ti-player-play"></i></span><span class="nm">' +
            S.esc(m.name) +
            "</span></button>"
          );
        })
        .join("") || '<span class="ct-small">ยังไม่ได้เลือกวิดีโอ</span>';
  }

  $("imgList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-img]");
    if (!b) return;
    var id = b.getAttribute("data-img");
    var m = images.filter(function (x) {
      return x.id === id;
    })[0];
    state.image = {
      id: id,
      name: m ? m.name : "",
      fit: $("imgCover").checked ? "cover" : "contain",
    };
    sendMedia(id);
    setScene("image");
    commit("ขึ้นจอ: " + state.image.name);
  });

  $("imgCover").addEventListener("change", function () {
    state.image.fit = this.checked ? "cover" : "contain";
    commit();
  });

  function videoCmd(action) {
    state.video.cmd = { action: action, seq: (state.video.cmd.seq || 0) + 1 };
  }

  $("vidList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-vid]");
    if (!b) return;
    var id = b.getAttribute("data-vid");
    var m = videos.filter(function (x) {
      return x.id === id;
    })[0];
    state.video.id = id;
    state.video.name = m ? m.name : "";
    state.video.loop = $("vidLoop").checked;
    state.video.muted = $("vidMute").checked;
    videoCmd("restart");
    sendMedia(id);
    setScene("video");
    videoStatus = null;
    commit("เล่นวิดีโอ: " + state.video.name);
  });

  $("vidPlay").addEventListener("click", function () {
    if (!state.video.id) {
      toast("ยังไม่ได้เลือกวิดีโอ", false);
      return;
    }
    videoCmd("play");
    setScene("video");
    commit("เล่น");
  });
  $("vidPause").addEventListener("click", function () {
    videoCmd("pause");
    commit("หยุด");
  });
  $("vidRestart").addEventListener("click", function () {
    if (!state.video.id) return;
    videoCmd("restart");
    setScene("video");
    commit("เริ่มใหม่");
  });
  $("vidLoop").addEventListener("change", function () {
    state.video.loop = this.checked;
    commit();
  });
  $("vidMute").addEventListener("change", function () {
    state.video.muted = this.checked;
    commit();
  });

  // ======================================================================
  // จับรางวัล (ใช้ระบบสุ่มเดิมของแบบประเมิน: POST /board/survey/draw)
  // ======================================================================
  var drawing = false;

  $("drShow").addEventListener("click", function () {
    state.draw.prize = $("drPrize").value.trim();
    state.draw.phase = "idle";
    state.draw.winner = null;
    state.draw.seq++;
    setScene("draw");
    commit("ขึ้นจอหน้าจับรางวัล");
  });

  $("drGo").addEventListener("click", function () {
    if (drawing) return;
    drawing = true;
    $("drGo").disabled = true;
    var prize = $("drPrize").value.trim();
    var body = new URLSearchParams();
    body.set("pool", $("drPool").value);
    body.set("prize", prize);

    fetch("/board/survey/draw", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    })
      .then(function (r) {
        if (r.redirected) throw new Error("login");
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          toast(data.error || "สุ่มไม่สำเร็จ", false);
          return;
        }
        var w = data.winner;
        state.draw = {
          seq: (state.draw.seq || 0) + 1,
          phase: "spinning",
          prize: prize,
          sample: data.sample || [],
          winner: {
            code: w.code,
            maskedName: w.maskedName,
            type: w.type,
            prize: w.prize,
          },
          at: Date.now(),
          history: [{ code: w.code, maskedName: w.maskedName, prize: w.prize }]
            .concat(state.draw.history || [])
            .slice(0, 10),
        };
        setScene("draw");
        commit("สุ่มได้ " + w.code);

        $("drWinner").hidden = false;
        $("drWinner").innerHTML =
          "<b>" +
          S.esc(w.code) +
          "</b> · " +
          S.esc(w.name || "—") +
          "<br><span class='ct-small'>" +
          S.esc(w.type) +
          (w.phoneTail
            ? " · เบอร์ลงท้าย " + S.esc(w.phoneTail.slice(-4))
            : "") +
          (w.prize ? " · " + S.esc(w.prize) : "") +
          " · เหลือในกล่อง " +
          data.remaining +
          " รหัส</span>";
        renderDrawHistory();
      })
      .catch(function (err) {
        toast(
          err.message === "login"
            ? "หมดเวลาเข้าสู่ระบบ — login ใหม่"
            : "สุ่มไม่สำเร็จ (" + err.message + ") — ตรวจอินเทอร์เน็ต",
          false,
        );
      })
      .then(function () {
        setTimeout(function () {
          drawing = false;
          $("drGo").disabled = false;
        }, 4500);
      });
  });

  function renderDrawHistory() {
    var h = state.draw.history || [];
    $("drHist").hidden = !h.length;
    $("drHist").innerHTML = h
      .map(function (w, i) {
        return (
          "<div><span class='rk'>" +
          (h.length - i) +
          "</span><span class='nm'><b>" +
          S.esc(w.code) +
          "</b> " +
          S.esc(w.maskedName) +
          "</span><span class='ct-small'>" +
          S.esc(w.prize || "") +
          "</span></div>"
        );
      })
      .join("");
  }
  renderDrawHistory();

  // ======================================================================
  // ประกาศผล Top 10
  // ======================================================================
  $("rsTier").value = state.results.tier || "beginner";

  $("rsLoad").addEventListener("click", function () {
    var tier = $("rsTier").value;
    fetch("/screen/api/results?tier=" + encodeURIComponent(tier), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (r.redirected) throw new Error("login");
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          toast(data.error || "โหลดผลไม่สำเร็จ", false);
          return;
        }
        state.results = {
          tier: data.tier,
          tierLabel: data.tierLabel,
          teams: data.teams,
          revealed: 0,
          loadedAt: Date.now(),
        };
        commit("โหลดผล " + data.tierLabel + " (" + data.teams.length + " ทีม)");
        if (!data.teams.length) toast("รุ่นนี้ยังไม่มีทีมที่มีคะแนน", false);
      })
      .catch(function (err) {
        toast(
          err.message === "login"
            ? "หมดเวลาเข้าสู่ระบบ — login ใหม่"
            : "โหลดผลไม่สำเร็จ — ตรวจอินเทอร์เน็ต",
          false,
        );
      });
  });

  function reveal(delta) {
    var r = state.results;
    var n = (r.teams || []).length;
    if (!n) {
      toast("ยังไม่ได้โหลดผล", false);
      return;
    }
    var next = Math.max(0, Math.min(n, (r.revealed || 0) + delta));
    if (next === r.revealed) return;
    r.revealed = next;
    setScene("results");
    var shownRank = n - next + 1;
    commit(delta > 0 ? "เปิดอันดับ " + shownRank : "ย้อน");
  }

  $("rsShow").addEventListener("click", function () {
    if (!(state.results.teams || []).length) {
      toast("ยังไม่ได้โหลดผล", false);
      return;
    }
    setScene("results");
    commit("ขึ้นจอ: ประกาศผล " + state.results.tierLabel);
  });
  $("rsNext").addEventListener("click", function () {
    reveal(1);
  });
  $("rsPrev").addEventListener("click", function () {
    reveal(-1);
  });
  $("rsAll").addEventListener("click", function () {
    reveal(100);
  });
  $("rsNone").addEventListener("click", function () {
    reveal(-100);
  });

  // รีโมทพรีเซนต์ / คีย์บอร์ด (เฉพาะตอนฉากประกาศผลขึ้นจอ และไม่ได้พิมพ์อยู่)
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (tag === "button" && (e.key === " " || e.key === "Enter")) return;
    if (state.scene !== "results") return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      reveal(1);
    }
    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      reveal(-1);
    }
  });

  function renderResultsList() {
    var r = state.results;
    var teams = r.teams || [];
    var n = teams.length;
    $("rsList").hidden = !n;
    $("rsList").innerHTML = teams
      .slice()
      .reverse()
      .map(function (t) {
        var shown = t.rank > n - (r.revealed || 0);
        var nextUp = !shown && t.rank === n - (r.revealed || 0);
        return (
          "<div class='" +
          (shown ? "shown" : nextUp ? "nextup" : "") +
          "'><span class='rk'>" +
          t.rank +
          "</span><span class='nm'>" +
          S.esc(t.name) +
          "</span><span class='ct-small'>" +
          S.esc(t.score) +
          " คะแนน" +
          (t.time ? " · " + S.esc(t.time) : "") +
          "</span><span class='ct-small'>" +
          (shown ? "✓ เปิดแล้ว" : nextUp ? "▶ ถัดไป" : "") +
          "</span></div>"
        );
      })
      .join("");
  }

  // ======================================================================
  // โปรแกรมรายวัน + เสียงประกาศ AI
  // ======================================================================
  var PROGRAM_STORE = "rcl-screen-program";
  var SCRIPT_STORE = "rcl-screen-scripts";

  var DEFAULT_PROGRAM = [
    [
      {
        label: "ซ้อมรอบที่ 1",
        kind: "practice",
        minutes: 70,
        cd: 10,
        after: "next",
      },
      {
        label: "รวมหุ่นยนต์",
        kind: "collect",
        minutes: 10,
        cd: 0,
        after: "hold",
      },
      {
        label: "ซ้อมรอบที่ 2",
        kind: "practice",
        minutes: 90,
        cd: 10,
        after: "next",
      },
      {
        label: "รวมหุ่นยนต์",
        kind: "collect",
        minutes: 10,
        cd: 0,
        after: "hold",
      },
    ],
    [
      {
        label: "ซ้อมรอบที่ 1",
        kind: "practice",
        minutes: 60,
        cd: 10,
        after: "next",
      },
      {
        label: "รวมหุ่นยนต์",
        kind: "collect",
        minutes: 10,
        cd: 0,
        after: "hold",
      },
      {
        label: "ซ้อมรอบที่ 2",
        kind: "practice",
        minutes: 60,
        cd: 10,
        after: "next",
      },
      {
        label: "รวมหุ่นยนต์",
        kind: "collect",
        minutes: 10,
        cd: 0,
        after: "hold",
      },
    ],
  ];

  var SCRIPT_FIELDS = [
    { key: "practice_start", label: "ซ้อม · ก่อนเริ่ม (ก่อนนับถอยหลัง)" },
    { key: "practice_go", label: "ซ้อม · ตอนเริ่ม (หลังนับถึง 1)" },
    { key: "practice_warn", label: "ซ้อม · เตือน 10 / 5 นาที" },
    { key: "practice_warn1", label: "ซ้อม · เตือน 1 นาที" },
    { key: "practice_end", label: "ซ้อม · หมดเวลา (ต่อด้วยรวมหุ่นยนต์)" },
    {
      key: "practice_end_plain",
      label: "ซ้อม · หมดเวลา (ไม่มีขั้นรวมหุ่นยนต์ต่อ)",
    },
    { key: "collect_start", label: "รวมหุ่นยนต์ · ตอนเริ่ม (กดเริ่มเอง)" },
    { key: "collect_warn", label: "รวมหุ่นยนต์ · เตือน 5 นาที" },
    { key: "collect_warn1", label: "รวมหุ่นยนต์ · เตือน 1 นาที" },
    { key: "collect_end", label: "รวมหุ่นยนต์ · หมดเวลา" },
  ];

  var DEFAULT_SCRIPTS = {
    practice_start:
      "ขอเชิญผู้เข้าแข่งขันทุกทีม เตรียมพร้อมสำหรับการ{label} ค่ะ การซ้อมจะเริ่มในอีก {cd} วินาที",
    practice_go: "เริ่มซ้อมได้ค่ะ",
    practice_warn: "เหลือเวลา{label} อีก {n} นาทีค่ะ",
    practice_warn1:
      "เหลือเวลา{label} อีก 1 นาที กรุณาเตรียมนำหุ่นยนต์ออกจากสนามค่ะ",
    practice_end:
      "หมดเวลา{label} ค่ะ ขอให้ผู้เข้าแข่งขันทุกทีมหยุดการซ้อม และนำหุ่นยนต์มาส่งที่โต๊ะรวมหุ่นยนต์ภายใน {next_minutes} นาทีค่ะ",
    practice_end_plain:
      "หมดเวลา{label} ค่ะ ขอให้ผู้เข้าแข่งขันทุกทีมหยุดการซ้อมค่ะ",
    collect_start:
      "ขอให้ผู้เข้าแข่งขันทุกทีม นำหุ่นยนต์มาส่งที่โต๊ะรวมหุ่นยนต์ภายใน {minutes} นาทีค่ะ",
    collect_warn: "เหลือเวลาส่งหุ่นยนต์อีก {n} นาทีค่ะ",
    collect_warn1:
      "เหลือเวลาส่งหุ่นยนต์อีก 1 นาที ทีมที่ยังไม่ได้ส่ง กรุณานำหุ่นยนต์มาที่โต๊ะรวมหุ่นยนต์ค่ะ",
    collect_end:
      "หมดเวลาส่งหุ่นยนต์ค่ะ ขอบคุณผู้เข้าแข่งขันทุกทีม ทีมที่ยังไม่ได้ส่งหุ่นยนต์ กรุณาติดต่อเจ้าหน้าที่ที่โต๊ะรวมหุ่นยนต์ค่ะ",
  };

  var QUICK_PHRASES = [
    "ขอความร่วมมือทุกทีม ไม่ยืนบังสนามระหว่างการซ้อมค่ะ",
    "ขณะนี้พักรับประทานอาหารกลางวันค่ะ",
    "ขอเชิญผู้เข้าแข่งขันทุกทีม กลับเข้าประจำพื้นที่ของทีมค่ะ",
    "ขอเชิญทุกท่านเข้าร่วมพิธีมอบรางวัลค่ะ",
  ];

  function loadJson(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  var program =
    loadJson(PROGRAM_STORE, null) ||
    JSON.parse(JSON.stringify(DEFAULT_PROGRAM));
  var scripts = Object.assign({}, DEFAULT_SCRIPTS, loadJson(SCRIPT_STORE, {}));
  if (!state.program || !state.program.done)
    state.program = { day: 0, current: null, done: [[], []] };
  if (!state.voice) state.voice = defaultState().voice;

  function fill(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] !== undefined ? vars[k] : m;
    });
  }

  // สร้างชุดข้อความเสียงของขั้นตอน
  function buildVoice(step, next, chained) {
    var vars = {
      label: step.label,
      minutes: step.minutes,
      cd: step.cd,
      next_minutes: next ? next.minutes : "",
    };
    var v = { start: "", go: "", warns: [], end: "" };
    if (step.kind === "practice") {
      v.start = fill(scripts.practice_start, vars);
      v.go = fill(scripts.practice_go, vars);
      [10, 5].forEach(function (n) {
        if (step.minutes > n)
          v.warns.push({
            sec: n * 60,
            text: fill(scripts.practice_warn, Object.assign({ n: n }, vars)),
          });
      });
      if (step.minutes > 1)
        v.warns.push({ sec: 60, text: fill(scripts.practice_warn1, vars) });
      v.end =
        next && next.kind === "collect" && step.after === "next"
          ? fill(scripts.practice_end, vars)
          : fill(scripts.practice_end_plain, vars);
    } else {
      // รวมหุ่นยนต์ที่ต่อจากการซ้อม: ประกาศไปแล้วตอนหมดเวลาซ้อม
      v.start = chained ? "" : fill(scripts.collect_start, vars);
      if (step.minutes > 5)
        v.warns.push({
          sec: 300,
          text: fill(scripts.collect_warn, Object.assign({ n: 5 }, vars)),
        });
      if (step.minutes > 1)
        v.warns.push({ sec: 60, text: fill(scripts.collect_warn1, vars) });
      v.end = fill(scripts.collect_end, vars);
    }
    return v;
  }

  // เริ่มนาฬิกา (ใช้ทั้งโปรแกรมและจับเวลาเอง)
  function launchTimer(o) {
    var now = Date.now();
    var displayOn = now - lastPing < 5000;
    var waitVoice =
      o.cd > 0 && state.voice.enabled && displayOn && o.voice && o.voice.start;
    state.timer = {
      status: waitVoice ? "announce" : "running",
      seq: (state.timer.seq || 0) + 1,
      label: o.label,
      durationMs: o.ms,
      cd: o.cd,
      announceAt: now,
      startAt: waitVoice ? null : o.cd ? now + o.cd * 1000 : null,
      endAt: waitVoice ? null : now + o.cd * 1000 + o.ms,
      remainingMs: 0,
      voice: o.voice || {},
      stepRef: o.stepRef || null,
      endHandled: false,
    };
    // พูดประกาศก่อนนับถอยหลังไม่ได้ (จอไม่เปิด) → ส่งเสียงเริ่มไปพร้อมนับเลย
    if (!waitVoice && o.cd > 0 && o.voice && o.voice.start)
      ch.postMessage({ type: "speak", text: o.voice.start });
    setScene("timer");
  }

  function finishAnnounce(seq) {
    var t = state.timer;
    if (t.status !== "announce" || t.seq !== seq) return;
    var now = Date.now();
    t.status = "running";
    t.startAt = t.cd ? now + t.cd * 1000 : null;
    t.endAt = now + (t.cd || 0) * 1000 + t.durationMs;
    commit();
  }

  function startStep(day, i, chained) {
    var steps = program[day] || [];
    var step = steps[i];
    if (!step) return;
    var now = Date.now();
    var p = S.timerPhase(state.timer, now);
    if (
      !chained &&
      (p === "running" ||
        p === "paused" ||
        p === "countdown" ||
        p === "announce") &&
      !confirm(
        'กำลังจับเวลา "' +
          (state.timer.label || "") +
          '" อยู่ เริ่ม "' +
          step.label +
          '" แทนใช่ไหม?',
      )
    ) {
      return;
    }
    var next = steps[i + 1] || null;
    state.program.day = day;
    state.program.current = i;
    launchTimer({
      label: step.label,
      ms: Math.round(step.minutes * 60000),
      cd: chained ? 0 : step.cd,
      voice: buildVoice(step, next, chained),
      stepRef: { day: day, i: i },
    });
    commit(
      (chained ? "ต่ออัตโนมัติ: " : "เริ่ม: ") +
        step.label +
        " (" +
        step.minutes +
        " นาที)",
    );
  }

  function handleStepEnd(seq) {
    var t = state.timer;
    if (!t.stepRef || t.endHandled || (seq !== undefined && seq !== t.seq))
      return;
    t.endHandled = true;
    var day = t.stepRef.day;
    var i = t.stepRef.i;
    var done = state.program.done[day] || (state.program.done[day] = []);
    if (done.indexOf(i) < 0) done.push(i);
    var step = (program[day] || [])[i];
    if (step && step.after === "next" && program[day][i + 1]) {
      startStep(day, i + 1, true);
    } else {
      state.program.current = null;
      commit("จบขั้น: " + (step ? step.label : ""));
    }
  }

  function renderProgram() {
    var day = state.program.day || 0;
    document.querySelectorAll("#pgDays [data-day]").forEach(function (b) {
      b.classList.toggle(
        "active",
        parseInt(b.getAttribute("data-day"), 10) === day,
      );
    });
    var steps = program[day] || [];
    var cur = state.program.current;
    var doneList = state.program.done[day] || [];
    var phase = S.timerPhase(state.timer, Date.now());
    var running =
      state.timer.stepRef &&
      state.timer.stepRef.day === day &&
      phase !== "idle" &&
      phase !== "finished";

    $("pgList").innerHTML =
      steps
        .map(function (st, i) {
          var isCur = running && cur === i;
          var isDone = doneList.indexOf(i) >= 0 && !isCur;
          var isNext =
            !isCur &&
            !running &&
            doneList.indexOf(i) < 0 &&
            steps.slice(0, i).every(function (x, j) {
              return doneList.indexOf(j) >= 0;
            });
          return (
            '<div class="pg-step' +
            (isCur ? " cur" : isDone ? " done" : isNext ? " next" : "") +
            '">' +
            '<span class="pg-no">' +
            (isDone ? '<i class="ti ti-check"></i>' : i + 1) +
            "</span>" +
            '<div class="pg-info"><b>' +
            S.esc(st.label) +
            "</b><span>" +
            st.minutes +
            " นาที" +
            (st.cd ? " · นับถอยหลัง " + st.cd + " วิ" : " · ไม่มีนับถอยหลัง") +
            (st.after === "next" && steps[i + 1]
              ? " · จบแล้วต่อ " + S.esc(steps[i + 1].label) + " อัตโนมัติ"
              : " · จบแล้วหยุดรอ") +
            "</span></div>" +
            (isCur ? '<span class="pg-live">กำลังทำ</span>' : "") +
            '<button type="button" class="ct-btn ' +
            (isNext ? "primary" : "") +
            '" data-start="' +
            i +
            '"><i class="ti ti-player-play"></i> เริ่ม</button>' +
            "</div>"
          );
        })
        .join("") || '<p class="ct-small">ยังไม่มีขั้นตอน</p>';
    renderProgramEdit();
  }

  function renderProgramEdit() {
    var steps = program[state.program.day || 0] || [];
    $("pgEdit").innerHTML = steps
      .map(function (st, i) {
        return (
          '<div class="pg-erow" data-i="' +
          i +
          '">' +
          '<input class="ct-input" data-f="label" value="' +
          S.esc(st.label) +
          '" placeholder="ชื่อขั้น">' +
          '<select class="ct-input" data-f="kind"><option value="practice"' +
          (st.kind === "practice" ? " selected" : "") +
          '>ซ้อม</option><option value="collect"' +
          (st.kind === "collect" ? " selected" : "") +
          ">รวมหุ่นยนต์</option></select>" +
          '<input class="ct-input num" data-f="minutes" type="number" min="1" max="600" value="' +
          st.minutes +
          '" title="นาที">' +
          '<select class="ct-input" data-f="cd"><option value="0"' +
          (!st.cd ? " selected" : "") +
          '>ไม่นับถอยหลัง</option><option value="5"' +
          (st.cd == 5 ? " selected" : "") +
          '>นับ 5 วิ</option><option value="10"' +
          (st.cd == 10 ? " selected" : "") +
          '>นับ 10 วิ</option><option value="30"' +
          (st.cd == 30 ? " selected" : "") +
          ">นับ 30 วิ</option></select>" +
          '<select class="ct-input" data-f="after"><option value="next"' +
          (st.after === "next" ? " selected" : "") +
          '>จบแล้วต่ออัตโนมัติ</option><option value="hold"' +
          (st.after !== "next" ? " selected" : "") +
          ">จบแล้วหยุดรอ</option></select>" +
          '<button type="button" class="ct-btn danger" data-del="' +
          i +
          '" title="ลบขั้นนี้"><i class="ti ti-trash"></i></button>' +
          "</div>"
        );
      })
      .join("");
  }

  function readProgramEdit() {
    var rows = document.querySelectorAll("#pgEdit .pg-erow");
    var list = [];
    rows.forEach(function (r) {
      var g = function (f) {
        return r.querySelector('[data-f="' + f + '"]').value;
      };
      var label = g("label").trim();
      var minutes = parseFloat(g("minutes"));
      if (!label || !(minutes > 0)) return;
      list.push({
        label: label.slice(0, 60),
        kind: g("kind"),
        minutes: Math.min(600, minutes),
        cd: parseInt(g("cd"), 10) || 0,
        after: g("after"),
      });
    });
    return list;
  }

  $("pgDays").addEventListener("click", function (e) {
    var b = e.target.closest("[data-day]");
    if (!b) return;
    state.program.day = parseInt(b.getAttribute("data-day"), 10);
    save();
    renderProgram();
  });

  $("pgList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-start]");
    if (!b) return;
    startStep(
      state.program.day || 0,
      parseInt(b.getAttribute("data-start"), 10),
      false,
    );
  });

  $("pgEdit").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del]");
    if (!b) return;
    var day = state.program.day || 0;
    program[day] = readProgramEdit();
    program[day].splice(parseInt(b.getAttribute("data-del"), 10), 1);
    renderProgramEdit();
  });

  $("pgAdd").addEventListener("click", function () {
    var day = state.program.day || 0;
    program[day] = readProgramEdit();
    program[day].push({
      label: "ขั้นตอนใหม่",
      kind: "practice",
      minutes: 30,
      cd: 10,
      after: "hold",
    });
    renderProgramEdit();
  });

  $("pgSave").addEventListener("click", function () {
    var day = state.program.day || 0;
    program[day] = readProgramEdit();
    try {
      localStorage.setItem(PROGRAM_STORE, JSON.stringify(program));
    } catch (e) {}
    state.program.done[day] = [];
    commit("บันทึกโปรแกรมวันที่ " + (day + 1) + " แล้ว");
    renderProgram();
  });

  $("pgDefault").addEventListener("click", function () {
    if (!confirm("คืนค่าโปรแกรมทั้ง 2 วันเป็นค่าเริ่มต้น?")) return;
    program = JSON.parse(JSON.stringify(DEFAULT_PROGRAM));
    try {
      localStorage.removeItem(PROGRAM_STORE);
    } catch (e) {}
    state.program.done = [[], []];
    commit("คืนค่าโปรแกรมแล้ว");
    renderProgram();
  });

  // ---------------- เสียง ----------------
  function fillVoices() {
    var sel = $("vcVoice");
    var list = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    var th = list.filter(function (v) {
      return /^th/i.test(v.lang);
    });
    var cur = state.voice.name || "";
    sel.innerHTML =
      '<option value="">อัตโนมัติ (เสียงไทยที่ดีที่สุด)</option>' +
      th
        .map(function (v) {
          return (
            '<option value="' +
            S.esc(v.name) +
            '"' +
            (v.name === cur ? " selected" : "") +
            ">" +
            S.esc(v.name) +
            "</option>"
          );
        })
        .join("");
    $("vcHint").textContent = th.length
      ? "พบเสียงภาษาไทย " +
        th.length +
        " เสียง · เสียงพูดออกที่จอแสดงผล · แนะนำ Microsoft Edge เสียง Premwadee / Niwat (Natural)"
      : "ไม่พบเสียงภาษาไทยในเบราว์เซอร์นี้ — แนะนำเปิดด้วย Microsoft Edge (มีเสียงไทย Natural ฟรี)";
  }
  if (window.speechSynthesis) {
    fillVoices();
    window.speechSynthesis.onvoiceschanged = fillVoices;
  }

  $("vcOn").checked = !!state.voice.enabled;
  $("vcParticle").value = state.voice.particle || "ค่ะ";
  $("vcRate").value = state.voice.rate || 0.95;
  $("vcVol").value = state.voice.volume === undefined ? 1 : state.voice.volume;
  if ($("vcCount")) $("vcCount").value = state.voice.countMode || "voice";

  function saveVoice() {
    state.voice = {
      enabled: $("vcOn").checked,
      name: $("vcVoice").value,
      particle: $("vcParticle").value,
      rate: parseFloat($("vcRate").value) || 0.95,
      volume: parseFloat($("vcVol").value),
      countMode: $("vcCount") ? $("vcCount").value : "voice",
    };
    commit();
  }
  ["vcOn", "vcVoice", "vcParticle", "vcRate", "vcVol", "vcCount"].forEach(
    function (id) {
      if ($(id)) $(id).addEventListener("change", saveVoice);
    },
  );

  function say(text, cancel) {
    if (!text) return;
    if (!state.voice.enabled) {
      toast('เสียงพูดปิดอยู่ — ติ๊ก "เปิดเสียงพูด" ก่อน', false);
      return;
    }
    if (Date.now() - lastPing > 5000)
      toast("ยังไม่ได้เปิดจอแสดงผล — เสียงพูดออกที่หน้าต่างจอแสดงผล", false);
    ch.postMessage({ type: "speak", text: text, cancel: !!cancel });
  }

  $("vcTest").addEventListener("click", function () {
    say(fill(scripts.practice_start, { label: "ซ้อมรอบที่ 1", cd: 10 }), true);
  });
  $("vcQuick").innerHTML = QUICK_PHRASES.map(function (q, i) {
    return (
      '<button type="button" class="ct-btn banner" data-q="' +
      i +
      '">' +
      S.esc(q) +
      "</button>"
    );
  }).join("");
  $("vcQuick").addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]");
    if (b) say(QUICK_PHRASES[parseInt(b.getAttribute("data-q"), 10)]);
  });
  $("vcSay").addEventListener("click", function () {
    say($("vcText").value.trim());
  });
  $("vcStop").addEventListener("click", function () {
    ch.postMessage({ type: "speak", text: "", cancel: true });
  });

  // ---------------- สคริปต์ ----------------
  function renderScripts() {
    $("scEdit").innerHTML = SCRIPT_FIELDS.map(function (f) {
      return (
        '<label class="sc-field"><span>' +
        S.esc(f.label) +
        '</span><textarea class="ct-input ct-area" rows="2" data-sc="' +
        f.key +
        '">' +
        S.esc(scripts[f.key]) +
        "</textarea></label>"
      );
    }).join("");
  }
  renderScripts();

  $("scSave").addEventListener("click", function () {
    document.querySelectorAll("[data-sc]").forEach(function (t) {
      scripts[t.getAttribute("data-sc")] = t.value.trim();
    });
    try {
      localStorage.setItem(SCRIPT_STORE, JSON.stringify(scripts));
    } catch (e) {}
    toast("บันทึกสคริปต์แล้ว (ใช้กับขั้นตอนที่เริ่มหลังจากนี้)", true);
  });
  $("scDefault").addEventListener("click", function () {
    if (!confirm("คืนค่าสคริปต์เสียงทั้งหมดเป็นค่าเริ่มต้น?")) return;
    scripts = Object.assign({}, DEFAULT_SCRIPTS);
    try {
      localStorage.removeItem(SCRIPT_STORE);
    } catch (e) {}
    renderScripts();
    toast("คืนค่าสคริปต์แล้ว", true);
  });

  // ======================================================================
  // วาดหน้าควบคุม
  // ======================================================================
  function renderUI() {
    $("ctLiveName").textContent = SCENE_NAME[state.scene] || state.scene;
    document.querySelectorAll("#ctQuick button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-scene") === state.scene);
    });
    document.querySelectorAll(".ct-tab").forEach(function (b) {
      b.classList.toggle("live", b.getAttribute("data-tab") === state.scene);
    });
    $("rsNext").disabled =
      !(state.results.teams || []).length ||
      (state.results.revealed || 0) >= (state.results.teams || []).length;
    renderMedia();
    renderResultsList();
    renderProgram();
  }

  function tick() {
    var now = Date.now();
    var t = state.timer;
    var p = S.timerPhase(t, now);
    $("tmNow").textContent = S.formatMs(S.timerRemaining(t, now));
    // ประกาศค้าง (จอไม่ตอบ) → เริ่มนับถอยหลังเอง
    if (p === "announce" && now - (t.announceAt || 0) > 25000)
      finishAnnounce(t.seq);
    // จอแสดงผลไม่ได้เปิด → หน้าควบคุมต่อขั้นถัดไปเอง
    if (p === "finished" && t.stepRef && !t.endHandled && now - lastPing > 5000)
      handleStepEnd(t.seq);

    $("tmState").textContent =
      p === "announce"
        ? t.label + " · กำลังประกาศ"
        : p === "countdown"
          ? t.label +
            " · เริ่มใน " +
            Math.ceil(S.countdownRemaining(t, now) / 1000) +
            " วิ"
          : p === "running"
            ? t.label + " · กำลังจับเวลา"
            : p === "paused"
              ? t.label + " · หยุดพัก"
              : p === "finished"
                ? t.label + " · หมดเวลา"
                : "รอเริ่ม";
    $("tmPause").disabled =
      p !== "running" && p !== "countdown" && p !== "announce";
    if (tick.lastPhase !== p) {
      tick.lastPhase = p;
      renderProgram();
    }
    $("tmResume").disabled = p !== "paused";

    var on = now - lastPing < 5000;
    $("ctConn").classList.toggle("on", on);
    $("ctConn").querySelector("span").textContent = on
      ? "จอโปรเจกเตอร์: เชื่อมต่อแล้ว"
      : "จอโปรเจกเตอร์: ยังไม่เปิด";

    if (videoStatus && state.scene === "video" && videoStatus.d) {
      $("vidProg").style.width =
        Math.min(100, (videoStatus.t / videoStatus.d) * 100) + "%";
      var fm = function (s) {
        s = Math.floor(s);
        return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
      };
      $("vidTime").textContent =
        fm(videoStatus.t) +
        " / " +
        fm(videoStatus.d) +
        (videoStatus.ended
          ? " · จบแล้ว"
          : videoStatus.paused
            ? " · หยุดอยู่"
            : " · กำลังเล่น");
    }
  }

  renderUI();
  broadcast();
  setInterval(tick, 250);

  // เตือนก่อนปิดหน้าควบคุม (ไฟล์รูป/วิดีโอจะหาย)
  window.addEventListener("beforeunload", function (e) {
    if (images.length || videos.length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();
