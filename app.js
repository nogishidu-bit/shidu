/* 設定 */
const FPS = 30;
const DURATION_SEC = 20;

/* 画面切り替え */
const startScreen = document.getElementById("start-screen");
const measureScreen = document.getElementById("measure-screen");
const resultScreen = document.getElementById("result-screen");

/* 待機画面用 video/canvas */
const videoStart = document.getElementById("videoStart");
const canvasStart = document.getElementById("canvasStart");
const ctxStart = canvasStart.getContext("2d");

/* 測定画面用 video/canvas */
const videoMeasure = document.getElementById("videoMeasure");
const canvasMeasure = document.getElementById("canvasMeasure");
const ctxMeasure = canvasMeasure.getContext("2d");

/* UI */
const startBtn = document.getElementById("startBtn");
const retryBtn = document.getElementById("retryBtn");

const statusEl = document.getElementById("status");
const faceWarning = document.getElementById("faceWarning");
const progressBar = document.getElementById("progressBar");

const fatigueEl = document.getElementById("fatigueScore");
const levelEl = document.getElementById("fatigueLevel");
const workEl = document.getElementById("workStatus");
const dangerEl = document.getElementById("dangerStatus");
const resultsEl = document.getElementById("results");

/* 状態 */
let rgbSeries = [];
let brightnessSeries = [];
let baseBrightness = null;
let baseSamples = [];
let running = false;
let eyeOut = false;
let validSeconds = 0;

/* 画面切り替え */
function showScreen(screen) {
  startScreen.classList.remove("active");
  measureScreen.classList.remove("active");
  resultScreen.classList.remove("active");
  screen.classList.add("active");
}

/* カメラ起動（2つの video に同じストリームを流す） */
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

/* ROI + ガイド線（測定画面側だけ） */
function processMeasureFrame() {
  const w = canvasMeasure.width;
  const h = canvasMeasure.height;

  ctxMeasure.drawImage(videoMeasure, 0, 0, w, h);

  /* ガイド線 */
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

  /* ROI */
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

  /* RGB 平均 */
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

  /* 基準明るさ */
  if (baseBrightness === null && baseSamples.length < FPS) {
    baseSamples.push(brightness);
    if (baseSamples.length === FPS) baseBrightness = mean(baseSamples);
  }

  /* ROI 中心 */
  const roiCenterY = sy + size / 2;

  /* ガイド線帯判定 */
  const inBand = (roiCenterY >= topLinePx && roiCenterY <= bottomLinePx);

  /* 明るさ差分 */
  let diffOK = true;
  if (baseBrightness) {
    diffOK = Math.abs(brightness - baseBrightness) < 30;
  }

  return inBand && diffOK;
}

/* 数学 */
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

/* 測定終了（簡易版） */
function finishMeasurement() {
  running = false;
  showScreen(resultScreen);

  fatigueEl.textContent = "計算中…";
  levelEl.textContent = "--";
  workEl.textContent = "--";
  dangerEl.textContent = "--";

  resultsEl.textContent = "※ rPPG解析は省略（デバッグ用）";
}

/* 測定開始 */
async function startMeasurement() {
  showScreen(measureScreen);

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

  /* 測定画面の描画ループ */
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

  /* カウントダウン */
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
      finishMeasurement();
    }

  }, 1000);
}

/* ボタン */
startBtn.addEventListener("click", startMeasurement);
retryBtn.addEventListener("click", () => showScreen(startScreen));
