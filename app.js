/* 設定 */
const FPS = 30;
const DURATION_SEC = 20;

/* 画面 */
const startScreen = document.getElementById("start-screen");
const measureScreen = document.getElementById("measure-screen");
const resultScreen = document.getElementById("result-screen");

/* video/canvas */
const videoStart = document.getElementById("videoStart");
const canvasStart = document.getElementById("canvasStart");
const ctxStart = canvasStart.getContext("2d");

const videoMeasure = document.getElementById("videoMeasure");
const canvasMeasure = document.getElementById("canvasMeasure");
const ctxMeasure = canvasMeasure.getContext("2d");

/* UI */
const startBtn = document.getElementById("startBtn");
const retryBtn = document.getElementById("retryBtn");
const statusEl = document.getElementById("status");
const faceWarning = document.getElementById("faceWarning");
const progressBar = document.getElementById("progressBar");

/* 状態 */
let running = false;
let eyeOut = false;
let validSeconds = 0;
let baseBrightness = null;
let baseSamples = [];
let rgbSeries = [];
let brightnessSeries = [];

/* 画面切り替え */
function showScreen(screen) {
  startScreen.classList.remove("active");
  measureScreen.classList.remove("active");
  resultScreen.classList.remove("active");
  screen.classList.add("active");
}

/* カメラ起動 */
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", frameRate: { ideal: FPS } },
    audio: false
  });

  videoStart.srcObject = stream;
  videoMeasure.srcObject = stream;

  await videoStart.play();
  await videoMeasure.play();
}

/* Safariバグ回避：videoStart を完全停止 */
function stopStartVideo() {
  try {
    const stream = videoStart.srcObject;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
  } catch {}

  videoStart.pause();
  videoStart.srcObject = null;
}

/* 測定フレーム処理 */
function processMeasureFrame() {
  const w = canvasMeasure.width;
  const h = canvasMeasure.height;

  ctxMeasure.drawImage(videoMeasure, 0, 0, w, h);

  const topLinePx = h * 0.25;
  const bottomLinePx = h * 0.45;

  ctxMeasure.strokeStyle = "#00b0ff";
  ctxMeasure.lineWidth = 2;

  ctxMeasure.beginPath();
  ctxMeasure.moveTo(0, topLinePx);
  ctxMeasure.lineTo(w, topLinePx);
  ctxMeasure.stroke();

  ctxMeasure.beginPath();
  ctxMeasure.moveTo(0, bottomLinePx);
  ctxMeasure.lineTo(w, bottomLinePx);
  ctxMeasure.stroke();

  const size = 28;
  const eyeY = Math.floor((topLinePx + bottomLinePx) / 2);

  const sx = Math.floor(w / 2 - size / 2);
  const sy = Math.min(h - size, Math.max(0, Math.floor(eyeY - size / 2)));

  ctxMeasure.strokeStyle = "red";
  ctxMeasure.strokeRect(sx, sy, size, size);

  let img;
  try {
    img = ctxMeasure.getImageData(sx, sy, size, size).data;
  } catch {
    return false;
  }

  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < img.length; i += 4) {
    r += img[i];
    g += img[i + 1];
    b += img[i + 2];
    c++;
  }
  const R = r / c, G = g / c, B = b / c;
  const brightness = (R + G + B) / 3;

  rgbSeries.push([R, G, B]);
  brightnessSeries.push(brightness);

  if (baseBrightness === null && baseSamples.length < FPS) {
    baseSamples.push(brightness);
    if (baseSamples.length === FPS) baseBrightness = baseSamples.reduce((a,b)=>a+b)/FPS;
  }

  const roiCenterY = sy + size / 2;
  const inBand = (roiCenterY >= topLinePx && roiCenterY <= bottomLinePx);

  let diffOK = true;
  if (baseBrightness) diffOK = Math.abs(brightness - baseBrightness) < 30;

  return inBand && diffOK;
}

/* 測定開始 */
async function startMeasurement() {
  showScreen(measureScreen);

  /* ★ Safariバグ回避：待機画面の video を完全停止 */
  stopStartVideo();

  rgbSeries = [];
  brightnessSeries = [];
  baseBrightness = null;
  baseSamples = [];
  validSeconds = 0;
  eyeOut = false;

  progressBar.style.width = "0%";
  progressBar.style.background = "#1e88e5";
  faceWarning.textContent = "";
  statusEl.textContent = "カメラ起動中…";

  await initCamera();

  running = true;

  const frameLoop = setInterval(() => {
    if (!running) return clearInterval(frameLoop);

    const ok = processMeasureFrame();

    if (!ok) {
      eyeOut = true;
      faceWarning.textContent = "目線がガイド線から外れています";
      progressBar.style.background = "#ff5252";
      statusEl.textContent = "測定一時停止中…";
      return;
    }

    eyeOut = false;
    faceWarning.textContent = "";
    progressBar.style.background = "#1e88e5";

  }, 1000 / FPS);

  const countdown = setInterval(() => {
    if (!running) return clearInterval(countdown);

    if (!eyeOut) {
      validSeconds++;
      progressBar.style.width = `${(validSeconds / DURATION_SEC) * 100}%`;
      statusEl.textContent = `測定中… 有効時間 ${validSeconds} 秒 / 20 秒`;
    }

    if (validSeconds >= DURATION_SEC) {
      clearInterval(countdown);
      clearInterval(frameLoop);
      showScreen(resultScreen);
    }

  }, 1000);
}

/* ボタン */
startBtn.addEventListener("click", startMeasurement);
retryBtn.addEventListener("click", () => location.reload());
