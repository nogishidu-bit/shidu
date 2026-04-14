/* 設定 */
const FPS = 30;
const DURATION_SEC = 20;

/* 画面切り替え */
const startScreen = document.getElementById("start-screen");
const measureScreen = document.getElementById("measure-screen");
const resultScreen = document.getElementById("result-screen");

/* 要素取得（待機画面） */
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* 要素取得（測定画面） */
const video2 = document.getElementById("video2");
const canvas2 = document.getElementById("canvas2");
const ctx2 = canvas2.getContext("2d");

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

/* 状態管理 */
let rgbSeries = [];
let brightnessSeries = [];
let baseBrightness = null;
let baseSamples = [];
let running = false;
let eyeOut = false;
let validSeconds = 0;

/* 画面切り替え関数 */
function showScreen(screen) {
  startScreen.classList.remove("active");
  measureScreen.classList.remove("active");
  resultScreen.classList.remove("active");

  screen.classList.add("active");
}

/* カメラ起動 */
async function initCamera(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", frameRate: { ideal: FPS } },
    audio: false
  });
  videoElement.srcObject = stream;
}

/* ROI + ガイド線 + eyeOut 判定（canvas 内で完結） */
function processFrame(ctx, video, canvas) {
  const w = canvas.width;
  const h = canvas.height;

  ctx.drawImage(video, 0, 0, w, h);

  /* --- ガイド線（canvas に描画）--- */
  const topLinePx = h * 0.30;
  const bottomLinePx = h * 0.38;

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

  /* --- ROI --- */
  const size = 28;
  const eyeY = Math.floor((topLinePx + bottomLinePx) / 2);

  const sx = Math.floor(w / 2 - size / 2);
  const sy = Math.min(h - size, Math.max(0, Math.floor(eyeY - size / 2)));

  ctx.strokeStyle = "red";
  ctx.strokeRect(sx, sy, size, size);

  let img;
  try {
    img = ctx.getImageData(sx, sy, size, size).data;
  } catch (e) {
    return false;
  }

  /* --- RGB 平均値 --- */
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

  /* --- 基準明るさ --- */
  if (baseBrightness === null && baseSamples.length < FPS) {
    baseSamples.push(brightness);
    if (baseSamples.length === FPS) {
      baseBrightness = mean(baseSamples);
    }
  }

  /* --- ROI 中心 --- */
  const roiCenterY = sy + size / 2;

  /* --- ガイド線帯判定 --- */
  const inBand = (roiCenterY >= topLinePx && roiCenterY <= bottomLinePx);

  /* --- 明るさ差分 --- */
  let diffOK = true;
  if (baseBrightness) {
    const diff = Math.abs(brightness - baseBrightness);
    diffOK = diff < 18;
  }

  return inBand && diffOK;
}

/* --- 数学系ユーティリティ --- */
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function detrendAndSmooth(sig, win = 5) {
  const n = sig.length;
  const m = mean(sig);
  const x = sig.map(v => v - m);
  const y = [];
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j >= 0 && j < n) { s += x[j]; c++; }
    }
    y.push(s / c);
  }
  return y;
}

/* POS法 */
function pos(rgbSeries) {
  const n = rgbSeries.length;
  const r = rgbSeries.map(v => v[0]);
  const g = rgbSeries.map(v => v[1]);
  const b = rgbSeries.map(v => v[2]);

  const mr = mean(r), mg = mean(g), mb = mean(b);
  const X = [], Y = [];
  for (let i = 0; i < n; i++) {
    const nr = r[i] / mr;
    const ng = g[i] / mg;
    const nb = b[i] / mb;
    X.push(ng - nb);
    Y.push(-2 * nr + ng + nb);
  }
  const alpha = std(X) / (std(Y) || 1);
  const s = X.map((v, i) => v + alpha * Y[i]);
  return detrendAndSmooth(s, 3);
}

