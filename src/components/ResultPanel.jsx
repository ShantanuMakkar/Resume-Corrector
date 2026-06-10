import { useState, useEffect } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { groupItemsIntoLines } from "../lib/pdfLines";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Word-level diff between two lines using LCS, preserving whitespace tokens
function diffLineWords(origLine, tailLine) {
  const a = origLine.split(/(\s+)/).filter((t) => t !== "");
  const b = tailLine.split(/(\s+)/).filter((t) => t !== "");
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "removed", value: a[i] });
      i++;
    } else {
      ops.push({ type: "added", value: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: "removed", value: a[i++] });
  while (j < n) ops.push({ type: "added", value: b[j++] });

  return ops;
}

// Render the tokens for one side of a diffed line, highlighting changed words
function renderDiffTokens(ops, side) {
  return ops.map((tok, idx) => {
    if (side === "original" && tok.type === "added") return null;
    if (side === "tailored" && tok.type === "removed") return null;
    if (tok.type === "same") return tok.value;
    const cls = tok.type === "removed" ? "diff-word-removed" : "diff-word-added";
    return (
      <mark key={idx} className={cls}>
        {tok.value}
      </mark>
    );
  });
}

// Common Unicode characters that WinAnsi-encoded standard fonts can't draw,
// mapped to the closest character that font.widthOfTextAtSize can handle.
const PDF_CHAR_REPLACEMENTS = {
  "●": "•", // ● -> •
  "◦": "•", // ◦ -> •
  "▪": "•", // ▪ -> •
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‘": "'", // ‘
  "’": "'", // ’
  "“": '"', // “
  "”": '"', // ”
  "…": "...", // …
};

// Replace characters that the embedded font can't encode so drawText/widthOfTextAtSize don't throw
function sanitizeForFont(text, font) {
  let result = "";
  for (const ch of text) {
    const mapped = PDF_CHAR_REPLACEMENTS[ch] ?? ch;
    try {
      font.widthOfTextAtSize(mapped, 10);
      result += mapped;
    } catch {
      result += "-";
    }
  }
  return result;
}

// Build a new PDF by replacing changed lines in place.
// For each visual line, white out its bounding box and redraw the tailored
// text scaled to fit within the original line's width.
async function buildTailoredPDF(originalFile, originalText, tailoredText) {
  const arrayBuffer = await originalFile.arrayBuffer();

  // Load with pdfjs to get per-page text items with positions
  const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const pdfLibDoc = await PDFDocument.load(arrayBuffer);
  const pages = pdfLibDoc.getPages();

  const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);

  const normalize = (line) => line.replace(/\s+/g, " ").trim();
  const originalLines = originalText.split("\n").map(normalize).filter(Boolean);
  const tailoredLines = tailoredText.split("\n").map(normalize).filter(Boolean);

  // Map each original line to its tailored counterpart by position
  const replacements = new Map();
  const maxLines = Math.max(originalLines.length, tailoredLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = originalLines[i];
    const tail = tailoredLines[i];
    if (orig && tail && orig !== tail) {
      replacements.set(orig, tail);
    }
  }

  for (let pageIdx = 0; pageIdx < pdfjsDoc.numPages; pageIdx++) {
    const pdfjsPage = await pdfjsDoc.getPage(pageIdx + 1);
    const textContent = await pdfjsPage.getTextContent();
    const pdfLibPage = pages[pageIdx];

    const lines = groupItemsIntoLines(textContent.items);

    for (const line of lines) {
      if (!line.text) continue;
      const replacement = replacements.get(line.text);
      if (!replacement) continue;

      const width = line.xEnd - line.x;

      // White out the original line
      pdfLibPage.drawRectangle({
        x: line.x - 1,
        y: line.y - line.height * 0.25,
        width: width + 4,
        height: line.height * 1.3,
        color: rgb(1, 1, 1),
      });

      // Shrink the font if needed so the replacement fits the original width
      const safeText = sanitizeForFont(replacement, font);
      let fontSize = line.height;
      const naturalWidth = font.widthOfTextAtSize(safeText, fontSize);
      if (naturalWidth > width && naturalWidth > 0) {
        fontSize = Math.max(6, fontSize * (width / naturalWidth));
      }

      pdfLibPage.drawText(safeText, {
        x: line.x,
        y: line.y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  const pdfBytes = await pdfLibDoc.save();
  return pdfBytes;
}

// Highlight changed lines for the diff view
function computeDiff(original, tailored) {
  const origLines = original.split("\n");
  const tailLines = tailored.split("\n");
  const result = [];
  const maxLen = Math.max(origLines.length, tailLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i] ?? "";
    const t = tailLines[i] ?? "";
    const changed = o !== t;
    result.push({ original: o, tailored: t, changed, ops: changed ? diffLineWords(o, t) : null });
  }
  return result;
}

export default function ResultPanel({ originalText, tailoredText, originalFile, onReset }) {
  const [view, setView] = useState("diff"); // diff | tailored
  const [building, setBuilding] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const diff = computeDiff(originalText, tailoredText);
  const changedCount = diff.filter((l) => l.changed && l.tailored.trim()).length;

  async function handleDownload() {
    if (pdfUrl) {
      triggerDownload(pdfUrl);
      return;
    }
    setBuilding(true);
    try {
      const pdfBytes = await buildTailoredPDF(originalFile, originalText, tailoredText);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      triggerDownload(url);
    } catch (err) {
      console.error("PDF build error:", err);
      // Fallback: download as txt
      const blob = new Blob([tailoredText], { type: "text/plain" });
      triggerDownload(URL.createObjectURL(blob), "tailored-resume.txt");
    } finally {
      setBuilding(false);
    }
  }

  function triggerDownload(url, filename) {
    const name = filename || originalFile.name.replace(".pdf", "") + "-tailored.pdf";
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{changedCount} lines updated</span>
          <span className="badge-sub">~{Math.round((1 - changedCount / diff.length) * 100)}% preserved</span>
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
          <button
            className="btn-download"
            onClick={handleDownload}
            disabled={building}
          >
            {building ? (
              <><span className="spinner spinner-sm" /> Building PDF…</>
            ) : (
              "↓ Download PDF"
            )}
          </button>
        </div>
      </div>

      <div className="tab-bar">
        <button
          className={`tab ${view === "diff" ? "tab-active" : ""}`}
          onClick={() => setView("diff")}
        >
          Changes
        </button>
        <button
          className={`tab ${view === "tailored" ? "tab-active" : ""}`}
          onClick={() => setView("tailored")}
        >
          Full text
        </button>
      </div>

      {view === "diff" ? (
        <div className="diff-view">
          {diff.map((line, i) =>
            line.changed ? (
              <div key={i} className="diff-block">
                <div className="diff-line diff-removed">
                  {line.original ? renderDiffTokens(line.ops, "original") : <em>—</em>}
                </div>
                <div className="diff-line diff-added">
                  {line.tailored ? renderDiffTokens(line.ops, "tailored") : <em>—</em>}
                </div>
              </div>
            ) : null
          )}
          {diff.filter((l) => l.changed).length === 0 && (
            <p className="no-changes">No changes detected — the resume already matches the JD well.</p>
          )}
        </div>
      ) : (
        <div className="text-view">
          <pre>{tailoredText}</pre>
        </div>
      )}
    </div>
  );
}
