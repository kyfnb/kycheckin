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
