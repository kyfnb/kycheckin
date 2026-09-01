/* ========================================
   history.js
   3개 뷰: 목록(기간 필터) / 캘린더 / 미방문 매장
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

const isPrivilegedHistory = sv && (sv.role === "leader" || sv.role === "admin");
const isAdminUser = sv && sv.role === "admin";

// 담당자(staff)는 "내 방문만"만 볼 수 있고, "전체 보기" 자체가 안 보입니다.
if (!isPrivilegedHistory) {
  document.getElementById("filter-all").style.display = "none";
}

let currentView = "list";
let currentFilter = "mine";
let currentPeriod = "1m";
let calendarMonth = new Date(); // 캘린더에서 보고 있는 달

/* ---------- 뷰 전환 ---------- */

function setView(view) {
  currentView = view;

  document.getElementById("list-view").style.display = view === "list" ? "block" : "none";
  document.getElementById("calendar-view").style.display = view === "calendar" ? "block" : "none";
  document.getElementById("unvisited-view").style.display = view === "unvisited" ? "block" : "none";

  document.getElementById("view-list-btn").className = view === "list" ? "btn btn-primary" : "btn btn-secondary";
  document.getElementById("view-calendar-btn").className = view === "calendar" ? "btn btn-primary" : "btn btn-secondary";
  document.getElementById("view-unvisited-btn").className = view === "unvisited" ? "btn btn-primary" : "btn btn-secondary";

  if (view === "list") loadVisits();
  if (view === "calendar") loadCalendar();
  if (view === "unvisited") loadUnvisited();
}

/* ---------- 1) 목록 뷰 ---------- */

function setFilter(filter) {
  currentFilter = filter;
  document.getElementById("filter-mine").className =
    filter === "mine" ? "btn btn-primary" : "btn btn-secondary";
  document.getElementById("filter-all").className =
    filter === "all" ? "btn btn-primary" : "btn btn-secondary";
  loadVisits();
}

function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll(".period-btn").forEach((b) => {
    b.className = b.dataset.period === period ? "btn btn-primary period-btn" : "btn btn-secondary period-btn";
  });
  document.getElementById("custom-date-range").style.display = period === "custom" ? "block" : "none";
  if (period !== "custom") loadVisits();
}

function applyCustomRange() {
  if (currentPeriod === "custom") loadVisits();
}

