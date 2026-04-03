// Unicode Braille block starts at U+2800
// Each character encodes 8 dots in a 2-column × 4-row grid:
//   col 0 (left):  row 0→bit 0x01, row 1→0x02, row 2→0x04, row 3→0x40
//   col 1 (right): row 0→bit 0x08, row 1→0x10, row 2→0x20, row 3→0x80
const BRAILLE_BASE = 0x2800;
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

// ASCII character ramps (dark → light luminance maps to index 0 → last)
const ASCII_RAMPS = {
  standard: ' .:-=+*#%@',
  dense:    " .'`^,:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks:   ' ░▒▓█',
  minimal:  ' .+@',
};

// ── Convolution helpers ────────────────────────────────────────────────────

function applyConvolution(data, width, height, kernel) {
  const result = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(Math.max(x + kx, 0), width - 1);
          const sy = Math.min(Math.max(y + ky, 0), height - 1);
          const si = (sy * width + sx) * 4;
          const w = kernel[(ky + 1) * 3 + (kx + 1)];
          r += data[si]     * w;
          g += data[si + 1] * w;
          b += data[si + 2] * w;
        }
      }
      const i = (y * width + x) * 4;
      result[i]     = Math.min(Math.max(Math.round(r), 0), 255);
      result[i + 1] = Math.min(Math.max(Math.round(g), 0), 255);
      result[i + 2] = Math.min(Math.max(Math.round(b), 0), 255);
      result[i + 3] = data[i + 3];
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = result[i];
}

function applySharpen(data, width, height, amount) {
  const a = Math.min(amount, 10) * 0.1;
  applyConvolution(data, width, height, [
    0,   -a,        0,
   -a,  1 + 4 * a, -a,
    0,   -a,        0,
  ]);
}

function applySobel(data, width, height) {
  const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const result = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let Gx = 0, Gy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(Math.max(x + kx, 0), width - 1);
          const sy = Math.min(Math.max(y + ky, 0), height - 1);
          const si = (sy * width + sx) * 4;
          const lum = 0.299 * data[si] + 0.587 * data[si + 1] + 0.114 * data[si + 2];
          const ki = (ky + 1) * 3 + (kx + 1);
          Gx += lum * gxK[ki];
          Gy += lum * gyK[ki];
        }
      }
      const mag = Math.min(Math.sqrt(Gx * Gx + Gy * Gy), 255);
      const i = (y * width + x) * 4;
      result[i] = result[i + 1] = result[i + 2] = mag;
      result[i + 3] = 255;
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = result[i];
}

function applyPostProcessing(imageData, sharpness, edgeDetect) {
  const { data, width, height } = imageData;
  if (sharpness > 0) applySharpen(data, width, height, sharpness);
  if (edgeDetect)    applySobel(data, width, height);
}

// ── CSS filter string ──────────────────────────────────────────────────────

function buildFilterString(brightness, contrast, saturation, hue, invert, sharpness) {
  let f = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
  if (invert)      f += ' invert(100%)';
  if (sharpness < 0) f += ` blur(${(-sharpness * 0.3).toFixed(1)}px)`;
  return f;
}

// ── Converters ────────────────────────────────────────────────────────────

function imageDataToBraille(imageData, pixelWidth, pixelHeight, threshold) {
  const { data } = imageData;
  const charWidth  = Math.ceil(pixelWidth  / 2);
  const charHeight = Math.ceil(pixelHeight / 4);
  const lines = [];

  for (let cy = 0; cy < charHeight; cy++) {
    let line = '';
    for (let cx = 0; cx < charWidth; cx++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = cx * 2 + dx;
          const py = cy * 4 + dy;
          if (px >= pixelWidth || py >= pixelHeight) continue;
          const idx = (py * pixelWidth + px) * 4;
          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (lum < threshold) bits |= DOT_BITS[dy][dx];
        }
      }
      line += String.fromCodePoint(BRAILLE_BASE + bits);
    }
    lines.push(line.trimEnd());
  }

  return lines.join('\n').replace(/\n+$/, '');
}

function imageDataToAscii(imageData, pixelWidth, pixelHeight, rampKey, spaceDensity) {
  const { data } = imageData;
  const ramp = ASCII_RAMPS[rampKey] || ASCII_RAMPS.standard;
  const lines = [];

  for (let y = 0; y < pixelHeight; y++) {
    let line = '';
    for (let x = 0; x < pixelWidth; x++) {
      const idx = (y * pixelWidth + x) * 4;
      let lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      // Space density shifts luminance up → more pixels map to bright end (space)
      lum = Math.min(lum + (spaceDensity / 100) * 255, 255);
      const charIdx = Math.floor((lum / 255) * (ramp.length - 1));
      line += ramp[charIdx];
    }
    lines.push(line.trimEnd());
  }

  return lines.join('\n').replace(/\n+$/, '');
}

