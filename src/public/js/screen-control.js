// public/js/screen-control.js — หน้าควบคุมจอแสดงผล (จอโน้ตบุ๊ก)
// เป็นเจ้าของสถานะทั้งหมด แล้วส่งให้หน้าแสดงผลผ่าน BroadcastChannel
(function () {
  var S = window.RCLScreen;
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
    state.timer = {
      status: "running",
      label: label || "จับเวลา",
      durationMs: ms,
      startAt: cd ? now + cd * 1000 : null,
      endAt: now + cd * 1000 + ms,
      remainingMs: 0,
    };
    setScene("timer");
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
    if (p === "countdown") {
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
      if (p === "countdown") {
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
  }

  function tick() {
    var now = Date.now();
    var t = state.timer;
    var p = S.timerPhase(t, now);
    $("tmNow").textContent = S.formatMs(S.timerRemaining(t, now));
    $("tmState").textContent =
      p === "countdown"
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
    $("tmPause").disabled = p !== "running" && p !== "countdown";
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
