/* ========================================
   store-lookup.js
   매장정보 시트에서 가맹점을 검색해서, 해당 매장의 회전 QR 화면(store-display.html)
   링크를 만들어줍니다. 이 앱에서는 가맹점을 새로 "등록"하지 않습니다 —
   매장정보 시트가 이미 회사의 매장 마스터 데이터입니다.

   권한:
   - staff(담당자): 본인이 담당자로 등록된 매장만 검색됨 (필터 UI 자체가 안 보임)
   - leader/admin: 전체 매장 검색 가능 + 브랜드/팀/담당자로 필터링 가능
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

const isPrivileged = sv && (sv.role === "leader" || sv.role === "admin");

if (isPrivileged) {
  document.getElementById("filter-card").style.display = "block";
  document.getElementById("page-sub-text").textContent =
    "전체 매장을 검색하거나, 브랜드/팀/담당자로 필터링해서 찾을 수 있어요.";
  loadBrandOptions();
  loadTeamManagerOptions();
} else {
  document.getElementById("page-sub-text").textContent =
    "담당하고 계신 매장만 검색돼요. 검색어 없이 '검색' 버튼만 눌러도 담당 매장 전체가 나와요.";
}

// 팀 이름 표기 정리: 원본 값(예: "두찜1T", "1T" 등)에서 숫자만 뽑아 "N팀"으로 보여줍니다.
function normalizeTeamLabel(raw) {
  const match = String(raw).match(/(\d+)\s*T?$/i);
  return match ? `${match[1]}팀` : raw;
}

async function loadBrandOptions() {
  try {
    const result = await apiGet({ action: "getFilterOptions" });
    fillSelect("filter-brand", result.brands || []);
  } catch (e) {
    console.error(e);
  }
}

// 브랜드 선택값에 따라 팀 옵션을, 팀 선택값에 따라 담당자 옵션을 다시 불러옵니다.
async function loadTeamManagerOptions() {
  try {
    const result = await apiGet({
      action: "getFilterOptions",
      brand: document.getElementById("filter-brand").value,
      team: document.getElementById("filter-team").value
    });
    fillSelect("filter-team", result.teams || [], normalizeTeamLabel);
    fillSelect("filter-manager", result.managers || []);
  } catch (e) {
    console.error(e);
  }
}

function fillSelect(id, options, labelFn) {
  const select = document.getElementById(id);
  const previousValue = select.value;
  select.innerHTML = '<option value="">전체</option>';
  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt;
    el.textContent = labelFn ? labelFn(opt) : opt;
    select.appendChild(el);
  });
  if (options.includes(previousValue)) {
    select.value = previousValue;
  }
}

async function handleBrandFilterChange() {
  document.getElementById("filter-team").value = "";
  document.getElementById("filter-manager").value = "";
  await loadTeamManagerOptions();
  handleSearch();
}

async function handleTeamFilterChange() {
  document.getElementById("filter-manager").value = "";
  await loadTeamManagerOptions();
  handleSearch();
}

async function handleSearch() {
  const query = document.getElementById("search-input").value.trim();
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  document.getElementById("kiosk-result").style.display = "none";

  // 담당자는 검색어 없이도 "내 매장 전체"를 조회할 수 있음
  if (!isPrivileged && !query) {
    // 그대로 진행 (서버가 담당자 이름으로 강제 필터링)
  } else if (isPrivileged && !query) {
    const anyFilter =
      document.getElementById("filter-brand").value ||
      document.getElementById("filter-team").value ||
      document.getElementById("filter-manager").value;
    if (!anyFilter) {
      showToast("검색어를 입력하거나 필터를 하나 이상 선택해주세요.");
      return;
    }
  }

  resultsEl.innerHTML = `<p class="hint" style="text-align:center; padding:16px;">검색 중…</p>`;

  const params = { action: "searchStore", query, svName: sv.name, svRole: sv.role || "staff" };
  if (isPrivileged) {
    params.brand = document.getElementById("filter-brand").value;
    params.team = document.getElementById("filter-team").value;
    params.manager = document.getElementById("filter-manager").value;
  }

  try {
    const result = await apiGet(params);
    const stores = result.stores || [];

    if (stores.length === 0) {
      resultsEl.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">🔍</div>
          <div>검색 결과가 없습니다.<br/>운영중이 아닌 매장(폐점·양도완료)은 검색되지 않아요.</div>
        </div>`;
      return;
    }

    const card = document.createElement("div");
    card.className = "card";

    stores.forEach((store) => {
      const row = document.createElement("div");
      row.className = "visit-row";
      row.style.cursor = "pointer";
      const metaParts = [store.storeId, store.status];
      if (isPrivileged) {
        if (store.team) metaParts.push(store.team);
        if (store.manager) metaParts.push(store.manager);
      }
      row.innerHTML = `
        <div>
          <div class="store-name">${escapeHtml(store.name)}</div>
          <div class="meta">${escapeHtml(metaParts.filter(Boolean).join(" · "))}</div>
        </div>
        <span class="status-pill ok">선택</span>
      `;
      row.onclick = () => selectStore(store);
      card.appendChild(row);
    });

    resultsEl.innerHTML = "";
    resultsEl.appendChild(card);
  } catch (e) {
    console.error(e);
    resultsEl.innerHTML = "";
    showToast("검색에 실패했습니다. 네트워크를 확인해주세요.");
  }
}

function selectStore(store) {
  document.getElementById("search-results").innerHTML = "";
  document.getElementById("kiosk-result").style.display = "block";
  document.getElementById("kiosk-store-name").textContent = store.name;
  document.getElementById("kiosk-store-id").textContent = `코드: ${store.storeId} · ${store.status}`;

  const kioskUrl = new URL("store-display.html", window.location.href);
  kioskUrl.searchParams.set("storeId", store.storeId);
  const kioskUrlStr = kioskUrl.toString();

  document.getElementById("kiosk-link").value = kioskUrlStr;
  document.getElementById("kiosk-open-link").href = kioskUrlStr;
}

function copyKioskLink() {
  const input = document.getElementById("kiosk-link");
  input.select();
  navigator.clipboard.writeText(input.value)
    .then(() => showToast("링크를 복사했어요."))
    .catch(() => showToast("복사에 실패했어요. 직접 선택해서 복사해주세요."));
}

function resetSearch() {
  document.getElementById("kiosk-result").style.display = "none";
  document.getElementById("search-input").value = "";
  document.getElementById("search-input").focus();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// 엔터키로도 검색되게
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("search-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch();
    });
  }
});