// 현재 선택된 기간을 { start: "YYYY-MM-DD", end: "YYYY-MM-DD" } 형태로 반환
// 직접입력인데 아직 둘 다 안 채워졌으면 null 반환
function getPeriodRange() {
  const end = new Date();
  let start;

  if (currentPeriod === "1m") {
    start = new Date();
    start.setMonth(start.getMonth() - 1);
  } else if (currentPeriod === "3m") {
    start = new Date();
    start.setMonth(start.getMonth() - 3);
  } else if (currentPeriod === "custom") {
    const s = document.getElementById("date-start").value;
    const e = document.getElementById("date-end").value;
    if (!s || !e) return null;
    return { start: s, end: e };
  }

  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

function toDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function loadVisits() {
  const listEl = document.getElementById("visit-list");
  const emptyEl = document.getElementById("empty-state");

  const range = getPeriodRange();
  if (!range) return; // 직접입력인데 아직 날짜를 다 안 골랐으면 대기

  listEl.innerHTML = "";

  try {
    const result = await apiGet({
      action: "getVisits",
      svId: sv.email,
      filter: currentFilter,
      startDate: range.start,
      endDate: range.end
    });

    const visits = result.visits || [];

    if (visits.length === 0) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    visits.forEach((v) => listEl.appendChild(renderVisitRow(v)));
  } catch (e) {
    console.error(e);
    showToast("이력을 불러오지 못했습니다. API URL 설정을 확인해주세요.");
  }
}

function renderVisitRow(v) {
  const wrapper = document.createElement("div");
  wrapper.className = "visit-row-wrapper";

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
    ? `퇴장 ${checkOutWhen}${v.durationMinutes !== "" ? " · 체류 " + v.durationMinutes + "분" : ""}`
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

  wrapper.appendChild(row);

  if (isAdminUser && v.visitId) {
    wrapper.appendChild(renderAdminActions(v));
  }

  return wrapper;
}

// 관리자 전용: 확인여부 전환 + 삭제 버튼
function renderAdminActions(v) {
  const bar = document.createElement("div");
  bar.className = "admin-action-bar";

  const toggleInBtn = document.createElement("button");
  toggleInBtn.className = "btn btn-ghost admin-action-btn";
  toggleInBtn.textContent = v.checkInVerified ? "입장확인 취소" : "입장확인 처리";
  toggleInBtn.onclick = () => adminToggleVerified(v, "checkIn");

  const buttons = [toggleInBtn];

  if (v.checkOutAt) {
    const toggleOutBtn = document.createElement("button");
    toggleOutBtn.className = "btn btn-ghost admin-action-btn";
    toggleOutBtn.textContent = v.checkOutVerified ? "퇴장확인 취소" : "퇴장확인 처리";
    toggleOutBtn.onclick = () => adminToggleVerified(v, "checkOut");
    buttons.push(toggleOutBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-ghost admin-action-btn admin-action-danger";
  deleteBtn.textContent = "삭제";
  deleteBtn.onclick = () => adminDeleteVisit(v);
  buttons.push(deleteBtn);

  buttons.forEach((b) => bar.appendChild(b));
  return bar;
}

async function adminToggleVerified(v, which) {
  const payload = {
    action: "updateVisitVerified",
    requesterEmail: sv.email,
    visitId: v.visitId
  };
  if (which === "checkIn") payload.checkInVerified = !v.checkInVerified;
  if (which === "checkOut") payload.checkOutVerified = !v.checkOutVerified;

  try {
    const result = await apiPost(payload);
    if (result.success) {
      showToast("수정했어요.");
      refreshCurrentView();
    } else {
      showToast(result.error || "수정에 실패했습니다.");
    }
  } catch (e) {
    console.error(e);
    showToast("수정 중 오류가 발생했습니다.");
  }
}

async function adminDeleteVisit(v) {
  if (!confirm(`"${v.storeName}" 방문 기록을 정말 삭제할까요? 되돌릴 수 없어요.`)) return;

  try {
    const result = await apiPost({ action: "deleteVisit", requesterEmail: sv.email, visitId: v.visitId });
    if (result.success) {
      showToast("삭제했어요.");
      refreshCurrentView();
    } else {
      showToast(result.error || "삭제에 실패했습니다.");
    }
  } catch (e) {
    console.error(e);
    showToast("삭제 중 오류가 발생했습니다.");
  }
}

function refreshCurrentView() {
  if (currentView === "list") loadVisits();
  if (currentView === "calendar") loadCalendar();
}

/* ---------- 2) 캘린더 뷰 ---------- */

async function loadCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth(); // 0-indexed
  document.getElementById("calendar-month-label").textContent = `${year}년 ${month + 1}월`;
  document.getElementById("calendar-day-detail").style.display = "none";

  const startDate = toDateInputValue(new Date(year, month, 1));
  const endDate = toDateInputValue(new Date(year, month + 1, 0));

  let visits = [];
  try {
    const result = await apiGet({
      action: "getVisits",
      svId: sv.email,
      filter: currentFilter,
      startDate,
      endDate
    });
    visits = result.visits || [];
  } catch (e) {
    console.error(e);
    showToast("캘린더 데이터를 불러오지 못했습니다.");
  }

  renderCalendarGrid(year, month, visits);
}

function renderCalendarGrid(year, month, visits) {
  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  ["일", "월", "화", "수", "목", "금", "토"].forEach((w) => {
    const el = document.createElement("div");
    el.className = "calendar-weekday-label";
    el.textContent = w;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1).getDay(); // 0=일요일
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const visitsByDay = {};
  visits.forEach((v) => {
    const d = new Date(v.checkInAt);
    const dayKey = d.getDate();
    if (!visitsByDay[dayKey]) visitsByDay[dayKey] = [];
    visitsByDay[dayKey].push(v);
  });

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day-cell empty";
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    const dayVisits = visitsByDay[day] || [];
    cell.className = "calendar-day-cell" + (dayVisits.length > 0 ? " has-visit" : "");
    cell.innerHTML =
      `<div>${day}</div>` + (dayVisits.length > 0 ? `<div class="visit-dot"></div>` : "");
    cell.onclick = () => showDayDetail(year, month, day, dayVisits);
    grid.appendChild(cell);
  }
}

function showDayDetail(year, month, day, dayVisits) {
  const detailCard = document.getElementById("calendar-day-detail");
  const title = document.getElementById("calendar-day-title");
  const list = document.getElementById("calendar-day-list");

  title.textContent = `${year}년 ${month + 1}월 ${day}일`;

  if (dayVisits.length === 0) {
    list.innerHTML = `<p class="hint">이 날은 방문 기록이 없어요.</p>`;
  } else {
    list.innerHTML = "";
    dayVisits.forEach((v) => list.appendChild(renderVisitRow(v)));
  }
  detailCard.style.display = "block";
}

function changeCalendarMonth(delta) {
  calendarMonth.setMonth(calendarMonth.getMonth() + delta);
  loadCalendar();
}

/* ---------- 3) 미방문 매장 뷰 ---------- */

async function loadUnvisited() {
  const listEl = document.getElementById("unvisited-list");
  const emptyEl = document.getElementById("unvisited-empty");
  const statsCard = document.getElementById("unvisited-stats");
  listEl.innerHTML = "";

  try {
    const result = await apiGet({ action: "getUnvisitedStores", svName: sv.name });
    const stores = result.stores || [];

    statsCard.style.display = "block";
    document.getElementById("stat-total").textContent = result.totalAssigned ?? 0;
    document.getElementById("stat-visited").textContent = result.visitedCount ?? 0;
    document.getElementById("stat-unvisited").textContent = result.unvisitedCount ?? stores.length;

    if (stores.length === 0) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    stores.forEach((store) => {
      const row = document.createElement("div");
      row.className = "visit-row";
      const lastVisitText = store.lastVisitAt
        ? `마지막 방문 ${formatDateTime(store.lastVisitAt)}`
        : "방문 기록 없음";

      row.innerHTML = `
        <div>
          <div class="store-name">${escapeHtml(store.name)}</div>
          <div class="meta">${escapeHtml(lastVisitText)} · ${escapeHtml(store.status)}</div>
        </div>
        <span class="status-pill fail">⚠ 미방문</span>
      `;
      listEl.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    showToast("미방문 매장 목록을 불러오지 못했습니다.");
  }
}

/* ---------- 공통 ---------- */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// 초기 렌더
document.getElementById("filter-mine").className = "btn btn-primary";
document.getElementById("filter-all").className = "btn btn-secondary";
document.querySelector('.period-btn[data-period="1m"]').className = "btn btn-primary period-btn";
setView("list");