/* FFT → HR/SNR */
function fftHR(signal, fps) {
  const n = signal.length;
  const re = new Array(n).fill(0);
  const im = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      re[k] += signal[t] * Math.cos(angle);
      im[k] += signal[t] * Math.sin(angle);
    }
  }

  const mag = [];
  for (let k = 0; k < n / 2; k++) {
    mag.push(Math.sqrt(re[k] ** 2 + im[k] ** 2));
  }

  const df = fps / n;
  const minHz = 0.7, maxHz = 4.0;
  const minIndex = Math.floor(minHz / df);
  const maxIndex = Math.floor(maxHz / df);

  let maxVal = -1, maxIdx = minIndex;
  let sum = 0;
  for (let k = minIndex; k <= maxIndex; k++) {
    const v = mag[k];
    if (v > maxVal) { maxVal = v; maxIdx = k; }
    sum += v;
  }

  const peakFreq = maxIdx * df;
  const hr = peakFreq * 60;
  const noiseMean = sum / (maxIndex - minIndex + 1);
  const snr = 10 * Math.log10((maxVal + 1e-6) / (noiseMean + 1e-6));

  return { hr, snr };
}

/* HRV（RMSSD） */
function estimateHRV(signal, fps) {
  const peaks = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) peaks.push(i);
  }
  if (peaks.length < 3) return null;

  const rr = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    rr.push((peaks[i + 1] - peaks[i]) / fps);
  }
  if (rr.length < 2) return null;

  const diff2 = [];
  for (let i = 0; i < rr.length - 1; i++) {
    diff2.push((rr[i + 1] - rr[i]) ** 2);
  }
  return Math.sqrt(mean(diff2)) * 1000;
}

/* まぶたスコア */
function eyelidScore(brightnessSeries) {
  if (brightnessSeries.length < 10) return 50;

  const minB = Math.min(...brightnessSeries);
  const maxB = Math.max(...brightnessSeries);
  const norm = brightnessSeries.map(v => (v - minB) / (maxB - minB + 1e-6));

  const avgOpen = mean(norm);

  let blinks = 0;
  for (let i = 1; i < norm.length; i++) {
    if (norm[i] < norm[i - 1] - 0.15) blinks++;
  }

  const blinkPenalty = Math.min(0.3, blinks / 20);
  const score = (avgOpen - blinkPenalty) * 100;
  return Math.max(0, Math.min(100, score));
}

/* 疲労スコア */
function fatigueScore(hr, snr, rmssd, eyelid) {
  const hrNorm = Math.max(0, Math.min(1, (hr - 50) / 50));
  const snrNorm = Math.max(0, Math.min(1, snr / 10));
  const rmssdNorm = rmssd ? Math.max(0, Math.min(1, rmssd / 80)) : 0.5;
  const eyeNorm = eyelid / 100;

  const fatigue =
    hrNorm * 0.30 +
    (1 - rmssdNorm) * 0.35 +
    (1 - eyeNorm) * 0.25 +
    (1 - snrNorm) * 0.05 +
    0.05;

  return Math.round((1 - fatigue) * 100);
}

/* 測定終了 */
function finishMeasurement() {
  running = false;

  showScreen(resultScreen);

  const sig = pos(rgbSeries);
  const { hr, snr } = fftHR(sig, FPS);
  const rmssd = estimateHRV(sig, FPS);
  const eyelid = eyelidScore(brightnessSeries);
  const score = fatigueScore(hr, snr, rmssd, eyelid);

  fatigueEl.textContent = score;
  levelEl.textContent = fatigueLevel(score);
  workEl.textContent = fatigueWorkStatus(score);
  dangerEl.textContent = dangerWorkStatus(score);

  let txt = "";
  txt += `推定HR: ${hr.toFixed(1)} bpm\n`;
  txt += `SNR: ${snr.toFixed(1)} dB\n`;
  txt += rmssd ? `HRV(RMSSD): ${rmssd.toFixed(1)} ms\n` : `HRV(RMSSD): 推定不可\n`;
  txt += `まぶたスコア: ${eyelid.toFixed(1)} / 100\n`;
  txt += `※参考値（医療用途では使用不可）`;
  resultsEl.textContent = txt;
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

  await initCamera(video2);

  running = true;

  const frameLoop = setInterval(() => {
    if (!running) return clearInterval(frameLoop);

    const ok = processFrame(ctx2, video2, canvas2);

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
      const progress = (validSeconds / DURATION_SEC) * 100;
      progressBar.style.width = `${progress}%`;
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
retryBtn.addEventListener("click", () => {
  showScreen(startScreen);
});
