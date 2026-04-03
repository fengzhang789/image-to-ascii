// Unicode Braille block starts at U+2800
// Each character encodes 8 dots in a 2-column × 4-row grid:
//   col 0 (left):  row 0→bit 0x01, row 1→0x02, row 2→0x04, row 3→0x40
//   col 1 (right): row 0→bit 0x08, row 1→0x10, row 2→0x20, row 3→0x80
const BRAILLE_BASE = 0x2800;
const DOT_BITS = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
];

function imageDataToBraille(imageData, pixelWidth, pixelHeight, invert, threshold) {
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
          let lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          if (invert) lum = 255 - lum;
          if (lum < threshold) bits |= DOT_BITS[dy][dx];
        }
      }
      line += String.fromCodePoint(BRAILLE_BASE + bits);
    }
    lines.push(line.trimEnd());
  }

  return lines.join("\n").replace(/\n+$/, "");
}

function imageFileToBraille(file, charWidth, invert, threshold) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      // Each braille char = 2 px wide, 4 px tall.
      // Terminal chars are ~2× taller than wide, and each braille cell is also 2:1,
      // so no additional aspect correction is needed.
      const pixelWidth  = charWidth * 2;
      const pixelHeight = Math.max(4, Math.round(pixelWidth * (img.naturalHeight / img.naturalWidth)));

      canvas.width  = pixelWidth;
      canvas.height = pixelHeight;

      // White background to handle transparency
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
      ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

      const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
      resolve(imageDataToBraille(imageData, pixelWidth, pixelHeight, invert, threshold));
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

// ── UI wiring ──────────────────────────────────────────────────────────────

let currentFile = null;

const dropZone       = document.getElementById("drop-zone");
const fileInput      = document.getElementById("file-input");
const convertBtn     = document.getElementById("convert-btn");
const copyBtn        = document.getElementById("copy-btn");
const output         = document.getElementById("ascii-output");
const copyStatus     = document.getElementById("copy-status");
const widthInput     = document.getElementById("width-input");
const invertInput    = document.getElementById("invert-input");
const threshInput    = document.getElementById("threshold-input");
const threshVal      = document.getElementById("threshold-value");
const codeblockInput = document.getElementById("codeblock-input");

threshInput.addEventListener("input", () => { threshVal.textContent = threshInput.value; });

function setFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  currentFile = file;
  dropZone.textContent = `Selected: ${file.name}`;
  convertBtn.disabled = false;
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

  const charWidth = Math.max(10, Math.min(300, parseInt(widthInput.value, 10) || 80));
  const invert    = invertInput.checked;
  const threshold = parseInt(threshInput.value, 10);
  const codeblock = codeblockInput.checked;

  convertBtn.disabled = true;
  convertBtn.textContent = "Converting…";
  output.textContent = "";
  copyBtn.disabled = true;

  try {
    const braille = await imageFileToBraille(currentFile, charWidth, invert, threshold);
    output.textContent = codeblock ? `\`\`\`\n${braille}\n\`\`\`` : braille;
    copyBtn.disabled = false;
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
