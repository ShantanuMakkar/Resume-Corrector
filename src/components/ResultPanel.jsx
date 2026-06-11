import { useState } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { groupItemsIntoLines } from "../lib/pdfLines";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Characters that standard WinAnsi fonts can't handle — map to safe equivalents
const CHAR_MAP = {
  "●": "•", "◦": "•", "▪": "•",
  "–": "-", "—": "-",
  "'": "'", "'": "'",
  "\u201C": '"', "\u201D": '"',
  "…": "...",
};

function sanitize(text) {
  return [...text].map((ch) => CHAR_MAP[ch] ?? ch).join("");
}

// Word-level diff between two lines using LCS
function diffLineWords(origLine, tailLine) {
  const a = origLine.split(/(\s+)/).filter((t) => t !== "");
  const b = tailLine.split(/(\s+)/).filter((t) => t !== "");
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ type: "same", value: a[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type: "removed", value: a[i] }); i++; }
    else { ops.push({ type: "added", value: b[j] }); j++; }
  }
  while (i < m) ops.push({ type: "removed", value: a[i++] });
  while (j < n) ops.push({ type: "added", value: b[j++] });
  return ops;
}

function renderDiffTokens(ops, side) {
  return ops.map((tok, idx) => {
    if (side === "original" && tok.type === "added") return null;
    if (side === "tailored" && tok.type === "removed") return null;
    if (tok.type === "same") return tok.value;
    const cls = tok.type === "removed" ? "diff-word-removed" : "diff-word-added";
    return <mark key={idx} className={cls}>{tok.value}</mark>;
  });
}

// Detect if a pdfjs text item is bold by inspecting its fontName
function isBoldItem(item) {
  const fn = (item.fontName || "").toLowerCase();
  return fn.includes("bold") || fn.includes("heavy") || fn.includes("black");
}

async function buildTailoredPDF(originalFile, originalText, tailoredText) {
  const arrayBuffer = await originalFile.arrayBuffer();

  const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const pdfLibDoc = await PDFDocument.load(arrayBuffer);
  const pages = pdfLibDoc.getPages();

  // Embed only standard fonts — 100% reliable, no font corruption
  const fontRegular = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

  const normalize = (line) => line.replace(/\s+/g, " ").trim();
  const originalLines = originalText.split("\n").map(normalize).filter(Boolean);
  const tailoredLines = tailoredText.split("\n").map(normalize).filter(Boolean);

  // Map original line → tailored line (positional, line-by-line)
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

    // Build a boldness map: line text → is bold (based on first item's font)
    const lineBoldMap = new Map();
    for (const line of lines) {
      if (line.items && line.items.length > 0) {
        // groupItemsIntoLines doesn't preserve items on the returned object,
        // so we detect bold from the raw items by matching y position
        const firstRawItem = textContent.items.find(
          (it) => Math.abs(it.transform[5] - line.y) < line.height * 0.4
        );
        lineBoldMap.set(line.text, firstRawItem ? isBoldItem(firstRawItem) : false);
      }
    }

    for (const line of lines) {
      const replacement = replacements.get(line.text);
      if (!replacement) continue;

      const lineWidth = line.xEnd - line.x;
      const isBold = lineBoldMap.get(line.text) ?? false;
      const font = isBold ? fontBold : fontRegular;
      const safeText = sanitize(replacement);

      // White out original line with a slight vertical padding
      pdfLibPage.drawRectangle({
        x: line.x - 1,
        y: line.y - line.height * 0.3,
        width: lineWidth + 4,
        height: line.height * 1.5,
        color: rgb(1, 1, 1),
      });

      // Scale font down if replacement text is longer than available width
      let fontSize = line.height * 0.95;
      const naturalWidth = font.widthOfTextAtSize(safeText, fontSize);
      if (naturalWidth > lineWidth && naturalWidth > 0) {
        fontSize = Math.max(6, fontSize * (lineWidth / naturalWidth));
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

  return await pdfLibDoc.save();
}

function computeDiff(original, tailored) {
  const origLines = original.split("\n");
  const tailLines = tailored.split("\n");
  const maxLen = Math.max(origLines.length, tailLines.length);
  return Array.from({ length: maxLen }, (_, i) => {
    const o = origLines[i] ?? "";
    const t = tailLines[i] ?? "";
    const changed = o !== t;
    return { original: o, tailored: t, changed, ops: changed ? diffLineWords(o, t) : null };
  });
}

export default function ResultPanel({ originalText, tailoredText, originalFile, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const diff = computeDiff(originalText, tailoredText);
  const changedCount = diff.filter((l) => l.changed && l.tailored.trim()).length;

  async function handleDownload() {
    if (pdfUrl) { triggerDownload(pdfUrl); return; }
    setBuilding(true);
    try {
      const pdfBytes = await buildTailoredPDF(originalFile, originalText, tailoredText);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      triggerDownload(url);
    } catch (err) {
      console.error("PDF build error:", err);
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
          <button className="btn-download" onClick={handleDownload} disabled={building}>
            {building ? <><span className="spinner spinner-sm" /> Building PDF…</> : "↓ Download PDF"}
          </button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab ${view === "diff" ? "tab-active" : ""}`} onClick={() => setView("diff")}>Changes</button>
        <button className={`tab ${view === "tailored" ? "tab-active" : ""}`} onClick={() => setView("tailored")}>Full text</button>
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