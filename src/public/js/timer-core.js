// public/js/timer-core.js — ใช้ร่วมกันระหว่างหน้าแสดงผลและหน้าควบคุม
// ดึงสถานะจาก server แล้วคำนวณเวลาที่เหลือด้วยนาฬิกาของ server (ไม่พึ่งนาฬิกาเครื่อง)
(function (global) {
  var POLL_MS = 1500;

  function TimerSync(onState, onNet) {
    this.state = null;
    this.offset = 0; // serverTime - localTime
    this.bestRtt = Infinity;
    this.onState = onState;
    this.onNet = onNet || function () {};
    this.failures = 0;
  }

  TimerSync.prototype.now = function () {
    return Date.now() + this.offset;
  };

  TimerSync.prototype.apply = function (data, t0, t1) {
    if (!data || typeof data.serverNow !== "number") return;
    var rtt = t1 - t0;
    // ใช้รอบที่ตอบเร็วที่สุดเป็นหลักในการเทียบเวลา (แม่นที่สุด)
    if (rtt <= this.bestRtt * 1.5 || this.state === null) {
      this.offset = data.serverNow - (t0 + rtt / 2);
      this.bestRtt = Math.min(this.bestRtt, rtt);
    }
    var prev = this.state;
    this.state = data;
    this.onState(data, prev);
  };

  TimerSync.prototype.poll = function () {
    var self = this;
    var t0 = Date.now();
    return fetch("/timer/state", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        self.failures = 0;
        self.onNet(true);
        self.apply(data, t0, Date.now());
      })
      .catch(function () {
        self.failures++;
        if (self.failures >= 2) self.onNet(false);
      });
  };

  TimerSync.prototype.start = function () {
    var self = this;
    self.poll();
    setInterval(function () {
      self.poll();
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) self.poll();
    });
  };

  function isTiming(s) {
    return (
      s.status === "running" ||
      s.status === "finished" ||
      s.status === "countdown"
    );
  }

  // เวลานับถอยหลังก่อนเริ่ม ที่เหลือ (ms)
  TimerSync.prototype.countdownRemaining = function () {
    var s = this.state;
    if (!s || !isTiming(s) || !s.startAt) return 0;
    return Math.max(0, s.startAt - this.now());
  };

  // เวลาที่เหลือ (ms) ตามสถานะปัจจุบัน
  TimerSync.prototype.remaining = function () {
    var s = this.state;
    if (!s) return 0;
    if (isTiming(s) && s.endAt) {
      if (this.countdownRemaining() > 0) return s.durationMs || 0;
      return Math.max(0, s.endAt - this.now());
    }
    if (s.status === "paused") return s.remainingMs || 0;
    return 0;
  };

  // สถานะที่แสดงจริง: idle | countdown | running | paused | finished
  TimerSync.prototype.phase = function () {
    var s = this.state;
    if (!s) return "idle";
    if (isTiming(s)) {
      if (this.countdownRemaining() > 0) return "countdown";
      return this.remaining() <= 0 ? "finished" : "running";
    }
    return s.status;
  };

  // แสดงแบบ ชั่วโมง:นาที:วินาที เช่น 00:29:58
  function formatMs(ms) {
    var total = Math.ceil(Math.max(0, ms) / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    return (
      ("0" + h).slice(-2) +
      ":" +
      ("0" + m).slice(-2) +
      ":" +
      ("0" + sec).slice(-2)
    );
  }

  function postAction(params) {
    var body = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      body.set(k, params[k]);
    });
    return fetch("/timer/action", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    }).then(function (r) {
      if (r.redirected)
        return { ok: false, error: "หมดเวลาเข้าสู่ระบบ กรุณา login ใหม่" };
      return r.json();
    });
  }

  global.RCLTimer = {
    TimerSync: TimerSync,
    formatMs: formatMs,
    postAction: postAction,
  };
})(window);