function addBorder(text) {
  const lines = text.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));
  const blank = ' '.repeat(maxLen + 2);
  const padded = lines.map(l => ' ' + l + ' '.repeat(maxLen - l.length) + ' ');
  return [blank, ...padded, blank].join('\n');
}

// ── Render to hidden canvas and convert ───────────────────────────────────

function renderToCanvas(canvas, img, pixelWidth, pixelHeight, filterStr) {
  const ctx = canvas.getContext('2d');
  canvas.width  = pixelWidth;
  canvas.height = pixelHeight;
  ctx.filter = filterStr;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
  ctx.filter = 'none';
  return ctx.getImageData(0, 0, pixelWidth, pixelHeight);
}

function convertImage(img, params) {
  const { mode, charWidth, brightness, contrast, saturation, hue, invert,
          sharpness, edgeDetect, threshold, rampKey, spaceDensity } = params;

  const filterStr = buildFilterString(brightness, contrast, saturation, hue, invert, sharpness);
  const canvas = document.getElementById('canvas');

  let pixelWidth, pixelHeight;
  if (mode === 'ascii') {
    // 1 char per pixel; account for monospace char being ~2× taller than wide
    pixelWidth  = charWidth;
    pixelHeight = Math.max(1, Math.round(charWidth * (img.naturalHeight / img.naturalWidth) * 0.45));
  } else {
    pixelWidth  = charWidth * 2;
    pixelHeight = Math.max(4, Math.round(pixelWidth * (img.naturalHeight / img.naturalWidth)));
  }

  const imageData = renderToCanvas(canvas, img, pixelWidth, pixelHeight, filterStr);
  applyPostProcessing(imageData, sharpness, edgeDetect);

  return mode === 'ascii'
    ? imageDataToAscii(imageData, pixelWidth, pixelHeight, rampKey, spaceDensity)
    : imageDataToBraille(imageData, pixelWidth, pixelHeight, threshold);
}

// ── Auto-tune ─────────────────────────────────────────────────────────────
//
// Analyzes the raw image histogram to compute optimal settings:
//  - Brightness + Contrast: histogram stretching so p2→0 and p98→255
//    Derivation: if CSS applies brightness(B%) then contrast(C%), the two-
//    equation system (p2→0, p98→255) gives:
//      B = 25500 / (p2 + p98)
//      C = 100 * (p2 + p98) / (p98 - p2)
//  - Threshold (braille): maps the raw median through the auto B/C to get
//    the luminance that sits at the midpoint after filtering
//  - Sharpness: Laplacian variance detects image blur; low variance → suggest
//    sharpening so fine detail survives the ASCII quantization step

function analyzeImage(img) {
  const AW = 250;
  const AH = Math.max(1, Math.round(AW * img.naturalHeight / img.naturalWidth));
  const ac  = document.createElement('canvas');
  ac.width  = AW;
  ac.height = AH;
  ac.getContext('2d').drawImage(img, 0, 0, AW, AH);
  const { data } = ac.getContext('2d').getImageData(0, 0, AW, AH);

  const n    = AW * AH;
  const lums = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    lums[i] = 0.299 * data[s] + 0.587 * data[s + 1] + 0.114 * data[s + 2];
  }

  // Percentiles
  const sorted = lums.slice().sort();
  const p2  = sorted[Math.floor(n * 0.02)];
  const p50 = sorted[Math.floor(n * 0.50)];
  const p98 = sorted[Math.floor(n * 0.98)];

  // Laplacian variance (blur/sharpness measure)
  let lapSumSq = 0;
  for (let y = 1; y < AH - 1; y++) {
    for (let x = 1; x < AW - 1; x++) {
      const c   = lums[y * AW + x];
      const lap = lums[(y-1)*AW+x] + lums[(y+1)*AW+x]
                + lums[y*AW+x-1]   + lums[y*AW+x+1] - 4 * c;
      lapSumSq += lap * lap;
    }
  }
  const lapVar = lapSumSq / ((AW - 2) * (AH - 2));

  return { p2, p50, p98, lapVar };
}

