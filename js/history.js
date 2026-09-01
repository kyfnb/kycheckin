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

      const checkInWhen = v.checkInAt ? formatDateTime(v.checkInAt) : "-";
      const hasCheckOut = !!v.checkOutAt;
      const checkOutWhen = hasCheckOut ? formatDateTime(v.checkOutAt) : null;

      const checkInPhotoLink = v.checkInPhotoUrl
        ? `<a href="${v.checkInPhotoUrl}" target="_blank" style="color:var(--primary); text-decoration:underline;">입장사진</a>`
        : "";
      const checkOutPhotoLink = v.checkOutPhotoUrl
        ? `<a href="${v.checkOutPhotoUrl}" target="_blank" style="color:var(--primary); text-decoration:underline;">퇴장사진</a>`
        : "";
      const photoLinks = [checkInPhotoLink, checkOutPhotoLink].filter(Boolean).join(" · ");

      let statusClass, statusText;
      if (!hasCheckOut) {
        const hoursSinceCheckIn = (Date.now() - new Date(v.checkInAt).getTime()) / 3600000;
        if (hoursSinceCheckIn > 16) {
          statusClass = "fail";
          statusText = "⚠ 퇴장 누락";
        } else {
          statusClass = "pending";
          statusText = "⏳ 입장중";
        }
      } else if (v.checkInVerified && v.checkOutVerified) {
        statusClass = "ok";
        statusText = "✓ 확인됨";
      } else {
        statusClass = "fail";
        statusText = "⚠ 확인필요";
      }

      const metaLine1 = `입장 ${checkInWhen} (${v.checkInDistance}m)`;
      const metaLine2 = hasCheckOut
        ? `퇴장 ${checkOutWhen} (${v.checkOutDistance}m)${v.durationMinutes !== "" ? " · 체류 " + v.durationMinutes + "분" : ""}`
        : "퇴장 기록 없음";

      row.innerHTML = `
        <div>
          <div class="store-name">${escapeHtml(v.storeName)}</div>
          <div class="meta">${metaLine1}</div>
          <div class="meta">${metaLine2}</div>
          <div class="meta">${escapeHtml(v.svName)}${photoLinks ? " · " + photoLinks : ""}</div>
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
