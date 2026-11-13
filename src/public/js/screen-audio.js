// public/js/screen-audio.js — แท็บ "เสียง / เพลง" ในหน้าควบคุมจอแสดงผล
// เล่นเสียงจากหน้าควบคุมโดยตรง (ออกลำโพงเครื่องเดียวกับจอแสดงผล)
// ไฟล์เก็บใน IndexedDB ของเบราว์เซอร์เครื่องนี้ → refresh แล้วยังอยู่ ไม่อัปโหลดขึ้นเว็บ
(function () {
  if (!document.getElementById("bgmList")) return; // control.ejs ยังไม่มีแท็บเสียง

  var S = window.RCLScreen || {};
  var $ = function (id) {
    return document.getElementById(id);
  };
  var esc =
    S.esc ||
    function (s) {
      return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    };

  // ======================================================================
  // ตั้งค่า
  // ======================================================================
  var SET_STORE = "rcl-audio-settings";
  var settings = {
    bgmVol: 0.6,
    sfxVol: 1,
    loop: "all", // all = วนทั้งรายการ · one = วนเพลงเดียว · list = เล่นจนจบรายการ · single = เพลงเดียวแล้วหยุด
    fade: true,
    duck: true,
    duckLevel: 0.25,
  };
  try {
    var saved = JSON.parse(localStorage.getItem(SET_STORE) || "null");
    if (saved)
      Object.keys(saved).forEach(function (k) {
        settings[k] = saved[k];
      });
  } catch (e) {}

  function saveSettings() {
    try {
      localStorage.setItem(SET_STORE, JSON.stringify(settings));
    } catch (e) {}
  }

  // ======================================================================
  // ข้อความแจ้ง (ใช้กล่องเดียวกับหน้าควบคุม)
  // ======================================================================
  var toastTimer = null;
  function toast(text, ok) {
    var el = $("ctStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "ct-status " + (ok ? "ok" : "bad");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = "ct-status";
    }, 2600);
  }

  // ======================================================================
  // IndexedDB
  // ======================================================================
  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
          reject(new Error("no indexedDB"));
          return;
        }
        var req = indexedDB.open("rcl-audio", 1);
        req.onupgradeneeded = function () {
          req.result.createObjectStore("files", { keyPath: "id" });
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    }
    return dbPromise;
  }

  function dbReq(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var store = d.transaction("files", mode).objectStore("files");
        var r = fn(store);
        r.onsuccess = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }
  function dbAll() {
    return dbReq("readonly", function (s) {
      return s.getAll();
    });
  }
  function dbPut(rec) {
    return dbReq("readwrite", function (s) {
      return s.put(rec);
    });
  }
  function dbDel(id) {
    return dbReq("readwrite", function (s) {
      return s.delete(id);
    });
  }

  // ======================================================================
  // รายการไฟล์
  // ======================================================================
  var bgm = []; // { id, name, url, order }
  var sfx = [];

  function listOf(kind) {
    return kind === "bgm" ? bgm : sfx;
  }

  function cleanName(n) {
    return String(n || "")
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .slice(0, 80);
  }

  function addFiles(fileList, kind) {
    var base = Date.now();
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var rec = {
        id:
          kind +
          "-" +
          base.toString(36) +
          "-" +
          i +
          "-" +
          Math.random().toString(36).slice(2, 6),
        kind: kind,
        name: cleanName(f.name),
        blob: f,
        order: base + i,
      };
      listOf(kind).push({
        id: rec.id,
        name: rec.name,
        url: URL.createObjectURL(f),
        order: rec.order,
      });
      dbPut(rec).catch(function () {
        toast("บันทึกไฟล์ในเครื่องไม่ได้ — ใช้ได้จนกว่าจะ refresh", false);
      });
    }
    render();
    toast("เพิ่ม " + fileList.length + " ไฟล์แล้ว", true);
  }

  function removeFile(kind, id) {
    var list = listOf(kind);
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    if (idx < 0) return;
    if (!confirm('ลบ "' + list[idx].name + '" ?')) return;

    if (kind === "bgm") {
      if (idx === curIdx) {
        stopNow();
        music.removeAttribute("src");
        music.load();
        curIdx = -1;
      } else if (idx < curIdx) {
        curIdx--;
      }
    } else {
      stopSfx(id);
    }
    URL.revokeObjectURL(list[idx].url);
    list.splice(idx, 1);
    dbDel(id).catch(function () {});
    render();
  }

  // ======================================================================
  // เพลงพื้นหลัง
  // ======================================================================
  var music = new Audio();
  music.preload = "auto";
  var curIdx = -1;
  var rampTimer = null;
  var pausing = false;

  var manualDuck = false;
  var voiceDuck = false;
  var voiceTimer = null;
  var duckOn = false;

  function clamp(v) {
    return Math.max(0, Math.min(1, v));
  }

  function targetVol() {
    return clamp(settings.bgmVol * (duckOn ? settings.duckLevel : 1));
  }

  function ramp(to, ms, done) {
    clearInterval(rampTimer);
    var from = music.volume;
    var steps = Math.max(1, Math.round(ms / 40));
    var k = 0;
    rampTimer = setInterval(function () {
      k++;
      music.volume = clamp(from + (to - from) * (k / steps));
      if (k >= steps) {
        clearInterval(rampTimer);
        rampTimer = null;
        if (done) done();
      }
    }, 40);
  }

  function playErr() {
    toast("เล่นไฟล์นี้ไม่ได้ — ลองใช้ MP3", false);
    render();
  }

  function playIdx(i) {
    var m = bgm[i];
    if (!m) return;
    pausing = false;
    curIdx = i;
    music.src = m.url;
    music.loop = settings.loop === "one";
    music.volume = settings.fade ? 0 : targetVol();
    music
      .play()
      .then(function () {
        if (settings.fade) ramp(targetVol(), 1500);
        render();
      })
      .catch(playErr);
    render();
  }

  function resume() {
    pausing = false;
    music.volume = settings.fade ? 0 : targetVol();
    music
      .play()
      .then(function () {
        if (settings.fade) ramp(targetVol(), 800);
        render();
      })
      .catch(playErr);
  }

  function pauseMusic() {
    if (music.paused || pausing) return;
    if (settings.fade) {
      pausing = true;
      ramp(0, 800, function () {
        pausing = false;
        music.pause();
        render();
      });
    } else {
      music.pause();
      render();
    }
  }

  function stopNow() {
    clearInterval(rampTimer);
    rampTimer = null;
    pausing = false;
    music.pause();
    try {
      music.currentTime = 0;
    } catch (e) {}
    render();
  }

  function stopMusic() {
    if (!music.paused && settings.fade) {
      pausing = true;
      ramp(0, 1000, stopNow);
    } else {
      stopNow();
    }
  }

  function togglePlay() {
    if (curIdx < 0 || !bgm[curIdx]) {
      if (bgm.length) playIdx(0);
      else toast("ยังไม่ได้เพิ่มเพลง", false);
      return;
    }
    if (music.paused || pausing) resume();
    else pauseMusic();
  }

  function step(delta) {
    if (!bgm.length) return;
    var i = curIdx < 0 ? 0 : (curIdx + delta + bgm.length) % bgm.length;
    playIdx(i);
  }

  music.addEventListener("ended", function () {
    var n = bgm.length;
    if (settings.loop === "all" && n) {
      playIdx((curIdx + 1) % n);
    } else if (settings.loop === "list" && curIdx + 1 < n) {
      playIdx(curIdx + 1);
    } else {
      render();
    }
  });

  function fmt(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    s = Math.floor(s);
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  music.addEventListener("timeupdate", function () {
    var d = music.duration;
    $("auProg").style.width = d
      ? Math.min(100, (music.currentTime / d) * 100) + "%"
      : "0";
    $("auTime").textContent =
      curIdx >= 0 ? fmt(music.currentTime) + " / " + fmt(d) : "—";
  });

  $("auSeek").addEventListener("click", function (e) {
    if (!music.duration) return;
    var r = this.getBoundingClientRect();
    music.currentTime = clamp((e.clientX - r.left) / r.width) * music.duration;
  });

  // ---------------- ลดเสียงเพลง (ducking) ----------------
  function updateDuck() {
    var want =
      manualDuck || (settings.duck && (voiceDuck || sfxPlaying.length > 0));
    if (want !== duckOn) {
      duckOn = want;
      if (!music.paused && !pausing) ramp(targetVol(), 400);
    }
    $("auDuck").classList.toggle("on", manualDuck);
  }

  // ฟังคำสั่งพูดจากหน้าควบคุม → ลดเสียงเพลงระหว่าง AI พูด
  var ch = S.channel ? S.channel() : null;
  if (ch) {
    ch.addEventListener("message", function (e) {
      var m = e.data || {};
      if (m.type !== "speak") return;
      clearTimeout(voiceTimer);
      if (m.text) {
        voiceDuck = true;
        voiceTimer = setTimeout(
          function () {
            voiceDuck = false;
            updateDuck();
          },
          1500 + String(m.text).length * 120,
        );
      } else {
        voiceDuck = false;
      }
      updateDuck();
    });
  }

  // ======================================================================
  // เอฟเฟกต์เสียง
  // ======================================================================
  var sfxPlaying = []; // { id, a }

  function isSfxPlaying(id) {
    return sfxPlaying.some(function (p) {
      return p.id === id;
    });
  }

  function stopSfx(id) {
    sfxPlaying = sfxPlaying.filter(function (p) {
      if (id && p.id !== id) return true;
      p.a.pause();
      return false;
    });
    updateDuck();
    render();
  }

  function playSfx(i) {
    var m = sfx[i];
    if (!m) return;
    if (isSfxPlaying(m.id)) {
      stopSfx(m.id); // กดซ้ำ = หยุด
      return;
    }
    var a = new Audio(m.url);
    a.volume = clamp(settings.sfxVol);
    var entry = { id: m.id, a: a };
    sfxPlaying.push(entry);
    var done = function () {
      sfxPlaying = sfxPlaying.filter(function (p) {
        return p !== entry;
      });
      updateDuck();
      render();
    };
    a.addEventListener("ended", done);
    a.play().catch(function () {
      done();
      toast("เล่นไฟล์นี้ไม่ได้ — ลองใช้ MP3", false);
    });
    updateDuck();
    render();
  }

  // ======================================================================
  // วาดหน้าจอ
  // ======================================================================
  function render() {
    var playing = !music.paused && !pausing;

    $("bgmList").innerHTML =
      bgm
        .map(function (m, i) {
          var on = i === curIdx;
          return (
            '<div class="au-row' +
            (on ? " on" : "") +
            '">' +
            '<span class="no">' +
            (on && playing ? '<i class="ti ti-volume"></i>' : i + 1) +
            "</span>" +
            '<span class="nm" title="' +
            esc(m.name) +
            '">' +
            esc(m.name) +
            "</span>" +
            '<button type="button" class="ct-btn" data-bplay="' +
            i +
            '" title="เล่นเพลงนี้"><i class="ti ti-player-play"></i></button>' +
            '<button type="button" class="au-x" data-bdel="' +
            esc(m.id) +
            '" title="ลบ"><i class="ti ti-x"></i></button>' +
            "</div>"
          );
        })
        .join("") || '<p class="ct-small">ยังไม่ได้เพิ่มเพลง</p>';

    $("sfxList").innerHTML =
      sfx
        .map(function (m, i) {
          var on = isSfxPlaying(m.id);
          return (
            '<div class="au-tile">' +
            '<button type="button" class="ct-btn sfx' +
            (on ? " playing" : "") +
            '" data-splay="' +
            i +
            '">' +
            '<i class="ti ' +
            (on ? "ti-player-stop" : "ti-bell-ringing") +
            '"></i> ' +
            esc(m.name) +
            "</button>" +
            '<button type="button" class="au-x" data-sdel="' +
            esc(m.id) +
            '" title="ลบ"><i class="ti ti-x"></i></button>' +
            "</div>"
          );
        })
        .join("") || '<p class="ct-small">ยังไม่ได้เพิ่มเอฟเฟกต์เสียง</p>';

    $("auPlay").innerHTML = playing
      ? '<i class="ti ti-player-pause"></i> หยุดชั่วคราว'
      : '<i class="ti ti-player-play"></i> เล่น';

    var cur = bgm[curIdx];
    $("auNow").textContent = cur
      ? (playing ? "กำลังเล่น: " : "หยุดอยู่: ") + cur.name
      : "ไม่ได้เล่น";
    if (curIdx < 0) {
      $("auProg").style.width = "0";
      $("auTime").textContent = "—";
    }
  }

  // ======================================================================
  // ปุ่ม / ตัวเลือก
  // ======================================================================
  $("bgmFiles").addEventListener("change", function () {
    if (this.files.length) addFiles(this.files, "bgm");
    this.value = "";
  });
  $("sfxFiles").addEventListener("change", function () {
    if (this.files.length) addFiles(this.files, "sfx");
    this.value = "";
  });

  $("bgmList").addEventListener("click", function (e) {
    var p = e.target.closest("[data-bplay]");
    if (p) {
      playIdx(parseInt(p.getAttribute("data-bplay"), 10));
      return;
    }
    var d = e.target.closest("[data-bdel]");
    if (d) removeFile("bgm", d.getAttribute("data-bdel"));
  });

  $("sfxList").addEventListener("click", function (e) {
    var p = e.target.closest("[data-splay]");
    if (p) {
      playSfx(parseInt(p.getAttribute("data-splay"), 10));
      return;
    }
    var d = e.target.closest("[data-sdel]");
    if (d) removeFile("sfx", d.getAttribute("data-sdel"));
  });

  $("auPlay").addEventListener("click", togglePlay);
  $("auPrev").addEventListener("click", function () {
    step(-1);
  });
  $("auNext").addEventListener("click", function () {
    step(1);
  });
  $("auStop").addEventListener("click", stopMusic);
  $("auDuck").addEventListener("click", function () {
    manualDuck = !manualDuck;
    updateDuck();
  });
  $("sfxStop").addEventListener("click", function () {
    stopSfx(null);
  });

  // ค่าเริ่มต้นของตัวควบคุม
  $("auLoop").value = settings.loop;
  $("auFade").checked = !!settings.fade;
  $("auVol").value = settings.bgmVol;
  $("sfxVol").value = settings.sfxVol;
  $("auDuckAuto").checked = !!settings.duck;
  $("auDuckLevel").value = String(settings.duckLevel);

  function showVol() {
    $("auVolVal").textContent = Math.round(settings.bgmVol * 100) + "%";
    $("sfxVolVal").textContent = Math.round(settings.sfxVol * 100) + "%";
  }
  showVol();

  $("auLoop").addEventListener("change", function () {
    settings.loop = this.value;
    music.loop = settings.loop === "one";
    saveSettings();
  });
  $("auFade").addEventListener("change", function () {
    settings.fade = this.checked;
    saveSettings();
  });
  $("auVol").addEventListener("input", function () {
    settings.bgmVol = parseFloat(this.value);
    if (!pausing) {
      clearInterval(rampTimer);
      rampTimer = null;
      music.volume = targetVol();
    }
    showVol();
    saveSettings();
  });
  $("sfxVol").addEventListener("input", function () {
    settings.sfxVol = parseFloat(this.value);
    sfxPlaying.forEach(function (p) {
      p.a.volume = clamp(settings.sfxVol);
    });
    showVol();
    saveSettings();
  });
  $("auDuckAuto").addEventListener("change", function () {
    settings.duck = this.checked;
    updateDuck();
    saveSettings();
  });
  $("auDuckLevel").addEventListener("change", function () {
    settings.duckLevel = parseFloat(this.value);
    if (duckOn && !music.paused && !pausing) ramp(targetVol(), 300);
    saveSettings();
  });

  // ======================================================================
  // โหลดไฟล์ที่เคยเพิ่มไว้
  // ======================================================================
  render();
  dbAll()
    .then(function (recs) {
      recs
        .sort(function (a, b) {
          return a.order - b.order;
        })
        .forEach(function (r) {
          listOf(r.kind).push({
            id: r.id,
            name: r.name,
            url: URL.createObjectURL(r.blob),
            order: r.order,
          });
        });
      render();
    })
    .catch(function () {
      toast(
        "เบราว์เซอร์นี้เก็บไฟล์เสียงไม่ได้ — ต้องเลือกไฟล์ใหม่ทุกครั้งที่ refresh",
        false,
      );
    });
})();
