/* ========================================
   store-lookup.js
   매장정보 시트에서 가맹점을 검색해서, 해당 매장의 회전 QR 화면(store-display.html)
   링크를 만들어줍니다. 이 앱에서는 가맹점을 새로 "등록"하지 않습니다 —
   매장정보 시트가 이미 회사의 매장 마스터 데이터입니다.
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

async function handleSearch() {
  const query = document.getElementById("search-input").value.trim();
  const resultsEl = document.getElementById("search-results");
  resultsEl.innerHTML = "";
  document.getElementById("kiosk-result").style.display = "none";

  if (!query) {
    showToast("검색어를 입력해주세요.");
    return;
  }

  resultsEl.innerHTML = `<p class="hint" style="text-align:center; padding:16px;">검색 중…</p>`;

  try {
    const result = await apiGet({ action: "searchStore", query });
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

    stores.forEach((store, idx) => {
      const row = document.createElement("div");
      row.className = "visit-row";
      row.style.cursor = "pointer";
      row.innerHTML = `
        <div>
          <div class="store-name">${escapeHtml(store.name)}</div>
          <div class="meta">${escapeHtml(store.storeId)} · ${escapeHtml(store.status)}</div>
        </div>
        <span class="status-pill ok">선택</span>
      `;
      row.onclick = () => selectStore(store);
      card.appendChild(row);
    });

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
