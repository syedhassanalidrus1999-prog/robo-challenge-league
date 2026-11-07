// public/js/screen-common.js — ใช้ร่วมกันระหว่างหน้าควบคุมและหน้าแสดงผล
(function (g) {
  var CHANNEL = "rcl-screen-v1";

  function channel() {
    if (!("BroadcastChannel" in window)) {
      alert(
        "เบราว์เซอร์นี้ไม่รองรับ กรุณาใช้ Google Chrome หรือ Microsoft Edge",
      );
      return { postMessage: function () {}, onmessage: null };
    }
    return new BroadcastChannel(CHANNEL);
  }

  function pad(n) {
    return ("0" + n).slice(-2);
  }

  // ชั่วโมง:นาที:วินาที เช่น 00:29:58
  function formatMs(ms) {
    var total = Math.ceil(Math.max(0, ms) / 1000);
    return (
      pad(Math.floor(total / 3600)) +
      ":" +
      pad(Math.floor((total % 3600) / 60)) +
      ":" +
      pad(total % 60)
    );
  }

  // สถานะนาฬิกา: idle | countdown | running | paused | finished
  function timerPhase(t, now) {
    if (!t || t.status === "idle") return "idle";
    if (t.status === "paused") return "paused";
    if (t.startAt && now < t.startAt) return "countdown";
    return now >= t.endAt ? "finished" : "running";
  }

  function timerRemaining(t, now) {
    var p = timerPhase(t, now);
    if (p === "countdown") return t.durationMs || 0;
    if (p === "running") return Math.max(0, t.endAt - now);
    if (p === "paused") return t.remainingMs || 0;
    return 0;
  }

  function countdownRemaining(t, now) {
    if (!t || t.status !== "running" || !t.startAt) return 0;
    return Math.max(0, t.startAt - now);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  g.RCLScreen = {
    channel: channel,
    formatMs: formatMs,
    timerPhase: timerPhase,
    timerRemaining: timerRemaining,
    countdownRemaining: countdownRemaining,
    esc: esc,
  };
})(window);
