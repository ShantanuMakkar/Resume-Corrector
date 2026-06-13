import { useState, useEffect } from "react";
import { injectTextIntoDocx } from "../lib/docxProcessor";

// ── helpers ───────────────────────────────────────────────────────────────────

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
  const ol = originalText.split("\n").map(s => s.trim());
  const tl = tailoredText.split("\n").map(s => s.trim());
  const results = [];
  const max = Math.max(ol.length, tl.length);
  for (let i = 0; i < max; i++) {
    const orig = ol[i] ?? "", tail = tl[i] ?? "";
    if (!orig && !tail) continue;
    if (orig === tail || !orig || !tail) { if (orig) results.push({ type:"same", lineIdx:i, original:orig, tailored:orig }); continue; }
    results.push({ type:"changed", lineIdx:i, changeType:classifyChange(orig,tail), original:orig, tailored:tail, ops:diffWords(orig,tail) });
  }
  return results;
}

function renderOps(ops, side) {
  return ops.map((tok, i) => {
    if (tok.type === "same") return <span key={i} style={{color:side==="del"?"#888":"#ccc"}}>{tok.a||tok.b}</span>;
    if (side==="del" && tok.type==="del") return <span key={i} style={{background:"rgba(255,80,80,0.2)",color:"#ff9090",borderRadius:"3px",padding:"1px 4px",textDecoration:"line-through",textDecorationColor:"rgba(255,80,80,0.5)"}}>{tok.a}</span>;
    if (side==="add" && tok.type==="ins") return <span key={i} style={{background:"rgba(60,220,120,0.18)",color:"#4ddb8a",borderRadius:"3px",padding:"1px 4px",fontWeight:600}}>{tok.b}</span>;
    return null;
  });
}

function buildAcceptedText(originalText, tailoredText, accepted) {
  const ol = originalText.split("\n").map(s => s.trim());
  const tl = tailoredText.split("\n").map(s => s.trim());
  return ol.map((orig, i) => {
    const tail = tl[i] ?? orig;
    return orig === tail ? orig : accepted.has(i) ? tail : orig;
  }).join("\n");
}

// ── shared button style ────────────────────────────────────────────────────────
// Fix #9: consistent copy button across all panels
function CopyBtn({ text, size = "sm" }) {
  const [copied, setCopied] = useState(false);
  const p = size === "sm" ? "3px 8px" : "5px 12px";
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{background:"none",border:"1px solid #2e2e2e",color:copied?"#4ddb8a":"#444",borderRadius:"5px",padding:p,fontSize:"11px",cursor:"pointer",transition:"all 0.15s",flexShrink:0,whiteSpace:"nowrap"}}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ── section divider ────────────────────────────────────────────────────────────
// Fix #2: stronger visual weight for section labels
function SectionDivider({ label, count, accent }) {
  const c = accent ? "#c8f064" : "#3a3a3a";
  const bg = accent ? "rgba(200,240,100,0.15)" : "#252525";
  return (
    <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"8px 0 14px"}}>
      <div style={{flex:1,height:"1px",background:bg}}/>
      <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
        <span style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:c}}>{label}</span>
        <span style={{background:accent?"rgba(200,240,100,0.12)":"#1e1e1e",color:accent?"#c8f064":"#444",borderRadius:"10px",padding:"1px 7px",fontSize:"10px",fontWeight:600}}>{count}</span>
      </div>
      <div style={{flex:1,height:"1px",background:bg}}/>
    </div>
  );
}

