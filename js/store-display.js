/* ========================================
   store-display.js
   URL 예: store-display.html?storeId=GN-001

   QR에는 { storeId, w } 를 담습니다. w는 "30초 단위 시간 창 번호"로,
   서버(Apps Script)가 스캔 시점의 w와 비교해서 오래된 QR(사진 캡처 등)을
   걸러냅니다. 매장별 비밀값 없이도 "지금 이 순간 화면에 떠 있는 QR인지"를
   충분히 검증할 수 있어요.
   ======================================== */

const WINDOW_SECONDS = 30;

function getWindowIndex() {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

function getStoreIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("storeId");
}

let qrRenderer = null;

function renderQr(storeId) {
  const payload = JSON.stringify({ storeId, w: getWindowIndex() });

  if (!qrRenderer) {
    document.getElementById("qr-code-box").innerHTML = "";
    qrRenderer = new QRCode(document.getElementById("qr-code-box"), {
      text: payload,
      width: 260,
      height: 260
    });
  } else {
    qrRenderer.clear();
    qrRenderer.makeCode(payload);
  }
}

function startCountdown() {
  const fill = document.getElementById("timer-fill");

  function tick() {
    const msIntoWindow = Date.now() % (WINDOW_SECONDS * 1000);
    const remainingRatio = 1 - msIntoWindow / (WINDOW_SECONDS * 1000);
    fill.style.width = `${Math.max(0, remainingRatio * 100)}%`;
  }

  tick();
  setInterval(tick, 250);
}

async function init() {
  const storeId = getStoreIdFromUrl();

  if (!storeId) {
    document.getElementById("store-loading").textContent =
      "매장 코드가 없습니다. store-lookup.html에서 다시 링크를 받아주세요.";
    return;
  }

  let storeName = storeId;
  try {
    const result = await apiGet({ action: "getStore", storeId });
    if (result.exists) {
      storeName = result.name;
    } else if (result.excluded) {
      document.getElementById("store-loading").textContent =
        `이 가맹점은 현재 "${result.status}" 상태라 QR 화면을 표시할 수 없습니다.`;
      return;
    } else {
      document.getElementById("store-loading").textContent =
        "매장정보에서 이 코드를 찾을 수 없습니다. store-lookup.html에서 다시 확인해주세요.";
      return;
    }
  } catch (e) {
    console.error(e);
    // 이름 조회 실패해도 QR 표시는 계속 진행 (storeId로 대체)
  }

  document.getElementById("store-loading").style.display = "none";
  document.getElementById("kiosk-content").style.display = "block";
  document.getElementById("kiosk-store-name").textContent = storeName;

  renderQr(storeId);
  startCountdown();

  // 다음 30초 경계에 정확히 맞춰서 첫 갱신, 이후 30초마다 반복
  const msUntilNextWindow = WINDOW_SECONDS * 1000 - (Date.now() % (WINDOW_SECONDS * 1000));
  setTimeout(() => {
    renderQr(storeId);
    setInterval(() => renderQr(storeId), WINDOW_SECONDS * 1000);
  }, msUntilNextWindow);
}

init();
