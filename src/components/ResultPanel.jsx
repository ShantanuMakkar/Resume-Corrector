import { useState } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

function diffWords(a, b) {
  const at = a.split(/(\s+)/).filter(Boolean);
  const bt = b.split(/(\s+)/).filter(Boolean);
  const m = at.length, n = bt.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = at[i] === bt[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (at[i] === bt[j]) { ops.push({ type: "same", a: at[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type: "del", a: at[i] }); i++; }
    else { ops.push({ type: "ins", b: bt[j] }); j++; }
  }
  while (i < m) ops.push({ type: "del", a: at[i++] });
  while (j < n) ops.push({ type: "ins", b: bt[j++] });
  return ops;
}

function computeDiff(originalText, tailoredText) {
  const origLines = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailLines = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);
  const results = [];
  const maxLen = Math.max(origLines.length, tailLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i] ?? "";
    const tail = tailLines[i] ?? "";
    if (!orig && !tail) continue;
    if (orig === tail || !orig || !tail) {
      if (orig) results.push({ type: "same", original: orig, tailored: orig });
      continue;
    }
    results.push({ type: "changed", original: orig, tailored: tail, ops: diffWords(orig, tail) });
  }
  return results;
}

function renderOps(ops, side) {
  return ops.map((tok, i) => {
    if (tok.type === "same") return <span key={i} style={{ color: side === "del" ? "#999" : "#ccc" }}>{tok.a || tok.b}</span>;
    if (side === "del" && tok.type === "del") return <span key={i} style={{ background: "rgba(255,80,80,0.25)", color: "#ff9090", borderRadius: "3px", padding: "1px 3px", textDecoration: "line-through", textDecorationColor: "rgba(255,80,80,0.6)" }}>{tok.a}</span>;
    if (side === "add" && tok.type === "ins") return <span key={i} style={{ background: "rgba(60,220,120,0.2)", color: "#50e898", borderRadius: "3px", padding: "1px 3px", fontWeight: 500 }}>{tok.b}</span>;
    return null;
  });
}

