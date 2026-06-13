import { useState, useEffect } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

// ── helpers ──────────────────────────────────────────────────────────────────

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
    if (at[i] === bt[j]) { ops.push({ type:"same", a:at[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type:"del", a:at[i] }); i++; }
    else { ops.push({ type:"ins", b:bt[j] }); j++; }
  }
  while (i < m) ops.push({ type:"del", a:at[i++] });
  while (j < n) ops.push({ type:"ins", b:bt[j++] });
  return ops;
}

function classifyChange(orig, tail) {
  const norm = s => s.replace(/\s+/g," ").replace(/&/g,"and").replace(/[|,;]/g," ").replace(/[~<>]/g,"").toLowerCase().trim();
  if (norm(orig) === norm(tail)) return "cosmetic";
  const strip = s => s.replace(/[^a-zA-Z0-9\s]/g,"").replace(/\s+/g," ").trim().toLowerCase();
  if (strip(orig) === strip(tail)) return "cosmetic";
  return "semantic";
}

function computeDiff(originalText, tailoredText) {
  // Use ALL lines (including empty) to preserve positional index alignment
  const ol = originalText.split("\n").map(s => s.trim());
  const tl = tailoredText.split("\n").map(s => s.trim());
  const results = [];
  const max = Math.max(ol.length, tl.length);
  for (let i = 0; i < max; i++) {
    const orig = ol[i] ?? "", tail = tl[i] ?? "";
    if (!orig && !tail) continue;
    if (orig === tail || !orig || !tail) { if (orig) results.push({ type:"same", lineIdx:i, original:orig, tailored:orig }); continue; }
    results.push({ type:"changed", lineIdx:i, changeType: classifyChange(orig,tail), original:orig, tailored:tail, ops:diffWords(orig,tail) });
  }
  return results;
}

function renderOps(ops, side) {
  return ops.map((tok, i) => {
    if (tok.type === "same") return <span key={i} style={{color: side==="del"?"#999":"#ccc"}}>{tok.a||tok.b}</span>;
    if (side==="del" && tok.type==="del") return <span key={i} style={{background:"rgba(255,80,80,0.25)",color:"#ff9090",borderRadius:"3px",padding:"1px 3px",textDecoration:"line-through",textDecorationColor:"rgba(255,80,80,0.6)"}}>{tok.a}</span>;
    if (side==="add" && tok.type==="ins") return <span key={i} style={{background:"rgba(60,220,120,0.2)",color:"#50e898",borderRadius:"3px",padding:"1px 3px",fontWeight:500}}>{tok.b}</span>;
    return null;
  });
}

// Build tailored text with only accepted changes applied
function buildAcceptedText(originalText, tailoredText, accepted) {
  const ol = originalText.split("\n").map(s => s.trim());
  const tl = tailoredText.split("\n").map(s => s.trim());
  return ol.map((orig, i) => {
    const tail = tl[i] ?? orig;
    if (orig === tail) return orig;
    return accepted.has(i) ? tail : orig;
  }).join("\n");
}

