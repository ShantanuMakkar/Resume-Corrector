import { useState } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

function diffLineWords(origLine, tailLine) {
  const a = origLine.split(/(\s+)/).filter((t) => t !== "");
  const b = tailLine.split(/(\s+)/).filter((t) => t !== "");
  const m = a.length, n = b.length;
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

function computeDiff(original, tailored) {
  const origLines = original.split("\n");
  const tailLines = tailored.split("\n");
  const maxLen = Math.max(origLines.length, tailLines.length);
  return Array.from({ length: maxLen }, (_, i) => {
    const o = origLines[i] ?? "";
    const t = tailLines[i] ?? "";
    const changed = o.trim() !== t.trim();
    return { original: o, tailored: t, changed, ops: changed ? diffLineWords(o, t) : null };
  });
}

export default function ResultPanel({ originalText, tailoredText, originalFile, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");

  const diff = computeDiff(originalText, tailoredText);
  const changedCount = diff.filter((l) => l.changed && l.tailored.trim()).length;

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
      console.error("Docx build error:", err);
      setBuildError("Failed to build document: " + err.message);
      return null;
    } finally {
      setBuilding(false);
    }
  }

  async function handleDownloadDocx() {
    const url = await buildDocx();
    if (!url) return;
    const name = originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx";
    triggerDownload(url, name);
  }

  async function handleOpenGoogleDocs() {
    const url = await buildDocx();
    if (!url) return;
    // Download first, then show instructions
    const name = originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx";
    triggerDownload(url, name);
    // Open Google Docs upload page
    setTimeout(() => window.open("https://docs.google.com/", "_blank"), 500);
  }

  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{changedCount} paragraphs updated</span>
          <span className="badge-sub">
            ~{Math.round((1 - changedCount / Math.max(diff.filter(l => l.original.trim()).length, 1)) * 100)}% preserved
          </span>
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
        </div>
      </div>

      {/* Download options */}
      <div className="download-row">
        <button
          className="btn-download"
          onClick={handleDownloadDocx}
          disabled={building}
        >
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

        <button
          className="btn-gdocs"
          onClick={handleOpenGoogleDocs}
          disabled={building}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 5h6M4 7.5h6M4 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Open in Google Docs
        </button>

        <span className="gdocs-hint">Downloads file → upload to Google Docs → export as PDF</span>
      </div>

      {buildError && <p className="error-msg" style={{margin: "0 20px 16px"}}>{buildError}</p>}

      <div className="tab-bar">
        <button className={`tab ${view === "diff" ? "tab-active" : ""}`} onClick={() => setView("diff")}>
          Changes
        </button>
        <button className={`tab ${view === "tailored" ? "tab-active" : ""}`} onClick={() => setView("tailored")}>
          Full text
        </button>
      </div>

      {view === "diff" ? (
        <div className="diff-view">
          {diff.map((line, i) =>
            line.changed && (line.original.trim() || line.tailored.trim()) ? (
              <div key={i} className="diff-block">
                <div className="diff-line diff-removed">
                  {line.original.trim() ? renderDiffTokens(line.ops, "original") : <em>—</em>}
                </div>
                <div className="diff-line diff-added">
                  {line.tailored.trim() ? renderDiffTokens(line.ops, "tailored") : <em>—</em>}
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