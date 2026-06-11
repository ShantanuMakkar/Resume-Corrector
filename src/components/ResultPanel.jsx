import { useState } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

// Word-level diff between two strings using LCS
function diffWords(origStr, tailStr) {
  const a = origStr.split(/(\s+)/).filter(Boolean);
  const b = tailStr.split(/(\s+)/).filter(Boolean);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ type: "same", value: a[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type: "del", value: a[i] }); i++; }
    else { ops.push({ type: "add", value: b[j] }); j++; }
  }
  while (i < m) ops.push({ type: "del", value: a[i++] });
  while (j < n) ops.push({ type: "add", value: b[j++] });
  return ops;
}

// Render one side of a word diff
function DiffLine({ ops, side }) {
  return (
    <span>
      {ops.map((tok, i) => {
        if (tok.type === "same") return <span key={i}>{tok.value}</span>;
        if (side === "original" && tok.type === "del")
          return <mark key={i} className="hl-del">{tok.value}</mark>;
        if (side === "tailored" && tok.type === "add")
          return <mark key={i} className="hl-add">{tok.value}</mark>;
        return null;
      })}
    </span>
  );
}

// Similarity score between two strings (0–1), used for fuzzy paragraph matching
function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = b.toLowerCase().split(/\s+/);
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}

// Paragraph-level LCS diff — matches paragraphs by similarity, not position
// Returns array of { type: "same"|"changed"|"added"|"removed", original, tailored, ops }
function computeParagraphDiff(originalText, tailoredText) {
  const origParas = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);

  const results = [];

  // Greedy matching: for each original paragraph, find best match in tailored
  const usedTail = new Set();

  for (let i = 0; i < origParas.length; i++) {
    const orig = origParas[i];

    // Find best matching tailored paragraph not yet used
    let bestIdx = -1;
    let bestScore = 0;
    for (let j = 0; j < tailParas.length; j++) {
      if (usedTail.has(j)) continue;
      const score = similarity(orig, tailParas[j]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestIdx === -1 || bestScore < 0.3) {
      // No good match — this paragraph was removed
      results.push({ type: "removed", original: orig, tailored: "" });
    } else {
      const tail = tailParas[bestIdx];
      usedTail.add(bestIdx);

      if (orig === tail) {
        // Identical — skip (don't show in diff)
        results.push({ type: "same", original: orig, tailored: tail });
      } else {
        const ops = diffWords(orig, tail);
        const hasChange = ops.some(op => op.type !== "same");
        if (hasChange) {
          results.push({ type: "changed", original: orig, tailored: tail, ops });
        } else {
          results.push({ type: "same", original: orig, tailored: tail });
        }
      }
    }
  }

  // Any tailored paragraphs not matched are "added"
  for (let j = 0; j < tailParas.length; j++) {
    if (!usedTail.has(j)) {
      results.push({ type: "added", original: "", tailored: tailParas[j] });
    }
  }

  return results;
}

export default function ResultPanel({ originalText, tailoredText, originalFile, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");

  const diff = computeParagraphDiff(originalText, tailoredText);
  const changedCount = diff.filter(d => d.type === "changed").length;
  const totalOriginal = diff.filter(d => d.type !== "added").length;
  const preservedPct = totalOriginal > 0
    ? Math.round(((totalOriginal - changedCount) / totalOriginal) * 100)
    : 100;

  async function buildDocx() {
    if (docxUrl) return docxUrl;
    setBuilding(true);
    setBuildError("");
    try {
      const docxBuffer = await injectTextIntoDocx(originalFile, originalText, tailoredText);
      const blob = new Blob([docxBuffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      setDocxUrl(url);
      return url;
    } catch (err) {
      setBuildError("Failed to build document: " + err.message);
      return null;
    } finally {
      setBuilding(false);
    }
  }

  async function handleDownloadDocx() {
    const url = await buildDocx();
    if (!url) return;
    triggerDownload(url, originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx");
  }

  async function handleOpenGoogleDocs() {
    const url = await buildDocx();
    if (!url) return;
    triggerDownload(url, originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx");
    setTimeout(() => window.open("https://docs.google.com/", "_blank"), 500);
  }

  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  const changedDiffs = diff.filter(d => d.type === "changed" || d.type === "added" || d.type === "removed");

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{changedCount} paragraph{changedCount !== 1 ? "s" : ""} changed</span>
          <span className="badge-sub">{preservedPct}% preserved</span>
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
        </div>
      </div>

      <div className="download-row">
        <button className="btn-download" onClick={handleDownloadDocx} disabled={building}>
          {building ? (
            <><span className="spinner spinner-sm" /> Building…</>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 11h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
              </svg>
              Download .docx
            </>
          )}
        </button>

        <button className="btn-gdocs" onClick={handleOpenGoogleDocs} disabled={building}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 5h6M4 7.5h6M4 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Open in Google Docs
        </button>

        <span className="gdocs-hint">Download → upload to Google Docs → export as PDF</span>
      </div>

      {buildError && <p className="error-msg" style={{ margin: "0 20px 16px" }}>{buildError}</p>}

      <div className="tab-bar">
        <button className={`tab ${view === "diff" ? "tab-active" : ""}`} onClick={() => setView("diff")}>
          Changes {changedCount > 0 && <span className="tab-count">{changedCount}</span>}
        </button>
        <button className={`tab ${view === "full" ? "tab-active" : ""}`} onClick={() => setView("full")}>
          Full text
        </button>
      </div>

      {view === "diff" ? (
        <div className="diff-view">
          {changedDiffs.length === 0 ? (
            <p className="no-changes">No changes detected — the resume already matches the JD well.</p>
          ) : (
            changedDiffs.map((entry, i) => (
              <div key={i} className={`diff-block diff-block-${entry.type}`}>
                {entry.type === "changed" && (
                  <>
                    <div className="diff-label del-label">Original</div>
                    <div className="diff-line diff-removed">
                      <DiffLine ops={entry.ops} side="original" />
                    </div>
                    <div className="diff-label add-label">Tailored</div>
                    <div className="diff-line diff-added">
                      <DiffLine ops={entry.ops} side="tailored" />
                    </div>
                  </>
                )}
                {entry.type === "removed" && (
                  <>
                    <div className="diff-label del-label">Removed</div>
                    <div className="diff-line diff-removed">{entry.original}</div>
                  </>
                )}
                {entry.type === "added" && (
                  <>
                    <div className="diff-label add-label">Added</div>
                    <div className="diff-line diff-added">{entry.tailored}</div>
                  </>
                )}
              </div>
            ))
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