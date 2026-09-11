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

// ⚠️ 버그 픽스: html5-qrcode는 카메라 프레임마다(초당 약 10회) 디코드를 시도하는데,
// 같은 QR이 화면에 계속 잡혀있으면 scanner.stop()이 실제로 멈추기 전(비동기 처리 중)
// 짧은 순간에 onScanSuccess가 연달아 여러 번 호출될 수 있습니다.
// 특히 퇴장은 사진 확인 단계 없이 스캔 즉시 자동 저장되기 때문에, 이 중복 호출이 그대로
// 서버 저장 요청 중복으로 이어져 "첫 번째 호출은 정상 퇴장 처리 → 이미 퇴장 처리돼서 열린
// 입장이 없어진 상태에서 두 번째・세 번째 호출이 각각 새 입장으로 기록되는" 문제가 발생했습니다
// (담당자 피드백: 퇴장 스캔 시 입장으로 3회 인식됨).
// isProcessingScan 플래그로 "한 번의 스캔 처리가 끝날 때까지 추가 스캔 결과는 전부 무시"하도록 막습니다.
let isProcessingScan = false;

// ⚠️ 개선: 화면 제목이 스캔 전 과정에서 항상 "방문 등록"으로 고정돼 있어서, 입장 후 퇴장을
// 찍으려고 다시 들어온 담당자들이 "또 입장 처리되는 건가?" 헷갈려 했습니다.
// 입장/퇴장이 확정될 때마다(추정 → 서버 확인 → 최종 저장) 제목을 그때그때 맞춰 바꿔줍니다.
function updateTitleForSession(type) {
  const titleEl = document.getElementById("step-title");
  if (!titleEl) return;
  if (type === "checkout") {
    titleEl.textContent = "퇴장 등록";
  } else if (type === "checkin") {
    titleEl.textContent = "입장 등록";
  } else {
    titleEl.textContent = "방문 등록";
  }
}

// 카메라를 켜기 전, 로컬에 저장된 "점검중" 세션이 있는지로 이번 스캔이 입장인지 퇴장인지
// 미리 짐작해서 제목을 맞춰둡니다. (실제 확정은 QR을 찍은 뒤 서버 확인으로 다시 정해짐)
updateTitleForSession(getActiveSession() ? "checkout" : "checkin");

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
      showToast(cameraErrorMessage(err));
      console.error(err);
    });
}

// 카메라 권한은 이미 켜져 있는데도 항상 "권한을 확인해주세요"라고만 뜨면, 실제로는
// 카메라가 다른 앱에서 사용 중이거나(다른 카메라/화상통화 앱 등), 기기에 후면 카메라가
// 없거나, 브라우저 자체의 권한 상태가 "허용"이어도 실제 하드웨어 접근이 막힌 경우(회사
// MDM/보안 프로필 등)일 수 있습니다. 원인별로 다른 안내를 보여줘서 헷갈리지 않게 합니다.
function cameraErrorMessage(err) {
  const name = (err && err.name) || String(err || "");
  if (name.includes("NotAllowedError") || name.includes("PermissionDenied")) {
    return "카메라 권한이 거부되어 있습니다. 브라우저(또는 기기) 설정에서 카메라 권한을 허용해주세요.";
  }
  if (name.includes("NotFoundError") || name.includes("DevicesNotFound") || name.includes("OverconstrainedError")) {
    return "후면 카메라를 찾을 수 없습니다. 기기에 카메라가 있는지, 다른 앱이 카메라를 막고 있지 않은지 확인해주세요.";
  }
  if (name.includes("NotReadableError") || name.includes("TrackStartError")) {
    return "카메라가 다른 앱에서 사용 중이거나 하드웨어 문제가 있어요. 카메라를 쓰는 다른 앱(화상통화 등)을 종료하고 다시 시도해주세요.";
  }
  if (name.includes("SecurityError")) {
    return "보안 정책(회사 보안 프로필 등)으로 카메라 접근이 차단된 것 같아요. 기기 관리자에게 문의해주세요.";
  }
  return "카메라를 시작할 수 없습니다. 권한 설정을 확인해주세요. (" + name + ")";
}