// ── sub-components ────────────────────────────────────────────────────────────

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background:"none", border:"1px solid #333", color: copied?"#4ddb8a":"#555", borderRadius:"5px", padding:"3px 9px", fontSize:"11px", cursor:"pointer", transition:"color 0.2s", flexShrink:0 }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MatchScore({ score }) {
  const color = score >= 75 ? "#4ddb8a" : score >= 50 ? "#f0c040" : "#ff6b6b";
  const r = 28, circ = 2 * Math.PI * r, dash = (score/100)*circ;
  return (
    <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#2a2a2a" strokeWidth="6"/>
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)" style={{transition:"stroke-dasharray 0.6s ease"}}/>
        <text x="36" y="41" textAnchor="middle" fill={color} fontSize="16" fontWeight="700">{score}%</text>
      </svg>
      <div>
        <div style={{fontSize:"14px",fontWeight:600,color:"#e8e8e8"}}>JD Match</div>
        <div style={{fontSize:"12px",color:"#666",marginTop:"2px"}}>
          {score >= 75 ? "Strong fit for this role" : score >= 50 ? "Moderate fit for this role" : "Weak fit for this role"}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }) {
  if (!analysis) return null;
  return (
    <div style={{padding:"20px",borderBottom:"1px solid #2a2a2a",display:"flex",flexDirection:"column",gap:"16px"}}>

      {/* Missing keywords — most actionable, shown first */}
      {analysis.missingKeywords?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#ff6b6b",marginBottom:"8px"}}>
            Still missing from your resume
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom: analysis.missingContext ? "8px" : 0}}>
            {analysis.missingKeywords.map((kw,i) => (
              <span key={i} style={{background:"rgba(255,80,80,0.1)",color:"#ff8a8a",border:"1px solid rgba(255,80,80,0.2)",borderRadius:"4px",padding:"3px 8px",fontSize:"12px"}}>{kw}</span>
            ))}
          </div>
          {analysis.missingContext && <p style={{fontSize:"12px",color:"#555",lineHeight:1.5}}>{analysis.missingContext}</p>}
        </div>
      )}

      {/* Score + alignment */}
      <div style={{display:"flex",gap:"24px",flexWrap:"wrap",alignItems:"flex-start"}}>
        {analysis.matchScore != null && <MatchScore score={analysis.matchScore} />}
        <div style={{flex:1,minWidth:"200px"}}>
          {analysis.titleAlignment && <p style={{fontSize:"13px",color:"#bbb",marginBottom:"8px",lineHeight:1.5}}>{analysis.titleAlignment}</p>}
          {analysis.recommendation && <p style={{fontSize:"13px",color:"#777",lineHeight:1.5,fontStyle:"italic"}}>{analysis.recommendation}</p>}
        </div>
      </div>

      {/* Matched keywords */}
      {analysis.matchedKeywords?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#4ddb8a",marginBottom:"8px"}}>Matched keywords</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
            {analysis.matchedKeywords.map((kw,i) => (
              <span key={i} style={{background:"rgba(60,220,120,0.1)",color:"#6feaaa",border:"1px solid rgba(60,220,120,0.2)",borderRadius:"4px",padding:"3px 8px",fontSize:"12px"}}>{kw}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecommendationsPanel({ recs, recsLoading, recsError }) {
  if (recsLoading) return (
    <div style={{padding:"40px 20px",display:"flex",alignItems:"center",gap:"12px",color:"#888"}}>
      <span className="spinner" style={{borderColor:"rgba(200,240,100,0.2)",borderTopColor:"#c8f064"}}/>
      Analyzing your profile against the JD…
    </div>
  );
  if (recsError) return <div style={{padding:"20px"}}><p style={{color:"#ff8a8a",fontSize:"13px"}}>{recsError}</p></div>;
  if (!recs) return null;

  const sev = { high:"#ff6b6b", medium:"#f0c040", low:"#888" };

  return (
    <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"24px",maxHeight:"600px",overflowY:"auto"}}>

      {recs.coverLetterHooks?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#c8f064",marginBottom:"10px"}}>Cover letter / interview hooks</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {recs.coverLetterHooks.map((hook,i) => (
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"8px"}}>
                <div style={{flex:1,background:"rgba(200,240,100,0.06)",border:"1px solid rgba(200,240,100,0.15)",borderRadius:"7px",padding:"10px 14px",fontSize:"13px",color:"#ddd",lineHeight:1.55}}>{hook}</div>
                <CopyBtn text={hook}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.suggestedBullets?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#4ddb8a",marginBottom:"10px"}}>Bullet points you could add</div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {recs.suggestedBullets.map((item,i) => (
              <div key={i} style={{background:"rgba(60,220,120,0.05)",border:"1px solid rgba(60,220,120,0.15)",borderRadius:"7px",padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:"8px",marginBottom:"6px"}}>
                  <div style={{flex:1,fontSize:"13px",color:"#e0e0e0",lineHeight:1.55}}>• {item.bullet}</div>
                  <CopyBtn text={item.bullet}/>
                </div>
                <div style={{fontSize:"11px",color:"#4ddb8a",fontWeight:600,marginBottom:"3px"}}>{item.section}</div>
                <div style={{fontSize:"12px",color:"#555",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.framingSuggestions?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#7eb8ff",marginBottom:"10px"}}>Reframe existing bullets</div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {recs.framingSuggestions.map((item,i) => (
              <div key={i} style={{background:"rgba(100,150,255,0.05)",border:"1px solid rgba(100,150,255,0.15)",borderRadius:"7px",padding:"12px 14px"}}>
                <div style={{fontSize:"12px",color:"#555",textDecoration:"line-through",marginBottom:"6px",lineHeight:1.4}}>{item.current}</div>
                <div style={{display:"flex",alignItems:"flex-start",gap:"8px",marginBottom:"6px"}}>
                  <div style={{flex:1,fontSize:"13px",color:"#a8c8ff",lineHeight:1.55}}>→ {item.reframe}</div>
                  <CopyBtn text={item.reframe}/>
                </div>
                <div style={{fontSize:"12px",color:"#444",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.skillsToAdd?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#f0c040",marginBottom:"10px"}}>Skills you have but didn't list</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {recs.skillsToAdd.map((item,i) => (
              <div key={i} style={{background:"rgba(240,192,64,0.05)",border:"1px solid rgba(240,192,64,0.15)",borderRadius:"7px",padding:"10px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
                  <span style={{fontSize:"13px",color:"#f0c040",fontWeight:600}}>{item.skill}</span>
                  <CopyBtn text={item.skill}/>
                </div>
                <div style={{fontSize:"12px",color:"#555",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.genuineGaps?.length > 0 && (
        <div>
          <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#ff6b6b",marginBottom:"10px"}}>Genuine gaps</div>
          <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
            {recs.genuineGaps.map((item,i) => (
              <div key={i} style={{background:"rgba(255,80,80,0.05)",border:"1px solid rgba(255,80,80,0.15)",borderRadius:"7px",padding:"10px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                  <span style={{fontSize:"13px",color:"#ff8a8a",fontWeight:600}}>{item.gap}</span>
                  <span style={{fontSize:"10px",fontWeight:700,color:sev[item.severity]||"#888",background:"rgba(0,0,0,0.3)",borderRadius:"3px",padding:"1px 6px",textTransform:"uppercase"}}>{item.severity}</span>
                </div>
                <div style={{fontSize:"12px",color:"#555",lineHeight:1.4,fontStyle:"italic"}}>{item.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function ResultPanel({ originalText, tailoredText, originalFile, tailorStats, analysis, jd, onRetailor, onReset }) {
  const [view, setView] = useState("diff");
  const [building, setBuilding] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState("");
  const [accepted, setAccepted] = useState(null); // null = all accepted

  // Pre-fetch recommendations immediately on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resumeText: originalText, jd }),
        });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setRecs(data.recommendations);
      } catch (err) {
        setRecsError(err.message);
      } finally {
        setRecsLoading(false);
      }
    })();
  }, []);

  const diff = computeDiff(originalText, tailoredText);
  const semantic = diff.filter(d => d.type === "changed" && d.changeType === "semantic");
  const cosmetic = diff.filter(d => d.type === "changed" && d.changeType === "cosmetic");

  // Build accepted set — keyed by line index (positional, not text-based)
  // diff entries carry their lineIdx directly
  const [acceptedKeys, setAcceptedKeys] = useState(() => {
    const keys = new Set();
    const ol = originalText.split("\n").map(s => s.trim());
    const tl = tailoredText.split("\n").map(s => s.trim());
    ol.forEach((orig, i) => { if (orig !== (tl[i] ?? orig)) keys.add(i); });
    return keys;
  });

  function toggleAccept(lineIdx) {
    setAcceptedKeys(prev => {
      const next = new Set(prev);
      if (next.has(lineIdx)) next.delete(lineIdx);
      else next.add(lineIdx);
      setDocxUrl(null);
      return next;
    });
  }

  const acceptedCount = acceptedKeys.size;
  const allChangedIndices = diff.filter(d => d.type === "changed").map(d => d.lineIdx);

  function acceptAll() {
    setAcceptedKeys(new Set(allChangedIndices));
    setDocxUrl(null);
  }

  function rejectAll() {
    setAcceptedKeys(new Set());
    setDocxUrl(null);
  }

  function rejectAllCosmetic() {
    setAcceptedKeys(prev => {
      const next = new Set(prev);
      diff.filter(d => d.type === "changed" && d.changeType === "cosmetic")
        .forEach(d => next.delete(d.lineIdx));
      setDocxUrl(null);
      return next;
    });
  }

  async function buildDocx() {
    if (docxUrl) return docxUrl;
    setBuilding(true);
    setBuildError("");
    try {
      const finalText = buildAcceptedText(originalText, tailoredText, acceptedKeys);
      const buf = await injectTextIntoDocx(originalFile, originalText, finalText);
      const blob = new Blob([buf], { type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      setDocxUrl(url);
      return url;
    } catch (err) {
      setBuildError("Failed: " + err.message);
      return null;
    } finally {
      setBuilding(false);
    }
  }

  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  async function handleDownload() {
    const url = await buildDocx();
    if (url) {
      triggerDownload(url, `${originalFile.name.replace(/\.(docx|doc)$/i,"")}-tailored.docx`);
    }
  }

  async function handleGoogleDocs() {
    const url = await buildDocx();
    if (!url) return;
    triggerDownload(url, `${originalFile.name.replace(/\.(docx|doc)$/i,"")}-tailored.docx`);
    setTimeout(() => window.open("https://docs.new","_blank"), 700);
  }

  const sectionDivider = (label, count, color) => (
    <div style={{display:"flex",alignItems:"center",gap:"12px",margin:"4px 0 16px"}}>
      <div style={{flex:1,height:"1px",background: color==="accent"?"rgba(200,240,100,0.2)":"#252525"}}/>
      <div style={{fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color: color==="accent"?"#c8f064":"#444",display:"flex",alignItems:"center",gap:"8px",whiteSpace:"nowrap"}}>
        <span>{label}</span>
        <span style={{background: color==="accent"?"rgba(200,240,100,0.12)":"#222",color: color==="accent"?"#c8f064":"#555",borderRadius:"10px",padding:"1px 8px",fontSize:"10px"}}>{count}</span>
      </div>
      <div style={{flex:1,height:"1px",background: color==="accent"?"rgba(200,240,100,0.2)":"#252525"}}/>
    </div>
  );

  return (
    <div className="result-panel">

      {/* Header */}
      <div className="result-header">
        <div className="result-meta">
          <span className="badge">{acceptedCount} change{acceptedCount!==1?"s":""} accepted</span>
          <span className="badge-sub">{tailorStats ? `${tailorStats.wordDrift > 0 ? "+" : ""}${tailorStats.wordDrift} words` : ""}</span>
        </div>
        <div className="result-actions">
          <button className="btn-ghost" onClick={onRetailor}>↺ New JD</button>
          <button className="btn-ghost" onClick={onReset}>← New resume</button>
        </div>
      </div>

      {/* Analysis */}
      <AnalysisPanel analysis={analysis} />

      {/* Downloads */}
      <div className="download-row">
        <button className="btn-download" onClick={handleDownload} disabled={building}>
          {building ? <><span className="spinner spinner-sm"/> Building…</> : "↓ Download .docx"}
        </button>
        <button className="btn-gdocs" onClick={handleGoogleDocs} disabled={building}>Open in Google Docs</button>
        <span className="gdocs-hint">Download → File → Open in Google Docs → export as PDF</span>
      </div>

      {buildError && <p className="error-msg" style={{margin:"0 20px 16px"}}>{buildError}</p>}

      {/* Tabs */}
      <div className="tab-bar">
        <button className={`tab ${view==="diff"?"tab-active":""}`} onClick={() => setView("diff")}>
          Changes <span className="tab-count">{acceptedCount}</span>
        </button>
        <button className={`tab ${view==="recs"?"tab-active":""}`} onClick={() => setView("recs")}>
          Recommendations
          {recsLoading
            ? <span className="spinner spinner-sm" style={{marginLeft:6,borderColor:"rgba(200,240,100,0.2)",borderTopColor:"#c8f064"}}/>
            : recs && <span className="tab-count" style={{background:"rgba(200,240,100,0.1)",color:"#c8f064"}}>ready</span>
          }
        </button>
      </div>

      {/* Diff view */}
      {view === "diff" && (
        <div className="diff-view">
          {diff.filter(d => d.type === "changed").length > 0 && (
            <div style={{display:"flex",gap:"8px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:"12px",color:"#555",marginRight:"4px"}}>Bulk actions:</span>
              <button onClick={acceptAll} style={{background:"rgba(60,220,120,0.1)",border:"1px solid rgba(60,220,120,0.25)",color:"#4ddb8a",borderRadius:"5px",padding:"4px 12px",fontSize:"12px",cursor:"pointer",fontWeight:600}}>
                ✓ Accept all
              </button>
              <button onClick={rejectAllCosmetic} style={{background:"rgba(255,255,255,0.03)",border:"1px solid #2a2a2a",color:"#666",borderRadius:"5px",padding:"4px 12px",fontSize:"12px",cursor:"pointer"}}>
                Reject formatting
              </button>
              <button onClick={rejectAll} style={{background:"rgba(255,80,80,0.06)",border:"1px solid rgba(255,80,80,0.15)",color:"#ff6b6b",borderRadius:"5px",padding:"4px 12px",fontSize:"12px",cursor:"pointer"}}>
                Reject all
              </button>
              <span style={{marginLeft:"auto",fontSize:"12px",color:"#555"}}>{acceptedCount} of {allChangedIndices.length} accepted</span>
            </div>
          )}
          {semantic.length === 0 && cosmetic.length === 0 ? (
            <p className="no-changes">No changes — resume already matches the JD well.</p>
          ) : (
            <>
              {semantic.length > 0 && (
                <div style={{marginBottom:"8px"}}>
                  {sectionDivider("Content changes", semantic.length, "accent")}
                  {semantic.map((entry, i) => {
                    const idx = entry.lineIdx;
                    const isAccepted = acceptedKeys.has(idx);
                    return (
                      <div key={i} style={{border:`1px solid ${isAccepted?"#3a3a3a":"#222"}`,borderRadius:"8px",overflow:"hidden",marginBottom:"12px",opacity:isAccepted?1:0.5,transition:"opacity 0.2s"}}>
                        <div style={{background:"rgba(255,60,60,0.07)",borderBottom:"1px solid #2a2a2a"}}>
                          <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"5px 14px",color:"#ff6b6b",background:"rgba(255,60,60,0.1)"}}>Before</div>
                          <div style={{padding:"10px 14px",fontSize:"13px",lineHeight:1.65,color:"#bbb",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{renderOps(entry.ops,"del")}</div>
                        </div>
                        <div style={{background:"rgba(50,200,100,0.06)"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 14px",background:"rgba(50,200,100,0.1)"}}>
                            <span style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#4ddb8a"}}>After</span>
                            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                              <CopyBtn text={entry.tailored}/>
                              <button
                                onClick={() => toggleAccept(idx)}
                                style={{background: isAccepted?"rgba(60,220,120,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${isAccepted?"rgba(60,220,120,0.4)":"#333"}`,color:isAccepted?"#4ddb8a":"#555",borderRadius:"5px",padding:"3px 10px",fontSize:"11px",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                              >
                                {isAccepted ? "✓ Accepted" : "Rejected"}
                              </button>
                            </div>
                          </div>
                          <div style={{padding:"10px 14px",fontSize:"13px",lineHeight:1.65,color:"#ddd",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{renderOps(entry.ops,"add")}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {cosmetic.length > 0 && (
                <div>
                  {sectionDivider("Formatting & punctuation", cosmetic.length, "muted")}
                  {cosmetic.map((entry, i) => {
                    const idx = entry.lineIdx;
                    const isAccepted = acceptedKeys.has(idx);
                    return (
                      <div key={i} style={{border:`1px solid ${isAccepted?"#2e2e2e":"#1e1e1e"}`,borderRadius:"8px",overflow:"hidden",marginBottom:"10px",opacity:isAccepted?0.8:0.35,transition:"opacity 0.2s"}}>
                        <div style={{background:"rgba(255,60,60,0.04)",borderBottom:"1px solid #252525"}}>
                          <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",padding:"4px 14px",color:"#663333",background:"rgba(255,60,60,0.06)"}}>Before</div>
                          <div style={{padding:"8px 14px",fontSize:"12px",lineHeight:1.6,color:"#666",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{renderOps(entry.ops,"del")}</div>
                        </div>
                        <div style={{background:"rgba(50,200,100,0.03)"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 14px",background:"rgba(50,200,100,0.05)"}}>
                            <span style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:"#2a6644"}}>After</span>
                            <button
                              onClick={() => toggleAccept(idx)}
                              style={{background:"none",border:`1px solid ${isAccepted?"#2a4a36":"#2a2a2a"}`,color:isAccepted?"#2a6644":"#333",borderRadius:"5px",padding:"2px 8px",fontSize:"10px",cursor:"pointer",fontWeight:600}}
                            >
                              {isAccepted ? "✓" : "Rejected"}
                            </button>
                          </div>
                          <div style={{padding:"8px 14px",fontSize:"12px",lineHeight:1.6,color:"#555",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{renderOps(entry.ops,"add")}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {view === "recs" && (
        <RecommendationsPanel recs={recs} recsLoading={recsLoading} recsError={recsError}/>
      )}
    </div>
  );
}