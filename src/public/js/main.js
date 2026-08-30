// ── Modal helpers ────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// ── Close modal on backdrop click ────────────
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) {
    e.target.style.display = "none";
  }
});

// ── Auto-hide alerts ─────────────────────────
document.querySelectorAll(".alert").forEach((el) => {
  setTimeout(() => {
    el.style.transition = "opacity .5s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 500);
  }, 4000);
});

// ── Teams: Edit Modal ────────────────────────
// ── Teams: Edit Modal ────────────────────────
function openEditModal(team) {
  document.getElementById("editForm").action =
    "/teams/" + team.id + "?_method=PUT&tier=" + team.tier;
  document.getElementById("editModalSub").textContent = "ID: " + team.id;
  document.getElementById("edit_name").value = team.name || "";
  document.getElementById("edit_institution").value = team.institution || "";
  document.getElementById("edit_tier").value = team.tier || "beginner";
  document.getElementById("edit_status").value = team.status || "pending";
  document.getElementById("edit_s1").value = team.student_1 || "";
  document.getElementById("edit_s2").value = team.student_2 || "";
  document.getElementById("edit_s3").value = team.student_3 || "";
  document.getElementById("edit_coach").value = team.coach || "";
  document.getElementById("edit_note").value = team.note || "";
  document.getElementById("edit_phone").value = team.phone || "";
  document.getElementById("edit_s1_dob").value = team.student_1_dob ? team.student_1_dob.split("T")[0] : "";
  document.getElementById("edit_s2_dob").value = team.student_2_dob ? team.student_2_dob.split("T")[0] : "";
  document.getElementById("edit_s3_dob").value = team.student_3_dob ? team.student_3_dob.split("T")[0] : "";
  openModal("editModal");
}

// ── Criteria: Add Modal ──────────────────────
function openAddModal(tier) {
  document.getElementById("add_tier").value = tier;
  var label =
    tier === "beginner"
      ? "Beginner"
      : tier === "intermediate"
        ? "Intermediate"
        : "Advance";
  document.getElementById("addModalSub").textContent = "รุ่น " + label;
  openModal("addModal");
}

// ── Criteria: Edit Modal ─────────────────────
function openCriteriaEditModal(id, name, maxScore, tier) {
  document.getElementById("editForm").action = "/board/criteria/" + id;
  document.getElementById("edit_name").value = name;
  document.getElementById("edit_max").value = maxScore;
  document.getElementById("edit_tier").value = tier;
  openModal("editModal");
}
