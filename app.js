/* 設定 */
const FPS = 30;
const DURATION_SEC = 20;

/* 画面切り替え */
const startScreen = document.getElementById("start-screen");
const measureScreen = document.getElementById("measure-screen");
const resultScreen = document.getElementById("result-screen");

/* 共通 video / canvas（1つだけ） */
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

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

/* カメラ起動 */
async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", frameRate: { ideal: FPS } },
    audio: false
  });

  video.srcObject = stream;

  /* iPhone Safari 対策：必ず play() を await */
  await video.play();
}

/* ROI + ガイド線（測定中のみ描画） */
function processFrame() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.drawImage(video, 0, 0, w, h);

  /* 測定画面以外では描画しない */
  if (!measureScreen.classList.contains("active")) return true;

  /* ガイド線（広め） */
  const topLinePx = h * 0.25;
  const bottomLinePx = h * 0.45;

  ctx.strokeStyle = "#00b0ff";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, topLinePx);
  ctx.lineTo(w, topLinePx);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, bottomLinePx);
  ctx.lineTo(w, bottomLinePx);
  ctx.stroke();

  /* ROI */
  const size = 28;
  const eyeY = Math.floor((topLinePx + bottomLinePx) / 2);

  const sx = Math.floor(w / 2 - size / 2);
  const sy = Math.min(h - size, Math.max(0, Math.floor(eyeY - size / 2)));

  ctx.strokeStyle = "red";
  ctx.strokeRect(sx, sy, size, size);

  let img;
  try {
    img = ctx.getImageData(sx, sy, size, size).data;
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

  /* ガイド線帯判定（広め） */
  const inBand = (roiCenterY >= topLinePx && roiCenterY <= bottomLinePx);

  /* 明るさ差分（緩め） */
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

  /* 描画ループ */
  const frameLoop = setInterval(() => {
    if (!running) return clearInterval(frameLoop);

    const ok = processFrame();

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
