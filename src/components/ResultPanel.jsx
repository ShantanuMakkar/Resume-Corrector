import { useState } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

// Word-level diff using LCS
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

// Similarity score for paragraph matching
function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = b.toLowerCase().split(/\s+/);
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}

// Order-aware paragraph diff — matches paragraphs positionally with a window
function computeParagraphDiff(originalText, tailoredText) {
  const origParas = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);
  const results = [];
  const usedTail = new Set();

  for (let i = 0; i < origParas.length; i++) {
    const orig = origParas[i];
    // Estimate position in tailored proportionally, search within ±5 window
    const approxIdx = Math.round((i / origParas.length) * tailParas.length);
    const start = Math.max(0, approxIdx - 5);
    const end = Math.min(tailParas.length - 1, approxIdx + 5);

    let bestIdx = -1, bestScore = 0;
    for (let j = start; j <= end; j++) {
      if (usedTail.has(j)) continue;
      const score = similarity(orig, tailParas[j]);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }

    if (bestIdx === -1 || bestScore < 0.4) {
      results.push({ type: "same", original: orig, tailored: orig });
    } else {
      const tail = tailParas[bestIdx];
      usedTail.add(bestIdx);
      if (orig === tail) {
        results.push({ type: "same", original: orig, tailored: tail });
      } else {
        results.push({ type: "changed", original: orig, tailored: tail, ops: diffWords(orig, tail) });
      }
    }
  }

  return results;
}

export default function ResultPanel({ originalText, tailoredText, originalFile, tailorStats, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");

  const diff = computeParagraphDiff(originalText, tailoredText);
  const changedCount = diff.filter(d => d.type === "changed").length;
  const totalOrig = diff.filter(d => d.type !== "added").length;
  const preservedPct = totalOrig > 0 ? Math.round(((totalOrig - changedCount) / totalOrig) * 100) : 100;
  const visibleDiffs = diff.filter(d => d.type !== "same");

  async function buildDocx() {
    if (docxUrl) return docxUrl;
    setBuilding(true);
    setBuildError("");
    try {
      const buf = await injectTextIntoDocx(originalFile, originalText, tailoredText);
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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

  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  async function handleDownloadDocx() {
    const url = await buildDocx();
    if (url) triggerDownload(url, originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx");
  }

  async function handleOpenGoogleDocs() {
    const url = await buildDocx();
    if (!url) return;
    const filename = originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx";
    triggerDownload(url, filename);
    // docs.new opens a blank Google Doc — user can then File > Open to upload
    setTimeout(() => window.open("https://docs.new", "_blank"), 700);
  }

  function renderOps(ops, side) {
    return ops.map((tok, i) => {
      if (tok.type === "same") {
        return <span key={i} style={{ color: side === "del" ? "#aaa" : "#ccc" }}>{tok.value}</span>;
      }
      if (side === "del" && tok.type === "del") {
        return (
          <span key={i} style={{
            background: "rgba(255,80,80,0.25)",
            color: "#ff9090",
            borderRadius: "3px",
            padding: "1px 3px",
            textDecoration: "line-through",
            textDecorationColor: "rgba(255,80,80,0.6)",
          }}>{tok.value}</span>
        );
      }
      if (side === "add" && tok.type === "add") {
        return (
          <span key={i} style={{
            background: "rgba(60,220,120,0.2)",
            color: "#50e898",
            borderRadius: "3px",
            padding: "1px 3px",
            fontWeight: "500",
          }}>{tok.value}</span>
        );
      }
      return null;
    });
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{changedCount} paragraph{changedCount !== 1 ? "s" : ""} changed</span>
          <span className="badge-sub">{preservedPct}% preserved</span>
          {tailorStats && (
            <span className="badge-sub" style={{
              color: Math.abs(tailorStats.wordDrift) > 30 ? "#ff8a8a" : "#888",
              fontSize: "11px"
            }}>
              {tailorStats.wordDrift > 0 ? "+" : ""}{tailorStats.wordDrift} words
            </span>
          )}
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
        </div>
      </div>

      <div className="download-row">
        <button className="btn-download" onClick={handleDownloadDocx} disabled={building}>
          {building
            ? <><span className="spinner spinner-sm" /> Building…</>
            : <>↓ Download .docx</>}
        </button>
        <button className="btn-gdocs" onClick={handleOpenGoogleDocs} disabled={building}>
          Open in Google Docs
        </button>
        <span className="gdocs-hint">Downloads file · opens Google Docs → File → Open → upload the file → File → Download as PDF</span>
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
          {visibleDiffs.length === 0 ? (
            <p className="no-changes">No changes — resume already matches the JD well.</p>
          ) : (
            visibleDiffs.map((entry, i) => (
              <div key={i} style={{
                border: "1px solid #2a2a2a",
                borderRadius: "8px",
                overflow: "hidden",
                marginBottom: "14px",
              }}>
                {/* Original row */}
                {(entry.type === "changed" || entry.type === "removed") && (
                  <div style={{ background: "rgba(255,60,60,0.07)", borderBottom: entry.type === "changed" ? "1px solid #2a2a2a" : "none" }}>
                    <div style={{
                      fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
                      textTransform: "uppercase", padding: "5px 14px",
                      color: "#ff6b6b", background: "rgba(255,60,60,0.1)"
                    }}>
                      {entry.type === "removed" ? "Removed" : "Before"}
                    </div>
                    <div style={{ padding: "10px 14px", fontSize: "13px", lineHeight: 1.65, color: "#bbb", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {entry.type === "changed" ? renderOps(entry.ops, "del") : entry.original}
                    </div>
                  </div>
                )}

                {/* Tailored row */}
                {(entry.type === "changed" || entry.type === "added") && (
                  <div style={{ background: "rgba(50,200,100,0.06)" }}>
                    <div style={{
                      fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
                      textTransform: "uppercase", padding: "5px 14px",
                      color: "#4ddb8a", background: "rgba(50,200,100,0.1)"
                    }}>
                      {entry.type === "added" ? "Added" : "After"}
                    </div>
                    <div style={{ padding: "10px 14px", fontSize: "13px", lineHeight: 1.65, color: "#ddd", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {entry.type === "changed" ? renderOps(entry.ops, "add") : entry.tailored}
                    </div>
                  </div>
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