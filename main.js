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

function imageDataToBraille(imageData, pixelWidth, pixelHeight, threshold) {
  const { data } = imageData;
  const charWidth  = Math.ceil(pixelWidth  / 2);
  const charHeight = Math.ceil(pixelHeight / 4);
  const lines = [];

  for (let cy = 0; cy < charHeight; cy++) {
    let line = "";
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

  return lines.join("\n").replace(/\n+$/, "");
}

function buildFilterString(brightness, contrast, grayscale, invert) {
  return `brightness(${brightness}%) contrast(${contrast}%) grayscale(${grayscale}%)${invert ? " invert(100%)" : ""}`;
}

function imageFileToBraille(file, charWidth, invert, threshold, brightness, contrast, grayscale) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      const pixelWidth  = charWidth * 2;
      const pixelHeight = Math.max(4, Math.round(pixelWidth * (img.naturalHeight / img.naturalWidth)));

      canvas.width  = pixelWidth;
      canvas.height = pixelHeight;

      ctx.filter = buildFilterString(brightness, contrast, grayscale, invert);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
      ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
      ctx.filter = "none";

      const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
      resolve(imageDataToBraille(imageData, pixelWidth, pixelHeight, threshold));
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

// ── UI wiring ──────────────────────────────────────────────────────────────

let currentFile = null;
let previewImg  = null;

const dropZone        = document.getElementById("drop-zone");
const fileInput       = document.getElementById("file-input");
const convertBtn      = document.getElementById("convert-btn");
const copyBtn         = document.getElementById("copy-btn");
const saveBtn         = document.getElementById("save-btn");
const resetBtn        = document.getElementById("reset-btn");
const output          = document.getElementById("braille-output");
const copyStatus      = document.getElementById("copy-status");
const widthInput      = document.getElementById("width-input");
const brightnessInput = document.getElementById("brightness-input");
const brightnessVal   = document.getElementById("brightness-val");
const contrastInput   = document.getElementById("contrast-input");
const contrastVal     = document.getElementById("contrast-val");
const grayscaleInput  = document.getElementById("grayscale-input");
const grayscaleVal    = document.getElementById("grayscale-val");
const invertInput     = document.getElementById("invert-input");
const threshInput     = document.getElementById("threshold-input");
const threshVal       = document.getElementById("threshold-val");
const codeblockInput  = document.getElementById("codeblock-input");
const previewSection  = document.getElementById("preview-section");
const previewCanvas   = document.getElementById("preview-canvas");

const DEFAULTS = { width: 60, brightness: 100, contrast: 100, grayscale: 0, threshold: 128, invert: false, codeblock: true };

function syncSliderLabels() {
  brightnessVal.textContent = brightnessInput.value + "%";
  contrastVal.textContent   = contrastInput.value   + "%";
  grayscaleVal.textContent  = grayscaleInput.value  + "%";
  threshVal.textContent     = threshInput.value;
}

function updatePreview() {
  if (!previewImg) return;
  const ctx = previewCanvas.getContext("2d");

  const MAX_W = previewSection.clientWidth || 860;
  const MAX_H = 420;
  const scale = Math.min(1, MAX_W / previewImg.naturalWidth, MAX_H / previewImg.naturalHeight);
  const w = Math.round(previewImg.naturalWidth  * scale);
  const h = Math.round(previewImg.naturalHeight * scale);

  previewCanvas.width  = w;
  previewCanvas.height = h;

  const brightness = parseInt(brightnessInput.value, 10);
  const contrast   = parseInt(contrastInput.value, 10);
  const grayscale  = parseInt(grayscaleInput.value, 10);
  const invert     = invertInput.checked;

  ctx.filter = buildFilterString(brightness, contrast, grayscale, invert);
  ctx.drawImage(previewImg, 0, 0, w, h);
  ctx.filter = "none";
}

brightnessInput.addEventListener("input", () => { syncSliderLabels(); updatePreview(); });
contrastInput.addEventListener("input",   () => { syncSliderLabels(); updatePreview(); });
grayscaleInput.addEventListener("input",  () => { syncSliderLabels(); updatePreview(); });
threshInput.addEventListener("input",     syncSliderLabels);
invertInput.addEventListener("change",    updatePreview);

resetBtn.addEventListener("click", () => {
  widthInput.value       = DEFAULTS.width;
  brightnessInput.value  = DEFAULTS.brightness;
  contrastInput.value    = DEFAULTS.contrast;
  grayscaleInput.value   = DEFAULTS.grayscale;
  threshInput.value      = DEFAULTS.threshold;
  invertInput.checked    = DEFAULTS.invert;
  codeblockInput.checked = DEFAULTS.codeblock;
  syncSliderLabels();
  updatePreview();
});

function setFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  currentFile = file;
  dropZone.textContent = `Selected: ${file.name}`;
  dropZone.classList.add("has-file");
  convertBtn.disabled = false;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    previewImg = img;
    previewSection.style.display = "flex";
    updatePreview();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  setFile(e.dataTransfer.files[0]);
});

convertBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  const charWidth  = Math.max(10, Math.min(300, parseInt(widthInput.value, 10) || 60));
  const brightness = parseInt(brightnessInput.value, 10);
  const contrast   = parseInt(contrastInput.value, 10);
  const grayscale  = parseInt(grayscaleInput.value, 10);
  const invert     = invertInput.checked;
  const threshold  = parseInt(threshInput.value, 10);
  const codeblock  = codeblockInput.checked;

  convertBtn.disabled = true;
  convertBtn.textContent = "Converting…";
  output.textContent = "";
  copyBtn.disabled = true;
  saveBtn.disabled = true;

  try {
    const braille = await imageFileToBraille(currentFile, charWidth, invert, threshold, brightness, contrast, grayscale);
    output.textContent = codeblock ? `\`\`\`\n${braille}\n\`\`\`` : braille;
    copyBtn.disabled = false;
    saveBtn.disabled = false;
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = "Convert";
  }
});

copyBtn.addEventListener("click", async () => {
  const text = output.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.classList.add("show");
    setTimeout(() => copyStatus.classList.remove("show"), 1800);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(output);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
});

saveBtn.addEventListener("click", () => {
  const text = output.textContent;
  if (!text) return;
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (currentFile?.name.replace(/\.[^.]+$/, "") ?? "braille") + ".txt";
  a.click();
  URL.revokeObjectURL(a.href);
});
