/* ========================================
   register-store.js
   ======================================== */

const sv = requireLogin();
if (sv) {
  document.getElementById("sv-name-label").textContent = sv.name;
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast("이 기기는 위치 확인을 지원하지 않습니다.");
    return;
  }
  showToast("현재 위치를 확인하는 중…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("store-lat").value = position.coords.latitude.toFixed(6);
      document.getElementById("store-lng").value = position.coords.longitude.toFixed(6);
      showToast("현재 위치가 입력되었습니다.");
    },
    () => showToast("위치 권한을 허용해주세요."),
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function registerStore() {
  const name = document.getElementById("store-name").value.trim();
  const storeId = document.getElementById("store-id").value.trim();
  const lat = parseFloat(document.getElementById("store-lat").value);
  const lng = parseFloat(document.getElementById("store-lng").value);

  if (!name || !storeId) {
    showToast("가맹점명과 가맹점 코드를 입력해주세요.");
    return;
  }
  if (isNaN(lat) || isNaN(lng)) {
    showToast("위치 정보를 입력하거나 '현재 위치로 등록'을 눌러주세요.");
    return;
  }

  try {
    const result = await apiPost({
      action: "registerStore",
      storeId,
      name,
      lat,
      lng,
      registeredBy: sv.name
    });

    if (!result.success) {
      showToast(result.message || "이미 등록된 가맹점 코드입니다.");
      return;
    }

    renderQr(storeId, name);
  } catch (e) {
    console.error(e);
    showToast("등록에 실패했습니다. 네트워크를 확인해주세요.");
  }
}

function renderQr(storeId, name) {
  document.querySelector(".card.no-print").style.display = "none";
  document.getElementById("qr-result").style.display = "block";
  document.getElementById("qr-store-name").textContent = name;
  document.getElementById("qr-store-id").textContent = `코드: ${storeId}`;

  document.getElementById("qr-code-box").innerHTML = "";
  new QRCode(document.getElementById("qr-code-box"), {
    text: storeId, // QR에는 가맹점 코드만 담습니다.
    width: 200,
    height: 200
  });
}

function resetForm() {
  document.querySelector(".card.no-print").style.display = "block";
  document.getElementById("qr-result").style.display = "none";
  document.getElementById("store-name").value = "";
  document.getElementById("store-id").value = "";
  document.getElementById("store-lat").value = "";
  document.getElementById("store-lng").value = "";
}
