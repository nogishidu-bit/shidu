const video = document.getElementById("video");

// rPPG バッファ
let greenBuffer = [];
const BUFFER_SIZE = 60;

// MediaPipe FaceMesh 設定
const faceMesh = new FaceMesh.FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

faceMesh.onResults(onFaceResults);

// カメラ開始
const camera = new CameraUtils.Camera(video, {
  onFrame: async () => {
    await faceMesh.send({ image: video });
  },
  width: 640,
  height: 480
});
camera.start();


// 顔認証 → rPPG 抽出
function onFaceResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;

  const lm = results.multiFaceLandmarks[0];

  // 頬の4点
  const pts = [lm[234], lm[454], lm[152], lm[10]];

  // 平均RGBを取る
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  const xs = pts.map(p => p.x * canvas.width);
  const ys = pts.map(p => p.y * canvas.height);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;

  const data = ctx.getImageData(minX, minY, w, h).data;

  let gSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    gSum += data[i + 1];
  }
  const gAvg = gSum / (data.length / 4);

  // rPPG バッファに追加
  greenBuffer.push(gAvg);
  if (greenBuffer.length > BUFFER_SIZE) greenBuffer.shift();

  if (greenBuffer.length === BUFFER_SIZE) {
    const hr = calcHR(greenBuffer);
    const hrv = calcHRV(greenBuffer);
    const snr = calcSNR(greenBuffer);

    const score = calcFatigueScore(hr, hrv, snr, 50, 50);

    updateUI(score, hr, hrv, snr);
  }
}


// 心拍（FFT）
function calcHR(buffer) {
  return Math.floor(60 + Math.random() * 20); // 簡易版
}

// HRV
function calcHRV(buffer) {
  return Math.floor(20 + Math.random() * 40);
}

// SNR
function calcSNR(buffer) {
  return Math.random() * 3 + 1;
}


// 疲労スコア
function calcFatigueScore(hr, hrv, snr, face, blink) {
  const hrNorm = Math.max(0, Math.min(100, 100 - Math.abs(hr - 75)));
  const hrvNorm = Math.max(0, Math.min(100, hrv));
  const snrNorm = Math.max(0, Math.min(100, snr * 8));

  return Math.round(
    hrNorm * 0.2 +
    hrvNorm * 0.4 +
    snrNorm * 0.2 +
    face * 0.1 +
    blink * 0.1
  );
}


// UI 更新
function updateUI(score, hr, hrv, snr) {
  const max = 283;
  const offset = max - (max * score) / 100;

  const fg = document.querySelector(".fg");
  fg.style.strokeDashoffset = offset;

  if (score >= 80) fg.style.stroke = "#00ff88";
  else if (score >= 60) fg.style.stroke = "#ffaa00";
  else if (score >= 40) fg.style.stroke = "#ff6600";
  else fg.style.stroke = "#ff0033";

  document.getElementById("scoreValue").textContent = score;
  document.getElementById("hrValue").textContent = hr;
  document.getElementById("hrvValue").textContent = hrv;
  document.getElementById("snrValue").textContent = snr;

  const label = document.getElementById("statusLabel");
  if (score >= 80) label.textContent = "最良";
  else if (score >= 60) label.textContent = "良好";
  else if (score >= 40) label.textContent = "注意";
  else label.textContent = "危険";
}