function MatchScore({ score }) {
  const color = score >= 75 ? "#4ddb8a" : score >= 50 ? "#f0c040" : "#ff6b6b";
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="#2a2a2a" strokeWidth="6" />
        <circle cx="36" cy="36" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 0.6s ease" }} />
        <text x="36" y="41" textAnchor="middle" fill={color} fontSize="16" fontWeight="700">{score}%</text>
      </svg>
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#e8e8e8" }}>ATS Match</div>
        <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>
          {score >= 75 ? "Strong match" : score >= 50 ? "Moderate match" : "Weak match"}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }) {
  if (!analysis) return null;
  return (
    <div style={{ borderBottom: "1px solid #2a2a2a", padding: "20px" }}>
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
        {analysis.matchScore != null && <MatchScore score={analysis.matchScore} />}
        <div style={{ flex: 1, minWidth: "220px" }}>
          {analysis.titleAlignment && (
            <p style={{ fontSize: "13px", color: "#bbb", marginBottom: "12px", lineHeight: 1.5 }}>
              {analysis.titleAlignment}
            </p>
          )}
          {analysis.recommendation && (
            <p style={{ fontSize: "13px", color: "#888", lineHeight: 1.5, fontStyle: "italic" }}>
              {analysis.recommendation}
            </p>
          )}
        </div>
      </div>

      {analysis.missingKeywords?.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#ff6b6b", marginBottom: "8px" }}>
            Missing from your resume
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {analysis.missingKeywords.map((kw, i) => (
              <span key={i} style={{ background: "rgba(255,80,80,0.1)", color: "#ff8a8a", border: "1px solid rgba(255,80,80,0.2)", borderRadius: "4px", padding: "3px 8px", fontSize: "12px" }}>
                {kw}
              </span>
            ))}
          </div>
          {analysis.missingContext && (
            <p style={{ fontSize: "12px", color: "#666", marginTop: "8px", lineHeight: 1.5 }}>
              {analysis.missingContext}
            </p>
          )}
        </div>
      )}

      {analysis.matchedKeywords?.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4ddb8a", marginBottom: "8px" }}>
            Matched keywords
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {analysis.matchedKeywords.map((kw, i) => (
              <span key={i} style={{ background: "rgba(60,220,120,0.1)", color: "#6feaaa", border: "1px solid rgba(60,220,120,0.2)", borderRadius: "4px", padding: "3px 8px", fontSize: "12px" }}>
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecommendationsPanel({ originalText, tailoredText, jd }) {
  const [recs, setRecs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  async function fetchRecs() {
    if (fetched) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: originalText, jd }),
      });
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      const data = await res.json();
      setRecs(data.recommendations);
      setFetched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch when panel mounts
  useState(() => { fetchRecs(); }, []);

  if (loading) return (
    <div style={{ padding: "40px 20px", display: "flex", alignItems: "center", gap: "12px", color: "#888" }}>
      <span className="spinner" style={{ borderColor: "rgba(200,240,100,0.2)", borderTopColor: "#c8f064" }} />
      Analyzing your profile against the JD…
    </div>
  );

  if (error) return (
    <div style={{ padding: "20px" }}>
      <p style={{ color: "#ff8a8a", fontSize: "13px" }}>{error}</p>
      <button onClick={fetchRecs} style={{ marginTop: "8px", background: "none", border: "1px solid #3a3a3a", color: "#aaa", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "12px" }}>Retry</button>
    </div>
  );

  if (!recs) return null;

  const severityColor = { high: "#ff6b6b", medium: "#f0c040", low: "#888" };

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "24px", maxHeight: "600px", overflowY: "auto" }}>

      {recs.coverLetterHooks?.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c8f064", marginBottom: "10px" }}>Cover letter / interview hooks</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recs.coverLetterHooks.map((hook, i) => (
              <div key={i} style={{ background: "rgba(200,240,100,0.06)", border: "1px solid rgba(200,240,100,0.15)", borderRadius: "7px", padding: "10px 14px", fontSize: "13px", color: "#ddd", lineHeight: 1.55 }}>
                {hook}
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.suggestedBullets?.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4ddb8a", marginBottom: "10px" }}>Bullet points you could add</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {recs.suggestedBullets.map((item, i) => (
              <div key={i} style={{ background: "rgba(60,220,120,0.05)", border: "1px solid rgba(60,220,120,0.15)", borderRadius: "7px", padding: "12px 14px" }}>
                <div style={{ fontSize: "12px", color: "#4ddb8a", marginBottom: "4px", fontWeight: 600 }}>{item.section}</div>
                <div style={{ fontSize: "13px", color: "#e0e0e0", lineHeight: 1.55, marginBottom: "6px" }}>• {item.bullet}</div>
                <div style={{ fontSize: "12px", color: "#666", lineHeight: 1.4, fontStyle: "italic" }}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.framingSuggestions?.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7eb8ff", marginBottom: "10px" }}>Reframe existing bullets</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {recs.framingSuggestions.map((item, i) => (
              <div key={i} style={{ background: "rgba(100,150,255,0.05)", border: "1px solid rgba(100,150,255,0.15)", borderRadius: "7px", padding: "12px 14px" }}>
                <div style={{ fontSize: "12px", color: "#888", textDecoration: "line-through", marginBottom: "6px", lineHeight: 1.4 }}>{item.current}</div>
                <div style={{ fontSize: "13px", color: "#a8c8ff", lineHeight: 1.55, marginBottom: "6px" }}>→ {item.reframe}</div>
                <div style={{ fontSize: "12px", color: "#555", lineHeight: 1.4, fontStyle: "italic" }}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.skillsToAdd?.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#f0c040", marginBottom: "10px" }}>Skills you have but didn't list</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recs.skillsToAdd.map((item, i) => (
              <div key={i} style={{ background: "rgba(240,192,64,0.05)", border: "1px solid rgba(240,192,64,0.15)", borderRadius: "7px", padding: "10px 14px" }}>
                <div style={{ fontSize: "13px", color: "#f0c040", fontWeight: 600, marginBottom: "4px" }}>{item.skill}</div>
                <div style={{ fontSize: "12px", color: "#666", lineHeight: 1.4, fontStyle: "italic" }}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.genuineGaps?.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#ff6b6b", marginBottom: "10px" }}>Genuine gaps to be aware of</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recs.genuineGaps.map((item, i) => (
              <div key={i} style={{ background: "rgba(255,80,80,0.05)", border: "1px solid rgba(255,80,80,0.15)", borderRadius: "7px", padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "13px", color: "#ff8a8a", fontWeight: 600 }}>{item.gap}</span>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: severityColor[item.severity] || "#888", background: "rgba(0,0,0,0.3)", borderRadius: "3px", padding: "1px 6px", textTransform: "uppercase" }}>{item.severity}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#666", lineHeight: 1.4, fontStyle: "italic" }}>{item.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResultPanel({ originalText, tailoredText, originalFile, tailorStats, analysis, jd, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");

  const diff = computeDiff(originalText, tailoredText);
  const changedCount = diff.filter(d => d.type === "changed").length;
  const totalOrig = diff.filter(d => d.type !== "added").length;
  const preservedPct = totalOrig > 0 ? Math.round(((totalOrig - changedCount) / totalOrig) * 100) : 100;

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
    triggerDownload(url, originalFile.name.replace(/\.(docx|doc)$/i, "") + "-tailored.docx");
    setTimeout(() => window.open("https://docs.new", "_blank"), 700);
  }

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{changedCount} line{changedCount !== 1 ? "s" : ""} changed</span>
          <span className="badge-sub">{preservedPct}% preserved</span>
          {tailorStats && Math.abs(tailorStats.wordDrift) > 0 && (
            <span className="badge-sub" style={{ color: Math.abs(tailorStats.wordDrift) > 30 ? "#ff8a8a" : "#666" }}>
              {tailorStats.wordDrift > 0 ? "+" : ""}{tailorStats.wordDrift} words
            </span>
          )}
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
        </div>
      </div>

      <AnalysisPanel analysis={analysis} />

      <div className="download-row">
        <button className="btn-download" onClick={handleDownloadDocx} disabled={building}>
          {building ? <><span className="spinner spinner-sm" /> Building…</> : "↓ Download .docx"}
        </button>
        <button className="btn-gdocs" onClick={handleOpenGoogleDocs} disabled={building}>
          Open in Google Docs
        </button>
        <span className="gdocs-hint">Download → File → Open in Google Docs → export as PDF</span>
      </div>

      {buildError && <p className="error-msg" style={{ margin: "0 20px 16px" }}>{buildError}</p>}

      <div className="tab-bar">
        <button className={`tab ${view === "diff" ? "tab-active" : ""}`} onClick={() => setView("diff")}>
          Changes {changedCount > 0 && <span className="tab-count">{changedCount}</span>}
        </button>
        <button className={`tab ${view === "recs" ? "tab-active" : ""}`} onClick={() => setView("recs")}>
          Recommendations
        </button>
      </div>

      {view === "diff" ? (
        <div className="diff-view">
          {diff.filter(d => d.type === "changed").length === 0 ? (
            <p className="no-changes">No changes — resume already matches the JD well.</p>
          ) : (
            diff.filter(d => d.type === "changed").map((entry, i) => (
              <div key={i} style={{ border: "1px solid #2a2a2a", borderRadius: "8px", overflow: "hidden", marginBottom: "14px" }}>
                <div style={{ background: "rgba(255,60,60,0.07)", borderBottom: "1px solid #2a2a2a" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "5px 14px", color: "#ff6b6b", background: "rgba(255,60,60,0.1)" }}>Before</div>
                  <div style={{ padding: "10px 14px", fontSize: "13px", lineHeight: 1.65, color: "#bbb", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {renderOps(entry.ops, "del")}
                  </div>
                </div>
                <div style={{ background: "rgba(50,200,100,0.06)" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "5px 14px", color: "#4ddb8a", background: "rgba(50,200,100,0.1)" }}>After</div>
                  <div style={{ padding: "10px 14px", fontSize: "13px", lineHeight: 1.65, color: "#ddd", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {renderOps(entry.ops, "add")}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <RecommendationsPanel originalText={originalText} tailoredText={tailoredText} jd={jd} />
      )}
    </div>
  );
}