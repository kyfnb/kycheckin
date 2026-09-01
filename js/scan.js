/* ========================================
   scan.js
   흐름: QR 스캔 → 가맹점 정보 조회 → GPS 위치 확인
        → 거리 계산 → 방문이력 저장
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

let html5QrScanner = null;

function startScanner() {
  html5QrScanner = new Html5Qrcode("qr-reader");
  const config = { fps: 10, qrbox: { width: 240, height: 240 } };

  html5QrScanner
    .start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      () => {} // 스캔 실패(프레임마다 호출)는 무시
    )
    .catch((err) => {
      showToast("카메라를 시작할 수 없습니다. 권한을 확인해주세요.");
      console.error(err);
    });
}

function onScanSuccess(decodedText) {
  // 스캐너 정지 후 다음 단계로
  html5QrScanner.stop().then(() => {
    handleScannedQr(decodedText);
  }).catch(() => handleScannedQr(decodedText));
}

// QR에는 { storeId, w } 형태(회전 QR) 또는 과거 방식(가맹점 코드만) 둘 다 대응
function handleScannedQr(decodedText) {
  let storeId = null;
  let qrWindow = null;

  try {
    const payload = JSON.parse(decodedText);
    storeId = payload.storeId;
    qrWindow = typeof payload.w === "number" ? payload.w : null;
  } catch (e) {
    // JSON이 아니면 예전 방식(가맹점 코드 문자열 그대로)으로 간주
    storeId = decodedText;
  }

  if (!storeId) {
    showToast("인식할 수 없는 QR코드입니다.");
    resetScan();
    return;
  }

  handleStoreQr(storeId, qrWindow);
}

// QR에는 { storeId, w } 형태로 담겨 있습니다 (store-display.html에서 생성)
async function handleStoreQr(storeId, qrWindow) {
  document.getElementById("step-scan").style.display = "none";
  document.getElementById("step-gps").style.display = "block";
  document.getElementById("step-desc").textContent = "위치 확인 중입니다…";

  let storeDoc;
  try {
    const result = await apiGet({ action: "getStore", storeId });
    if (!result.exists) {
      if (result.excluded) {
        showToast(`이 가맹점은 현재 "${result.status}" 상태라 방문 등록을 할 수 없어요.`);
      } else {
        showToast("매장정보에서 찾을 수 없는 코드입니다.");
      }
      resetScan();
      return;
    }
    storeDoc = result; // { name, lat, lng }
  } catch (e) {
    console.error(e);
    showToast("가맹점 정보를 불러오지 못했습니다. 네트워크를 확인해주세요.");
    resetScan();
    return;
  }

  document.getElementById("store-name-display").textContent = storeDoc.name;

  if (!navigator.geolocation) {
    showToast("이 기기는 위치 확인을 지원하지 않습니다.");
    resetScan();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const myLat = position.coords.latitude;
      const myLng = position.coords.longitude;
      finishVerification(storeId, storeDoc, myLat, myLng, position.coords.accuracy, qrWindow);
    },
    (err) => {
      console.error(err);
      showToast("위치 권한을 허용해야 방문 등록이 가능합니다.");
      resetScan();
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function finishVerification(storeId, storeDoc, myLat, myLng, accuracy, qrWindow) {
  const distance = getDistanceMeters(myLat, myLng, storeDoc.lat, storeDoc.lng);
  const locationOk = distance <= VISIT_RADIUS_METERS;

  // 스프레드시트(Apps Script API)에 방문 기록 저장
  // 서버가 qrWindow를 검증해서 QR이 유효 시간(30초 창) 안에 스캔됐는지도 함께 확인합니다.
  let qrValid = true; // 예전 방식 QR(윈도우 없음)은 이 검사를 건너뜁니다.
  try {
    const saveResult = await apiPost({
      action: "logVisit",
      svId: sv.email,
      svName: sv.name,
      storeId: storeId,
      storeName: storeDoc.name,
      distanceMeters: Math.round(distance),
      gpsAccuracy: Math.round(accuracy || 0),
      svLat: myLat,
      svLng: myLng,
      verified: locationOk,
      qrWindow: qrWindow
    });
    if (typeof saveResult.qrValid === "boolean") {
      qrValid = saveResult.qrValid;
    }
  } catch (e) {
    console.error(e);
    showToast("방문 기록 저장에 실패했습니다.");
  }

  showResult(storeDoc.name, distance, locationOk, qrValid);
}

function showResult(storeName, distance, locationOk, qrValid) {
  document.getElementById("step-gps").style.display = "none";
  document.getElementById("step-result").style.display = "block";
  document.getElementById("step-desc").textContent = "방문 등록이 완료되었습니다.";

  document.getElementById("result-store-name").textContent = storeName;
  document.getElementById("result-distance").textContent = `${Math.round(distance)}m`;

  const badge = document.getElementById("result-badge");
  const pill = document.getElementById("result-pill");
  const detail = document.getElementById("result-detail");

  if (!qrValid) {
    badge.className = "gps-badge fail";
    pill.className = "status-pill fail";
    pill.textContent = "⚠ QR 만료됨";
    detail.textContent = "QR코드가 오래된 것 같아요(캡처된 이미지일 수 있음). 화면의 최신 QR을 다시 스캔해주세요.";
  } else if (locationOk) {
    badge.className = "gps-badge ok";
    pill.className = "status-pill ok";
    pill.textContent = "✓ 방문 확인됨";
    detail.textContent = `허용 반경 ${VISIT_RADIUS_METERS}m 이내에서 스캔되었습니다.`;
  } else {
    badge.className = "gps-badge fail";
    pill.className = "status-pill fail";
    pill.textContent = "⚠ 위치 불일치";
    detail.textContent = `가맹점과 ${Math.round(distance)}m 떨어진 위치에서 스캔되었습니다. 기록은 저장되었으나 확인이 필요합니다.`;
  }
}

function resetScan() {
  document.getElementById("step-result").style.display = "none";
  document.getElementById("step-gps").style.display = "none";
  document.getElementById("step-scan").style.display = "block";
  document.getElementById("step-desc").textContent = "가맹점 QR코드를 화면에 비춰주세요.";
  document.getElementById("qr-reader").innerHTML = "";
  startScanner();
}

startScanner();
