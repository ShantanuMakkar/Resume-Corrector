import { useState, useEffect } from "react";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Compute which words changed between original and tailored text
function diffWords(original, tailored) {
  const origWords = original.split(/\s+/);
  const newWords = tailored.split(/\s+/);
  const changed = new Set();
  const maxLen = Math.max(origWords.length, newWords.length);
  for (let i = 0; i < maxLen; i++) {
    if (origWords[i] !== newWords[i]) changed.add(i);
  }
  return { origWords, newWords, changed };
}

// Build a new PDF by replacing text content page by page.
// Strategy: render original PDF page as a background image (via canvas),
// then overlay the tailored text blocks on top using pdf-lib.
async function buildTailoredPDF(originalFile, originalText, tailoredText) {
  const arrayBuffer = await originalFile.arrayBuffer();

  // Load with pdfjs to get per-page text items with positions
  const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const pdfLibDoc = await PDFDocument.load(arrayBuffer);
  const pages = pdfLibDoc.getPages();

  // Embed a monospace font for fallback overlays
  const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

  // Flatten tailored text into tokens for sequential replacement
  const tailoredLines = tailoredText.split("\n");
  const originalLines = originalText.split("\n");

  // Build a word-level diff map
  const origFlat = originalText.replace(/\s+/g, " ").trim();
  const tailFlat = tailoredText.replace(/\s+/g, " ").trim();
  const origTokens = origFlat.split(" ");
  const tailTokens = tailFlat.split(" ");

  // Create a replacement map: original phrase → tailored phrase
  // We do sentence-level matching to find what changed
  const replacements = buildReplacementMap(originalLines, tailoredLines);

  // For each page, find text items and apply replacements
  for (let pageIdx = 0; pageIdx < pdfjsDoc.numPages; pageIdx++) {
    const pdfjsPage = await pdfjsDoc.getPage(pageIdx + 1);
    const viewport = pdfjsPage.getViewport({ scale: 1.0 });
    const textContent = await pdfjsPage.getTextContent();
    const pdfLibPage = pages[pageIdx];
    const { height: pageHeight } = pdfLibPage.getSize();

    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === "") continue;

      const replacement = findReplacement(item.str, replacements);
      if (!replacement) continue;

      // Convert pdfjs coordinates (bottom-left origin) to pdf-lib coords
      const tx = item.transform[4];
      const ty = item.transform[5];
      // pdfjs viewport is top-left, pdf-lib is bottom-left
      const x = tx;
      const y = pageHeight - viewport.height + ty;

      // Approximate font size from transform matrix
      const fontSize = Math.abs(item.transform[3]) || 10;

      // White out original text
      const textWidth = item.width || font.widthOfTextAtSize(item.str, fontSize);
      pdfLibPage.drawRectangle({
        x: x - 1,
        y: y - 2,
        width: textWidth + 2,
        height: fontSize + 3,
        color: rgb(1, 1, 1),
        opacity: 1,
      });

      // Draw replacement text
      pdfLibPage.drawText(replacement, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth: textWidth + 20,
      });
    }
  }

  const pdfBytes = await pdfLibDoc.save();
  return pdfBytes;
}

function buildReplacementMap(originalLines, tailoredLines) {
  const map = new Map();
  const maxLines = Math.max(originalLines.length, tailoredLines.length);

  for (let i = 0; i < maxLines; i++) {
    const orig = (originalLines[i] || "").trim();
    const tail = (tailoredLines[i] || "").trim();
    if (orig && tail && orig !== tail) {
      // Find sub-phrase differences within the line
      const origPhrases = orig.split(/[,;]/);
      const tailPhrases = tail.split(/[,;]/);
      origPhrases.forEach((phrase, j) => {
        const origP = phrase.trim();
        const tailP = (tailPhrases[j] || "").trim();
        if (origP && tailP && origP !== tailP) {
          map.set(origP, tailP);
        }
      });
      // Also map the whole line
      map.set(orig, tail);
    }
  }
  return map;
}

function findReplacement(str, map) {
  const trimmed = str.trim();
  if (map.has(trimmed)) return map.get(trimmed);
  // Partial match: check if the text is a key substring
  for (const [orig, repl] of map.entries()) {
    if (orig.includes(trimmed) && orig.length < trimmed.length * 2) {
      // Extract the corresponding part from replacement
      return repl;
    }
  }
  return null;
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
    result.push({ original: o, tailored: t, changed: o !== t });
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
                <div className="diff-line diff-removed">{line.original || <em>—</em>}</div>
                <div className="diff-line diff-added">{line.tailored || <em>—</em>}</div>
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