// ── diff block ─────────────────────────────────────────────────────────────────
// Fix #3: remove Before/After labels — colour communicates direction
// Fix #4: consistent horizontal padding
// Fix #8: larger hit area on accept/reject
function DiffBlock({ entry, isAccepted, onToggle, compact }) {
  const idx = entry.lineIdx;
  return (
    <div style={{
      border:`1px solid ${isAccepted ? (compact?"#2a2a2a":"#363636") : "#1a1a1a"}`,
      borderRadius:"8px",overflow:"hidden",
      marginBottom: compact ? "8px" : "12px",
      opacity: isAccepted ? 1 : 0.65,
      transition:"opacity 0.2s, border-color 0.2s",
    }}>
      {/* Red row — before */}
      <div style={{background:"rgba(255,50,50,0.07)",padding:"10px 14px",fontSize: compact?"12px":"13px",lineHeight:1.6,color:"#999",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
        {renderOps(entry.ops,"del")}
      </div>
      {/* Green row — after */}
      <div style={{background:"rgba(40,180,90,0.07)",borderTop:"1px solid #1e1e1e"}}>
        <div style={{padding:"10px 14px",fontSize:compact?"12px":"13px",lineHeight:1.6,color:"#ddd",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
          {renderOps(entry.ops,"add")}
        </div>
        {/* Actions row */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 14px 8px",borderTop:"1px solid rgba(255,255,255,0.04)"}}>
          <div style={{display:"flex",gap:"6px"}}>
            <CopyBtn text={entry.tailored}/>
          </div>
          {/* Fix #8: bigger tap target */}
          <button
            onClick={() => onToggle(idx)}
            style={{
              background: isAccepted ? "rgba(60,220,120,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${isAccepted ? "rgba(60,220,120,0.35)" : "#2a2a2a"}`,
              color: isAccepted ? "#4ddb8a" : "#555",
              borderRadius:"6px",
              padding:"5px 14px",
              fontSize:"12px",
              fontWeight:600,
              cursor:"pointer",
              transition:"all 0.15s",
              minWidth:"90px",
            }}
          >
            {isAccepted ? "✓ Accepted" : "Rejected"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── analysis panel ─────────────────────────────────────────────────────────────
function MatchScore({ score }) {
  const color = score >= 75 ? "#4ddb8a" : score >= 50 ? "#f0c040" : "#ff6b6b";
  const r = 26, circ = 2 * Math.PI * r, dash = (score/100)*circ;
  return (
    <div style={{display:"flex",alignItems:"center",gap:"12px",flexShrink:0}}>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#222" strokeWidth="5"/>
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 32 32)" style={{transition:"stroke-dasharray 0.8s ease"}}/>
        <text x="32" y="37" textAnchor="middle" fill={color} fontSize="14" fontWeight="700">{score}%</text>
      </svg>
      <div>
        <div style={{fontSize:"13px",fontWeight:600,color:"#ddd"}}>JD Match</div>
        <div style={{fontSize:"12px",color:"#555",marginTop:"2px"}}>
          {score >= 75 ? "Strong fit" : score >= 50 ? "Moderate fit" : "Weak fit"}
        </div>
        <div style={{fontSize:"11px",color:"#555",marginTop:"3px"}}>after tailoring</div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }) {
  if (!analysis) return null;
  return (
    <div style={{padding:"18px 20px",borderBottom:"1px solid #1e1e1e",display:"flex",flexDirection:"column",gap:"14px"}}>
      {/* Fix #B2: missing keywords first */}
      {analysis.missingKeywords?.length > 0 && (
        <div style={{paddingBottom:"14px",borderBottom:"1px solid #1a1a1a"}}>
          <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#cc4444",marginBottom:"8px"}}>Still missing</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
            {analysis.missingKeywords.map((kw,i) => (
              <span key={i} style={{background:"rgba(255,60,60,0.09)",color:"#ff8a8a",border:"1px solid rgba(255,60,60,0.18)",borderRadius:"4px",padding:"3px 8px",fontSize:"12px"}}>{kw}</span>
            ))}
          </div>
          {analysis.missingContext && <p style={{fontSize:"12px",color:"#666",marginTop:"7px",lineHeight:1.5}}>{analysis.missingContext}</p>}
        </div>
      )}
      <div style={{display:"flex",gap:"20px",flexWrap:"wrap",alignItems:"flex-start",paddingBottom:"14px",borderBottom:"1px solid #1a1a1a"}}>
        {analysis.matchScore != null && <MatchScore score={analysis.matchScore}/>}
        <div style={{flex:1,minWidth:"180px"}}>
          {analysis.titleAlignment && <p style={{fontSize:"13px",color:"#aaa",marginBottom:"6px",lineHeight:1.5}}>{analysis.titleAlignment}</p>}
          {analysis.recommendation && <p style={{fontSize:"12px",color:"#666",lineHeight:1.5,fontStyle:"italic"}}>{analysis.recommendation}</p>}
        </div>
      </div>
      {analysis.matchedKeywords?.length > 0 && (
        <div>
          <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#2a7a4a",marginBottom:"7px"}}>Matched</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
            {analysis.matchedKeywords.map((kw,i) => (
              <span key={i} style={{background:"rgba(40,180,90,0.08)",color:"#5acd8a",border:"1px solid rgba(40,180,90,0.18)",borderRadius:"4px",padding:"3px 8px",fontSize:"12px"}}>{kw}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── recommendations panel ──────────────────────────────────────────────────────
// Fix #15: loading skeleton instead of open spinner
function RecsSkeleton() {
  const bar = (w, o=1) => <div style={{height:"12px",borderRadius:"4px",background:"#1e1e1e",width:w,opacity:o,marginBottom:"6px"}}/>;
  return (
    <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"20px"}}>
      {[1,2,3].map(k => (
        <div key={k}>
          {bar("60px")}
          <div style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:"8px",padding:"14px",marginTop:"8px"}}>
            {bar("100%")} {bar("85%",0.6)} {bar("70%",0.4)}
          </div>
          <div style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:"8px",padding:"14px",marginTop:"6px"}}>
            {bar("100%")} {bar("90%",0.6)}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationsPanel({ recs, recsLoading, recsError }) {
  if (recsLoading) return <RecsSkeleton/>;
  if (recsError) return (
    <div style={{padding:"20px"}}>
      <div style={{background:"rgba(255,80,80,0.07)",border:"1px solid rgba(255,80,80,0.15)",borderRadius:"8px",padding:"14px 16px"}}>
        <p style={{color:"#ff8a8a",fontSize:"13px",marginBottom:"8px"}}>Couldn't load recommendations — {recsError}</p>
        <p style={{color:"#555",fontSize:"12px"}}>The tailored resume is still ready to download above.</p>
      </div>
    </div>
  );
  if (!recs) return null;

  const sev = { high:"#ff6b6b", medium:"#f0c040", low:"#555" };
  const secLabel = (label, color) => (
    <div style={{fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color,marginBottom:"10px"}}>{label}</div>
  );

  return (
    <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"22px",maxHeight:"600px",overflowY:"auto"}}>

      {recs.coverLetterHooks?.length > 0 && (
        <div>
          {secLabel("Cover letter hooks", "#aaa")}
          <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
            {recs.coverLetterHooks.map((hook,i) => (
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"8px"}}>
                <div style={{flex:1,background:"rgba(200,240,100,0.05)",border:"1px solid rgba(200,240,100,0.12)",borderRadius:"7px",padding:"10px 14px",fontSize:"13px",color:"#ccc",lineHeight:1.55}}>{hook}</div>
                <CopyBtn text={hook}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.suggestedBullets?.length > 0 && (
        <div>
          {secLabel("Bullets you could add", "#aaa")}
          <div style={{display:"flex",flexDirection:"column",gap:"9px"}}>
            {recs.suggestedBullets.map((item,i) => (
              <div key={i} style={{background:"rgba(40,180,90,0.05)",border:"1px solid rgba(40,180,90,0.12)",borderRadius:"7px",padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:"8px",marginBottom:"7px"}}>
                  <div style={{flex:1,fontSize:"13px",color:"#ddd",lineHeight:1.55}}>• {item.bullet}</div>
                  <CopyBtn text={item.bullet}/>
                </div>
                <div style={{fontSize:"11px",color:"#5acd8a",fontWeight:600,marginBottom:"3px"}}>{item.section}</div>
                <div style={{fontSize:"12px",color:"#666",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.framingSuggestions?.length > 0 && (
        <div>
          {secLabel("Reframe these bullets", "#aaa")}
          <div style={{display:"flex",flexDirection:"column",gap:"9px"}}>
            {recs.framingSuggestions.map((item,i) => (
              <div key={i} style={{background:"rgba(100,150,255,0.04)",border:"1px solid rgba(100,150,255,0.12)",borderRadius:"7px",padding:"12px 14px"}}>
                <div style={{fontSize:"12px",color:"#444",textDecoration:"line-through",marginBottom:"7px",lineHeight:1.4}}>{item.current}</div>
                <div style={{display:"flex",alignItems:"flex-start",gap:"8px",marginBottom:"7px"}}>
                  <div style={{flex:1,fontSize:"13px",color:"#a8c8ff",lineHeight:1.55}}>→ {item.reframe}</div>
                  <CopyBtn text={item.reframe}/>
                </div>
                <div style={{fontSize:"12px",color:"#666",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.skillsToAdd?.length > 0 && (
        <div>
          {secLabel("Skills you have but didn't list", "#aaa")}
          <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
            {recs.skillsToAdd.map((item,i) => (
              <div key={i} style={{background:"rgba(240,192,64,0.04)",border:"1px solid rgba(240,192,64,0.12)",borderRadius:"7px",padding:"10px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
                  <span style={{fontSize:"13px",color:"#f0c040",fontWeight:600}}>{item.skill}</span>
                  <CopyBtn text={item.skill}/>
                </div>
                <div style={{fontSize:"12px",color:"#666",lineHeight:1.4,fontStyle:"italic"}}>{item.reasoning}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recs.genuineGaps?.length > 0 && (
        <div>
          {secLabel("Genuine gaps", "#aaa")}
          <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
            {recs.genuineGaps.map((item,i) => (
              <div key={i} style={{background:"rgba(255,60,60,0.04)",border:"1px solid rgba(255,60,60,0.12)",borderRadius:"7px",padding:"10px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}}>
                  <span style={{fontSize:"13px",color:"#ff8a8a",fontWeight:600}}>{item.gap}</span>
                  <span style={{fontSize:"10px",fontWeight:700,color:sev[item.severity]||"#555",background:"rgba(0,0,0,0.25)",borderRadius:"3px",padding:"1px 6px",letterSpacing:"0.05em"}}>{item.severity}</span>
                </div>
                <div style={{fontSize:"12px",color:"#666",lineHeight:1.4,fontStyle:"italic"}}>{item.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── main ───────────────────────────────────────────────────────────────────────

export default function ResultPanel({ originalText, tailoredText, originalFile, tailorStats, analysis, jd, onRetailor, onReset }) {
  const [view, setView] = useState("diff");
  const [recsVisited, setRecsVisited] = useState(false);
  const [building, setBuilding] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [docxUrl, setDocxUrl] = useState(null);
  const [buildError, setBuildError] = useState("");
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/recommend", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ resumeText:originalText, jd }),
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
  const semantic = diff.filter(d => d.type==="changed" && d.changeType==="semantic");
  const cosmetic = diff.filter(d => d.type==="changed" && d.changeType==="cosmetic");
  const allChangedIndices = diff.filter(d => d.type==="changed").map(d => d.lineIdx);

  const [acceptedKeys, setAcceptedKeys] = useState(() => {
    const keys = new Set();
    const ol = originalText.split("\n").map(s => s.trim());
    const tl = tailoredText.split("\n").map(s => s.trim());
    ol.forEach((orig, i) => { if (orig !== (tl[i]??orig)) keys.add(i); });
    return keys;
  });

  function toggleAccept(idx) {
    setAcceptedKeys(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      setDocxUrl(null);
      return next;
    });
  }

  const acceptedCount = acceptedKeys.size;

  // Fix #12: consistent bulk action hierarchy
  function acceptAll() { setAcceptedKeys(new Set(allChangedIndices)); setDocxUrl(null); }
  function rejectAll() { setAcceptedKeys(new Set()); setDocxUrl(null); }
  function rejectAllCosmetic() {
    setAcceptedKeys(prev => {
      const next = new Set(prev);
      cosmetic.forEach(d => next.delete(d.lineIdx));
      setDocxUrl(null);
      return next;
    });
  }

  async function buildDocx() {
    if (docxUrl) return docxUrl;
    setBuilding(true); setBuildError("");
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
    } finally { setBuilding(false); }
  }

  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  }

  async function handleDownload() {
    const url = await buildDocx();
    if (url) {
      triggerDownload(url, `${originalFile.name.replace(/\.(docx|doc)$/i,"")}-tailored.docx`);
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 3000);
    }
  }

  async function handleGoogleDocs() {
    const url = await buildDocx();
    if (!url) return;
    triggerDownload(url, `${originalFile.name.replace(/\.(docx|doc)$/i,"")}-tailored.docx`);
    setTimeout(() => window.open("https://docs.new","_blank"), 700);
  }

  return (
    <div className="result-panel">

      <div className="result-header" style={{borderBottom:"1px solid #1a1a1a"}}>
        <div className="result-meta">
          <span className="badge">{acceptedCount} change{acceptedCount!==1?"s":""} accepted</span>
          {tailorStats?.wordDrift !== 0 && tailorStats && (
            <span className="badge-sub" style={{color:Math.abs(tailorStats.wordDrift)>25?"#ff8a8a":"#666"}}>
              {tailorStats.wordDrift>0?"+":""}{tailorStats.wordDrift} words
            </span>
          )}
        </div>
        <div className="result-actions" style={{gap:"6px"}}>
          <button className="btn-ghost" onClick={onRetailor} style={{fontSize:"12px",padding:"6px 12px"}}>New JD</button>
          <button className="btn-ghost" onClick={onReset} style={{fontSize:"12px",padding:"6px 12px",borderColor:"#222"}}>New resume</button>
        </div>
      </div>

      {/* Fix #14: visually grouped sections with stronger borders */}
      <AnalysisPanel analysis={analysis}/>

      {/* Fix #5: downloads anchored to top, visually grouped with tabs */}
      <div style={{borderBottom:"1px solid #1e1e1e"}}>
        <div className="download-row">
          <button className="btn-download" onClick={handleDownload} disabled={building}>
            {building ? <><span className="spinner spinner-sm"/> {docxUrl ? "Rebuilding…" : "Building…"}</>
              : downloadDone ? "✓ Downloaded"
              : "↓ Download .docx"}
          </button>
          <button className="btn-gdocs" onClick={handleGoogleDocs} disabled={building}>Open in Google Docs</button>
          <CopyBtn text={buildAcceptedText(originalText, tailoredText, acceptedKeys)} size="sm"/>
          <span className="gdocs-hint">Downloads file · open at docs.new · File → Open</span>
        </div>
        {buildError && <p className="error-msg" style={{margin:"-4px 20px 12px"}}>{buildError}</p>}
      </div>

      {/* Fix #11: thicker tab underline */}
      <div className="tab-bar">
        <button className={`tab ${view==="diff"?"tab-active":""}`} onClick={() => setView("diff")}>
          Changes <span className="tab-count">{acceptedCount}</span>
        </button>
        <button className={`tab ${view==="recs"?"tab-active":""}`} onClick={() => { setView("recs"); setRecsVisited(true); }}>
          Recommendations
          {recsLoading
            ? <span className="spinner spinner-sm" style={{marginLeft:6,borderColor:"rgba(200,240,100,0.15)",borderTopColor:"#c8f064"}}/>
            : recs && !recsVisited && <span className="tab-count" style={{background:"rgba(200,240,100,0.08)",color:"#8ab840",fontSize:"9px"}}>new</span>
          }
        </button>
      </div>

      {view === "diff" && (
        <div className="diff-view">

          {/* Fix #12: clear hierarchy — primary / secondary / danger */}
          {allChangedIndices.length > 0 && (
            <div style={{display:"flex",gap:"6px",marginBottom:"18px",alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={acceptAll} style={{background:"rgba(60,220,120,0.1)",border:"1px solid rgba(60,220,120,0.2)",color:"#4ddb8a",borderRadius:"6px",padding:"5px 12px",fontSize:"12px",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>
                Accept all
              </button>
              <button onClick={rejectAllCosmetic} style={{background:"none",border:"1px solid #2a2a2a",color:"#666",borderRadius:"6px",padding:"5px 12px",fontSize:"12px",cursor:"pointer",whiteSpace:"nowrap"}}>
                Reject formatting
              </button>
              <button onClick={rejectAll} style={{background:"none",border:"1px solid #252525",color:"#666",borderRadius:"6px",padding:"5px 12px",fontSize:"12px",cursor:"pointer",whiteSpace:"nowrap"}}>
                Reject all
              </button>
              <span style={{marginLeft:"auto",fontSize:"11px",color:"#555",fontVariantNumeric:"tabular-nums"}}>{acceptedCount}/{allChangedIndices.length}</span>
            </div>
          )}

          {/* Fix #13: empty state when all rejected */}
          {allChangedIndices.length > 0 && acceptedCount === 0 && (
            <div style={{textAlign:"center",padding:"32px 20px",color:"#555",fontSize:"13px",border:"1px dashed #222",borderRadius:"8px",marginBottom:"16px"}}>
              All changes rejected — download will be identical to your original.
              <br/>
              <button onClick={acceptAll} style={{marginTop:"12px",background:"none",border:"1px solid #444",color:"#888",borderRadius:"6px",padding:"6px 14px",fontSize:"12px",cursor:"pointer"}}>
                Accept all
              </button>
            </div>
          )}

          {/* Fix #13: empty state when no changes at all */}
          {semantic.length === 0 && cosmetic.length === 0 && (
            <div style={{textAlign:"center",padding:"32px 20px",color:"#555",fontSize:"13px"}}>
              No changes detected — your resume already covers the JD well.
            </div>
          )}

          {semantic.length > 0 && (
            <div style={{marginBottom:"4px"}}>
              <SectionDivider label="Content changes" count={semantic.length} accent/>
              {semantic.map((entry,i) => (
                <DiffBlock key={i} entry={entry} isAccepted={acceptedKeys.has(entry.lineIdx)} onToggle={toggleAccept}/>
              ))}
            </div>
          )}

          {cosmetic.length > 0 && (
            <div>
              <SectionDivider label="Formatting & punctuation" count={cosmetic.length} accent={false}/>
              {cosmetic.map((entry,i) => (
                <DiffBlock key={i} entry={entry} isAccepted={acceptedKeys.has(entry.lineIdx)} onToggle={toggleAccept} compact/>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "recs" && (
        <RecommendationsPanel recs={recs} recsLoading={recsLoading} recsError={recsError}/>
      )}
    </div>
  );
}