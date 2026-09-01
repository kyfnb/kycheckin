/* ========================================
   history.js
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

let currentFilter = "mine";

function setFilter(filter) {
  currentFilter = filter;
  document.getElementById("filter-mine").className =
    filter === "mine" ? "btn btn-primary" : "btn btn-secondary";
  document.getElementById("filter-all").className =
    filter === "all" ? "btn btn-primary" : "btn btn-secondary";
  loadVisits();
}

async function loadVisits() {
  const listEl = document.getElementById("visit-list");
  const emptyEl = document.getElementById("empty-state");
  listEl.innerHTML = "";

  try {
    const result = await apiGet({
      action: "getVisits",
      svId: sv.email,
      filter: currentFilter
    });

    const visits = result.visits || [];

    if (visits.length === 0) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    visits.forEach((v) => {
      const row = document.createElement("div");
      row.className = "visit-row";

      const statusClass = v.verified ? "ok" : "fail";
      const statusText = v.verified ? "✓ 확인됨" : "⚠ 위치불일치";
      const when = v.visitedAt ? formatDateTime(v.visitedAt) : "-";
      const photoLink = v.photoUrl
        ? `<a href="${v.photoUrl}" target="_blank" style="color:var(--primary); font-size:12px; text-decoration:underline;">사진보기</a>`
        : "";

      row.innerHTML = `
        <div>
          <div class="store-name">${escapeHtml(v.storeName)}</div>
          <div class="meta">${when} · ${escapeHtml(v.svName)} · ${v.distanceMeters}m ${photoLink ? "· " + photoLink : ""}</div>
        </div>
        <span class="status-pill ${statusClass}">${statusText}</span>
      `;
      listEl.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    showToast("이력을 불러오지 못했습니다. API URL 설정을 확인해주세요.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

setFilter("mine");