function onScanSuccess(decodedText) {
  // 이미 처리 중인 스캔이 있으면(같은 QR이 연속 프레임에서 중복 디코드된 경우 등) 무시
  if (isProcessingScan) return;
  isProcessingScan = true;

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
      showToast(geolocationErrorMessage(err));
      resetScan();
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// 위치 확인 실패는 늘 "권한을 허용해야 합니다"로만 안내하면, 이미 권한을 허용했는데도
// GPS 신호가 약해서(실내, 지하 등) 못 잡는 경우까지 "권한 문제"로 오해하게 됩니다.
// 에러 코드별로 다르게 안내합니다. (1=권한거부, 2=위치확인불가, 3=시간초과)
function geolocationErrorMessage(err) {
  if (!err || typeof err.code !== "number") {
    return "위치를 확인하지 못했습니다. 다시 시도해주세요.";
  }
  if (err.code === 1) {
    return "위치 권한이 거부되어 있습니다. 브라우저(또는 기기) 설정에서 위치 권한을 허용해주세요.";
  }
  if (err.code === 2) {
    return "GPS 신호가 약해서 위치를 확인할 수 없어요. 실외로 이동하거나, 기기 설정에서 위치 모드를 '높은 정확도'로 바꾸고 다시 시도해주세요.";
  }
  if (err.code === 3) {
    return "위치 확인이 시간 초과됐어요. GPS 신호가 약할 수 있어요. 잠시 후 다시 시도해주세요.";
  }
  return "위치를 확인하지 못했습니다. 다시 시도해주세요.";
}

// GPS까지 확인했으면, 이번 스캔이 입장인지 퇴장인지 확인합니다.
// 입장 → 사진 촬영 단계로 이동 (사진 필수)
// 퇴장 → 사진 없이 바로 저장 (QR + GPS만으로 충분)
async function prepareForPhotoStep(storeId, storeDoc, myLat, myLng, accuracy, qrWindow) {
  const distance = getDistanceMeters(myLat, myLng, storeDoc.lat, storeDoc.lng);
  const locationOk = distance <= VISIT_RADIUS_METERS;

  let sessionType = "checkin"; // 기본값: 입장
  try {
    const status = await apiGet({ action: "getSessionStatus", svId: sv.email, storeId });
    sessionType = status.checkedIn ? "checkout" : "checkin";
  } catch (e) {
    console.error(e);
    // 조회 실패해도 기본값(입장)으로 진행. 실제 판단은 서버가 저장 시점에 다시 확정합니다.
  }

  pendingVisit = {
    storeId,
    storeName: storeDoc.name,
    distance,
    locationOk,
    qrWindow,
    myLat,
    myLng,
    accuracy,
    sessionType
  };

  updateTitleForSession(sessionType); // QR을 찍고 나서 확인된(추정) 결과로 제목을 맞춰줌

  if (sessionType === "checkout") {
    // 퇴장은 사진 없이 바로 처리
    document.getElementById("step-desc").textContent = "퇴장 처리 중…";
    capturedPhotoBase64 = null;
    capturedPhotoMimeType = null;
    await finalizeVisit();
    return;
  }

  // 입장은 사진 촬영 필수
  capturedPhotoBase64 = null;
  capturedPhotoMimeType = null;
  document.getElementById("photo-preview-box").style.display = "none";
  document.getElementById("photo-empty-box").style.display = "block";
  document.getElementById("photo-capture-btn").style.display = "block";
  document.getElementById("photo-retake-btn").style.display = "none";
  document.getElementById("photo-submit-btn").disabled = true;
  document.getElementById("photo-uploading-msg").style.display = "none";
  document.getElementById("photo-empty-box").querySelector(".hint").innerHTML =
    "매장 내부(POS 화면 등)를 촬영해주세요.";
  document.getElementById("photo-submit-btn").textContent = "입장 등록 완료";

  document.getElementById("step-gps").style.display = "none";
  document.getElementById("step-photo").style.display = "block";
  document.getElementById("step-desc").textContent = "입장 사진을 촬영해주세요.";
  document.getElementById("photo-store-name").textContent = `${storeDoc.name} · 입장`;
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

// "입장 등록 완료" 버튼(입장만 해당, 퇴장은 사진 없이 자동 처리됨)
async function submitVisitWithPhoto() {
  if (!pendingVisit || !capturedPhotoBase64) {
    showToast("사진을 먼저 촬영해주세요.");
    return;
  }

  document.getElementById("photo-submit-btn").disabled = true;
  document.getElementById("photo-uploading-msg").style.display = "block";

  await finalizeVisit();

  document.getElementById("photo-uploading-msg").style.display = "none";
}

// 실제 저장 처리 (입장: 사진 포함 / 퇴장: 사진 없이). 입장 성공 시 "점검중" 배너를 켜고,
// 퇴장 성공 시 배너를 꺼줍니다.
async function finalizeVisit() {
  const v = pendingVisit;
  let qrValid = true;
  let accuracyOk = true;
  let resultType = v.sessionType;
  let durationMinutes = null;

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
    if (typeof saveResult.accuracyOk === "boolean") {
      accuracyOk = saveResult.accuracyOk;
    }
    if (saveResult.type) {
      resultType = saveResult.type; // 서버가 저장 시점에 최종 확정한 값(입장/퇴장)
    }
    if (typeof saveResult.durationMinutes === "number") {
      durationMinutes = saveResult.durationMinutes;
    }

    if (saveResult.success) {
      if (resultType === "checkin") {
        setActiveSession({
          storeId: v.storeId,
          storeName: v.storeName,
          checkInAt: new Date().toISOString(),
          visitId: saveResult.visitId || null
        });
        startLocationPingIfNeeded(); // 입장 즉시 주기적 위치 기록 시작
      } else if (resultType === "checkout") {
        clearActiveSession();
        stopLocationPing();
      }
    }
  } catch (e) {
    console.error(e);
    showToast("방문 기록 저장에 실패했습니다.");
  }

  showResult(v.storeName, v.distance, v.locationOk, qrValid, resultType, durationMinutes, accuracyOk, v.accuracy);
}

function showResult(storeName, distance, locationOk, qrValid, sessionType, durationMinutes, accuracyOk, accuracy) {
  document.getElementById("step-photo").style.display = "none";
  document.getElementById("step-result").style.display = "block";
  document.getElementById("step-desc").textContent = "방문 등록이 완료되었습니다.";
  updateTitleForSession(sessionType); // 서버가 최종 확정한 값으로 제목을 다시 맞춰줌 (추정과 다를 수 있어서)

  // ⚠️ 개선: "다른 가맹점 계속 스캔"이라는 문구가, 방금 입장한 매장에서 바로 퇴장을 찍으려는
  // 상황(같은 매장)에도 그대로 나와서 헷갈린다는 피드백이 있었습니다. 입장 직후에는 "계속
  // 스캔하기"로, 퇴장(방문 종료) 직후에는 "다른 가맹점 스캔하기"로 문구를 구분합니다.
  const scanAgainBtn = document.getElementById("scan-again-btn");
  if (scanAgainBtn) {
    scanAgainBtn.textContent = sessionType === "checkout" ? "다른 가맹점 스캔하기" : "계속 스캔하기";
  }

  const isCheckout = sessionType === "checkout";
  document.getElementById("result-store-name").textContent =
    `${storeName} · ${isCheckout ? "퇴장" : "입장"}`;
  document.getElementById("result-distance").textContent = `${Math.round(distance)}m`;

  const badge = document.getElementById("result-badge");
  const pill = document.getElementById("result-pill");
  const detail = document.getElementById("result-detail");

  if (!qrValid) {
    badge.className = "gps-badge fail";
    pill.className = "status-pill fail";
    pill.textContent = "⚠ QR 만료됨";
    detail.textContent = "QR코드가 오래된 것 같아요(캡처된 이미지일 수 있음). 화면의 최신 QR을 다시 스캔해주세요.";
  } else if (accuracyOk === false) {
    badge.className = "gps-badge fail";
    pill.className = "status-pill fail";
    pill.textContent = "⚠ GPS 신호 약함";
    detail.textContent = `현재 위치 오차범위가 약 ${Math.round(accuracy || 0)}m로 너무 커서 확인이 어려워요. 실외로 이동해서 다시 시도해주시거나, 휴대폰 설정에서 "정확한 위치" 사용을 켜주세요.`;
  } else if (locationOk) {
    badge.className = "gps-badge ok";
    pill.className = "status-pill ok";
    pill.textContent = isCheckout ? "✓ 퇴장 확인됨" : "✓ 입장 확인됨";
    const durationText =
      isCheckout && typeof durationMinutes === "number"
        ? ` 체류 시간은 약 ${durationMinutes}분이었어요.`
        : "";
    const photoText = isCheckout ? "" : " 사진도 함께 저장됐어요.";
    detail.textContent = `허용 반경 ${VISIT_RADIUS_METERS}m 이내에서 스캔되었습니다.${photoText}${durationText}`;
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
  isProcessingScan = false; // 카메라를 다시 켜는 시점에 다음 스캔을 받을 수 있도록 플래그 해제
  updateTitleForSession(getActiveSession() ? "checkout" : "checkin"); // 다음 스캔 예상 상태로 제목 초기화
  pendingVisit = null;
  capturedPhotoBase64 = null;
  capturedPhotoMimeType = null;
  startScanner();
}

startScanner();