function computeAutoSettings(stats) {
  const { p2, p50, p98, lapVar } = stats;

  const sum  = Math.max(p2 + p98, 1);
  const diff = Math.max(p98 - p2, 5);

  const brightness = Math.round(Math.min(200, Math.max(30, 25500 / sum)));
  const contrast   = Math.round(Math.min(300, Math.max(50,  100 * sum / diff)));

  // Where does the raw median land after applying brightness → contrast?
  const mappedMedian = Math.min(255, Math.max(0,
    (p50 * brightness / 100 - 127.5) * contrast / 100 + 127.5
  ));
  const threshold = Math.round(Math.min(245, Math.max(10, mappedMedian)));

  // Sharpness: suggest sharpening for blurry images
  let sharpness = 0;
  if      (lapVar < 80)  sharpness = 7;
  else if (lapVar < 300) sharpness = 3;

  return { brightness, contrast, threshold, sharpness };
}

// ── UI wiring ──────────────────────────────────────────────────────────────

let currentFile = null;
let previewImg  = null;

const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const convertBtn      = document.getElementById('convert-btn');
const autoBtn         = document.getElementById('auto-btn');
const copyBtn         = document.getElementById('copy-btn');
const saveBtn         = document.getElementById('save-btn');
const resetBtn        = document.getElementById('reset-btn');
const output          = document.getElementById('art-output');
const copyStatus      = document.getElementById('copy-status');
const widthInput      = document.getElementById('width-input');
const modeInput       = document.getElementById('mode-input');
const brightnessInput = document.getElementById('brightness-input');
const brightnessVal   = document.getElementById('brightness-val');
const contrastInput   = document.getElementById('contrast-input');
const contrastVal     = document.getElementById('contrast-val');
const saturationInput = document.getElementById('saturation-input');
const saturationVal   = document.getElementById('saturation-val');
const hueInput        = document.getElementById('hue-input');
const hueVal          = document.getElementById('hue-val');
const invertInput     = document.getElementById('invert-input');
const sharpnessInput  = document.getElementById('sharpness-input');
const sharpnessVal    = document.getElementById('sharpness-val');
const edgeInput       = document.getElementById('edge-input');
const thresholdRow    = document.getElementById('threshold-row');
const threshInput     = document.getElementById('threshold-input');
const threshVal       = document.getElementById('threshold-val');
const asciiSection    = document.getElementById('ascii-section');
const rampInput       = document.getElementById('ramp-input');
const densityInput    = document.getElementById('density-input');
const densityVal      = document.getElementById('density-val');
const codeblockInput  = document.getElementById('codeblock-input');
const borderInput     = document.getElementById('border-input');
const previewSection  = document.getElementById('preview-section');
const previewCanvas   = document.getElementById('preview-canvas');

const DEFAULTS = {
  width: 60, mode: 'braille',
  brightness: 100, contrast: 100, saturation: 100, hue: 0, invert: false,
  sharpness: 0, edge: false,
  threshold: 128,
  ramp: 'standard', density: 0,
  codeblock: true, border: false,
};

function syncLabels() {
  brightnessVal.textContent = brightnessInput.value + '%';
  contrastVal.textContent   = contrastInput.value   + '%';
  saturationVal.textContent = saturationInput.value + '%';
  hueVal.textContent        = hueInput.value        + '°';
  sharpnessVal.textContent  = sharpnessInput.value;
  threshVal.textContent     = threshInput.value;
  densityVal.textContent    = densityInput.value    + '%';
}

function syncModeUI() {
  const isAscii = modeInput.value === 'ascii';
  asciiSection.style.display   = isAscii ? 'flex' : 'none';
  thresholdRow.style.display   = isAscii ? 'none' : 'grid';
}

function getParams() {
  return {
    mode:        modeInput.value,
    charWidth:   Math.max(10, Math.min(300, parseInt(widthInput.value, 10) || 60)),
    brightness:  parseInt(brightnessInput.value, 10),
    contrast:    parseInt(contrastInput.value, 10),
    saturation:  parseInt(saturationInput.value, 10),
    hue:         parseInt(hueInput.value, 10),
    invert:      invertInput.checked,
    sharpness:   parseInt(sharpnessInput.value, 10),
    edgeDetect:  edgeInput.checked,
    threshold:   parseInt(threshInput.value, 10),
    rampKey:     rampInput.value,
    spaceDensity: parseInt(densityInput.value, 10),
    codeblock:   codeblockInput.checked,
    border:      borderInput.checked,
  };
}

// ── Preview ────────────────────────────────────────────────────────────────

let previewTimer = null;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 30);
}

