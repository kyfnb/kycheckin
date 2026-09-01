/* ========================================
   scan.js
   흐름: QR 스캔 → 가맹점 정보 조회 → GPS 위치 확인
        → 거리 계산 → 매장 사진 촬영 → 방문이력 저장(사진 포함)
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

let html5QrScanner = null;

// 사진 단계로 넘어가기 전까지 임시로 들고 있는 값들
let pendingVisit = null; // { storeId, storeName, distance, locationOk, qrValid, qrWindow, myLat, myLng, accuracy }
let capturedPhotoBase64 = null;
let capturedPhotoMimeType = null;

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
      prepareForPhotoStep(storeId, storeDoc, myLat, myLng, position.coords.accuracy, qrWindow);
    },
    (err) => {
      console.error(err);
      showToast("위치 권한을 허용해야 방문 등록이 가능합니다.");
      resetScan();
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// GPS까지 확인했으면, 바로 저장하지 않고 "매장 사진 촬영" 단계로 넘어갑니다.
function prepareForPhotoStep(storeId, storeDoc, myLat, myLng, accuracy, qrWindow) {
  const distance = getDistanceMeters(myLat, myLng, storeDoc.lat, storeDoc.lng);
  const locationOk = distance <= VISIT_RADIUS_METERS;

  pendingVisit = {
    storeId,
    storeName: storeDoc.name,
    distance,
    locationOk,
    qrWindow,
    myLat,
    myLng,
    accuracy
  };

  // 사진 상태 초기화
  capturedPhotoBase64 = null;
  capturedPhotoMimeType = null;
  document.getElementById("photo-preview-box").style.display = "none";
  document.getElementById("photo-empty-box").style.display = "block";
  document.getElementById("photo-capture-btn").style.display = "block";
  document.getElementById("photo-retake-btn").style.display = "none";
  document.getElementById("photo-submit-btn").disabled = true;
  document.getElementById("photo-uploading-msg").style.display = "none";

  document.getElementById("step-gps").style.display = "none";
  document.getElementById("step-photo").style.display = "block";
  document.getElementById("step-desc").textContent = "매장 사진을 촬영해주세요.";
  document.getElementById("photo-store-name").textContent = storeDoc.name;
}

// 사진 파일 선택(촬영) 시: 리사이즈해서 base64로 변환, 미리보기 표시
function handlePhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const img = new Image();
  const reader = new FileReader();

  reader.onload = (e) => {
    img.onload = () => {
      // 업로드 용량을 줄이기 위해 최대 900px 폭으로 리사이즈
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      capturedPhotoBase64 = dataUrl.split(",")[1];
      capturedPhotoMimeType = "image/jpeg";

      document.getElementById("photo-preview").src = dataUrl;
      document.getElementById("photo-preview-box").style.display = "block";
      document.getElementById("photo-empty-box").style.display = "none";
      document.getElementById("photo-capture-btn").style.display = "none";
      document.getElementById("photo-retake-btn").style.display = "block";
      document.getElementById("photo-submit-btn").disabled = false;
    };
    img.src = e.target.result;
  };

  reader.readAsDataURL(file);
  event.target.value = ""; // 같은 파일 다시 선택해도 change 이벤트가 발생하도록 초기화
}

// "방문 등록 완료" 버튼: 사진과 함께 최종 저장
async function submitVisitWithPhoto() {
  if (!pendingVisit || !capturedPhotoBase64) {
    showToast("사진을 먼저 촬영해주세요.");
    return;
  }

  document.getElementById("photo-submit-btn").disabled = true;
  document.getElementById("photo-uploading-msg").style.display = "block";

  const v = pendingVisit;
  let qrValid = true;

  try {
    const saveResult = await apiPost({
      action: "logVisit",
      svId: sv.email,
      svName: sv.name,
      storeId: v.storeId,
      storeName: v.storeName,
      distanceMeters: Math.round(v.distance),
      gpsAccuracy: Math.round(v.accuracy || 0),
      svLat: v.myLat,
      svLng: v.myLng,
      verified: v.locationOk,
      qrWindow: v.qrWindow,
      photoBase64: capturedPhotoBase64,
      photoMimeType: capturedPhotoMimeType
    });
    if (typeof saveResult.qrValid === "boolean") {
      qrValid = saveResult.qrValid;
    }
  } catch (e) {
    console.error(e);
    showToast("방문 기록 저장에 실패했습니다.");
  }

  document.getElementById("photo-uploading-msg").style.display = "none";
  showResult(v.storeName, v.distance, v.locationOk, qrValid);
}

function showResult(storeName, distance, locationOk, qrValid) {
  document.getElementById("step-photo").style.display = "none";
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
    detail.textContent = `허용 반경 ${VISIT_RADIUS_METERS}m 이내에서 스캔되었습니다. 사진도 함께 저장됐어요.`;
  } else {
    badge.className = "gps-badge fail";
    pill.className = "status-pill fail";
    pill.textContent = "⚠ 위치 불일치";
    detail.textContent = `가맹점과 ${Math.round(distance)}m 떨어진 위치에서 스캔되었습니다. 기록은 저장되었으나 확인이 필요합니다.`;
  }
}

function resetScan() {
  document.getElementById("step-result").style.display = "none";
  document.getElementById("step-photo").style.display = "none";
  document.getElementById("step-gps").style.display = "none";
  document.getElementById("step-scan").style.display = "block";
  document.getElementById("step-desc").textContent = "가맹점 QR코드를 화면에 비춰주세요.";
  document.getElementById("qr-reader").innerHTML = "";
  pendingVisit = null;
  capturedPhotoBase64 = null;
  capturedPhotoMimeType = null;
  startScanner();
}

startScanner();

