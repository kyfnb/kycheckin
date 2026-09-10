/* ========================================
   공통 유틸 함수
   ======================================== */

// ---- SV(담당자) 로그인 세션 관리 ----
// 이름/이메일로 접근을 요청하고, 관리자가 Staff 시트에서 승인한 사용자만 세션이 생성됩니다.
// 세션 형태: { name: "홍길동", email: "hong@company.com" }
function getCurrentSV() {
  const raw = localStorage.getItem("sv_session");
  return raw ? JSON.parse(raw) : null;
}

function setCurrentSV(sv) {
  localStorage.setItem("sv_session", JSON.stringify(sv));
}

function logoutSV() {
  localStorage.removeItem("sv_session");
  window.location.href = "index.html";
}

// 로그인 안 된 상태로 다른 페이지 접근 시 로그인 화면으로 이동
function requireLogin() {
  const sv = getCurrentSV();
  if (!sv) {
    window.location.href = "index.html";
    return null;
  }
  return sv;
}

// ---- 거리 계산 (Haversine 공식) ----
// 두 위경도 좌표 사이의 거리를 미터(m) 단위로 반환
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 지구 반지름(m)
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---- 토스트 메시지 ----
function showToast(message, duration = 2500) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), duration);
}

// ---- 날짜 포맷 (Date 객체 또는 ISO 문자열 모두 허용) ----
function formatDateTime(input) {
  const d = input instanceof Date ? input : new Date(input);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Apps Script 웹앱(API) 호출 ----
// 조회(GET): action과 파라미터를 쿼리스트링으로 전달
async function apiGet(params) {
  const url = new URL(API_URL);
  Object.keys(params).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, params[key]);
    }
  });

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API 오류 (${res.status})`);
  return res.json();
}

// 저장(POST): body에 JSON 전달
// ⚠️ Content-Type을 "text/plain"으로 보내는 이유:
//    Apps Script 웹앱은 application/json 요청 시 발생하는 사전 확인(preflight) 요청을
//    제대로 처리하지 못해 CORS 오류가 날 수 있습니다. text/plain으로 보내면 이 문제를 피할 수 있고,
//    Apps Script 쪽에서는 어차피 JSON.parse로 직접 해석하므로 데이터 내용은 동일하게 전달됩니다.
async function apiPost(data) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`API 오류 (${res.status})`);
  return res.json();
}

// ---- 방문 허용 반경(m). 필요에 따라 조정하세요 ----
const VISIT_RADIUS_METERS = 100;

/* ========================================
   "점검중" 상태 배너 (활성 세션 표시)
   입장을 찍으면 켜지고, 퇴장을 찍으면 꺼집니다.
   앱 안 어느 화면에 있든 상단에 계속 보여서, 지금 방문 중인 매장을
   바로 확인할 수 있게 해줍니다. 탭하면 스캔 화면(퇴장 찍기)으로 이동해요.
   ======================================== */

const ACTIVE_SESSION_KEY = "active_session";

function setActiveSession(session) {
  localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

function getActiveSession() {
  const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearActiveSession() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

let __sessionBannerTimer = null;

function renderActiveSessionBanner() {
  // 매장 QR 표시 화면(store-display.html)에는 배너를 띄우지 않습니다.
  if (document.body.dataset.appPage === "kiosk") return;

  const existing = document.getElementById("active-session-banner");
  if (existing) existing.remove();
  if (__sessionBannerTimer) {
    clearInterval(__sessionBannerTimer);
    __sessionBannerTimer = null;
  }

  const session = getActiveSession();
  document.body.classList.toggle("has-session-banner", !!session);
  if (!session) return;

  const banner = document.createElement("a");
  banner.id = "active-session-banner";
  banner.className = "active-session-banner";
  banner.href = "scan.html";

  function escapeText(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function updateText() {
    const elapsedMs = Date.now() - new Date(session.checkInAt).getTime();
    const mins = Math.max(0, Math.floor(elapsedMs / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const elapsedStr = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    banner.innerHTML =
      `<span class="dot"></span> ${escapeText(session.storeName)} 점검중 · ${elapsedStr} 경과 · 탭해서 퇴장 찍기`;
  }

  updateText();
  document.body.prepend(banner);
  __sessionBannerTimer = setInterval(updateText, 30000); // 30초마다 경과시간 갱신
}

document.addEventListener("DOMContentLoaded", renderActiveSessionBanner);

/* ========================================
   입장 중 자동 주기적 위치 기록
   ----------------------------------------
   입장을 찍은 뒤(점검중 상태) 앱이 켜져있는 동안, 정해진 간격마다 자동으로
   위치를 기록해서 나중에 관리자가 이동 경로를 확인할 수 있게 합니다.

   ⚠️ 웹앱의 한계: 화면을 끄거나 다른 앱으로 전환하면 브라우저가 자바스크립트
   실행을 멈추기 때문에, "앱이 화면에 켜져있는 동안"만 기록됩니다. 완전한
   백그라운드 추적은 네이티브 앱이 아니면 불가능합니다.
   ======================================== */

const LOCATION_PING_INTERVAL_MS = 5 * 60 * 1000; // 5분마다
let __locationPingTimer = null;

function startLocationPingIfNeeded() {
  // 매장 QR 표시 화면(store-display.html)에서는 실행하지 않음
  if (document.body.dataset.appPage === "kiosk") return;
  if (__locationPingTimer) return; // 이미 돌고 있으면 중복 시작 안 함

  const session = getActiveSession();
  if (!session || !session.visitId) return; // 입장 중이 아니거나, 방문ID가 없으면(예전 세션) 시작 안 함

  sendLocationPingOnce(session); // 시작하자마자 한 번 바로 기록
  __locationPingTimer = setInterval(() => {
    const current = getActiveSession();
    if (!current || !current.visitId) {
      stopLocationPing();
      return;
    }
    sendLocationPingOnce(current);
  }, LOCATION_PING_INTERVAL_MS);
}

function stopLocationPing() {
  if (__locationPingTimer) {
    clearInterval(__locationPingTimer);
    __locationPingTimer = null;
  }
}

function sendLocationPingOnce(session) {
  if (!navigator.geolocation) return;
  const sv = getCurrentSV();
  if (!sv) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      apiPost({
        action: "logLocationPing",
        svId: sv.email,
        svName: sv.name,
        storeId: session.storeId,
        storeName: session.storeName,
        visitId: session.visitId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy || 0)
      }).catch(() => {}); // 실패해도 조용히 넘어감 (다음 주기에 다시 시도)
    },
    () => {}, // 위치 가져오기 실패해도 조용히 넘어감
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

// 페이지가 다시 보일 때(다른 앱 갔다가 돌아옴 등) 상태를 다시 확인해서, 필요하면 재시작
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startLocationPingIfNeeded();
  }
});

document.addEventListener("DOMContentLoaded", startLocationPingIfNeeded);