function updatePreview() {
  if (!previewImg) return;
  const p = getParams();
  const ctx = previewCanvas.getContext('2d');

  const MAX_W = previewSection.clientWidth || 860;
  const MAX_H = 420;
  const scale = Math.min(1, MAX_W / previewImg.naturalWidth, MAX_H / previewImg.naturalHeight);
  const w = Math.round(previewImg.naturalWidth  * scale);
  const h = Math.round(previewImg.naturalHeight * scale);
  previewCanvas.width  = w;
  previewCanvas.height = h;

  const filterStr = buildFilterString(p.brightness, p.contrast, p.saturation, p.hue, p.invert, p.sharpness);
  ctx.filter = filterStr;
  ctx.drawImage(previewImg, 0, 0, w, h);
  ctx.filter = 'none';

  // Apply post-processing to preview too so it matches the conversion
  if (p.sharpness > 0 || p.edgeDetect) {
    const imageData = ctx.getImageData(0, 0, w, h);
    applyPostProcessing(imageData, p.sharpness, p.edgeDetect);
    ctx.putImageData(imageData, 0, 0);
  }
}

// ── Controls wiring ────────────────────────────────────────────────────────

const sliderInputs = [brightnessInput, contrastInput, saturationInput, hueInput,
                      sharpnessInput, threshInput, densityInput];
sliderInputs.forEach(el => el.addEventListener('input', () => { syncLabels(); schedulePreview(); }));

[invertInput, edgeInput].forEach(el => el.addEventListener('change', schedulePreview));
modeInput.addEventListener('change', () => { syncModeUI(); schedulePreview(); });
rampInput.addEventListener('change', schedulePreview);

autoBtn.addEventListener('click', () => {
  if (!previewImg) return;
  autoBtn.textContent = 'Analyzing…';
  autoBtn.disabled = true;

  // Run after current frame so the button label updates
  requestAnimationFrame(() => {
    try {
      const stats    = analyzeImage(previewImg);
      const settings = computeAutoSettings(stats);
      brightnessInput.value = settings.brightness;
      contrastInput.value   = settings.contrast;
      threshInput.value     = settings.threshold;
      sharpnessInput.value  = settings.sharpness;
      syncLabels();
      schedulePreview();
    } finally {
      autoBtn.textContent = 'Auto';
      autoBtn.disabled = false;
    }
  });
});

resetBtn.addEventListener('click', () => {
  widthInput.value       = DEFAULTS.width;
  modeInput.value        = DEFAULTS.mode;
  brightnessInput.value  = DEFAULTS.brightness;
  contrastInput.value    = DEFAULTS.contrast;
  saturationInput.value  = DEFAULTS.saturation;
  hueInput.value         = DEFAULTS.hue;
  invertInput.checked    = DEFAULTS.invert;
  sharpnessInput.value   = DEFAULTS.sharpness;
  edgeInput.checked      = DEFAULTS.edge;
  threshInput.value      = DEFAULTS.threshold;
  rampInput.value        = DEFAULTS.ramp;
  densityInput.value     = DEFAULTS.density;
  codeblockInput.checked = DEFAULTS.codeblock;
  borderInput.checked    = DEFAULTS.border;
  syncLabels();
  syncModeUI();
  schedulePreview();
});

function setFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  currentFile = file;
  dropZone.textContent = `Selected: ${file.name}`;
  dropZone.classList.add('has-file');
  convertBtn.disabled = false;
  autoBtn.disabled    = false;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    previewImg = img;
    previewSection.style.display = 'flex';
    updatePreview();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  setFile(e.dataTransfer.files[0]);
});

convertBtn.addEventListener('click', async () => {
  if (!previewImg) return;

  const p = getParams();
  convertBtn.disabled = true;
  convertBtn.textContent = 'Converting…';
  output.textContent = '';
  copyBtn.disabled = true;
  saveBtn.disabled = true;

  try {
    // Run in next tick so the button state updates render first
    await new Promise(r => setTimeout(r, 0));
    let art = convertImage(previewImg, p);
    if (p.border) art = addBorder(art);
    output.textContent = p.codeblock ? `\`\`\`\n${art}\n\`\`\`` : art;
    copyBtn.disabled = false;
    saveBtn.disabled = false;
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = 'Convert';
  }
});

copyBtn.addEventListener('click', async () => {
  const text = output.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.classList.add('show');
    setTimeout(() => copyStatus.classList.remove('show'), 1800);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(output);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

saveBtn.addEventListener('click', () => {
  const text = output.textContent;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentFile?.name.replace(/\.[^.]+$/, '') ?? 'art') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Init
syncLabels();
syncModeUI();
