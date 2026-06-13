import { useState, useEffect, useRef } from "react";
import ResumeUpload from "./components/ResumeUpload";
import JDInput from "./components/JDInput";
import ResultPanel from "./components/ResultPanel";
import "./App.css";
import TestPanel from "./components/TestPanel";

function WhatYouGet() {
  const items = [
    { label: "Tailored .docx", sub: "Same layout, new keywords", sym: "↓", accent: "#c8f064" },
    { label: "JD match score", sub: "Know your fit before applying", sym: "%", accent: "#7eb8ff" },
    { label: "Missing keywords", sub: "What ATS is filtering out", sym: "◎", accent: "#ff8a8a" },
    { label: "Bullet injection", sub: "Keywords in the right place", sym: "+", accent: "#4ddb8a" },
    { label: "Accept / reject", sub: "Every change, your call", sym: "✓", accent: "#f0c040" },
    { label: "Cover letter hooks", sub: "What to lead with", sym: "→", accent: "#c8f064" },
    { label: "Reframing tips", sub: "Stronger versions of your bullets", sym: "↺", accent: "#7eb8ff" },
    { label: "Gap analysis", sub: "Honest about what's missing", sym: "!", accent: "#ff8a8a" },
  ];
  return (
    <div style={{ marginTop: "32px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#555", marginBottom: "16px" }}>
        What you get
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: "1px", background: "#1a1a1a", border: "1px solid #1a1a1a", borderRadius: "10px", overflow: "hidden" }}>
        {items.map((item, i) => (
          <div key={i} style={{ background: "#111", padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${item.accent}14`, border: `1px solid ${item.accent}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", color: item.accent, fontWeight: 700, lineHeight: 1 }}>{item.sym}</div>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#ddd", marginBottom: "3px", lineHeight: 1.3 }}>{item.label}</div>
              <div style={{ fontSize: "11px", color: "#666", lineHeight: 1.4 }}>{item.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { num: "01", heading: "Your resume, unchanged", body: "Drop your .docx — fonts, layout, and formatting are preserved exactly.", detail: "Nothing gets reformatted or rebuilt." },
    { num: "02", heading: "The job description", body: "Paste the full JD. The more context, the sharper the keyword match.", detail: "Works with any portal: LinkedIn, Naukri, Workday, company sites." },
    { num: "03", heading: "A surgically tailored resume", body: "Missing JD keywords are injected into your skills and bullets. Accept or reject each change.", detail: "Plus: match score, missing keywords, cover letter hooks." },
  ];
  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#e8e8e8", letterSpacing: "-0.03em", marginBottom: "8px", lineHeight: 1.3 }}>
          Built for people applying to<br />
          <span style={{ color: "#c8f064" }}>a lot of jobs at once.</span>
        </h2>
        <p style={{ fontSize: "14px", color: "#666", lineHeight: 1.6, maxWidth: "480px" }}>
          Every JD is different. ATS systems filter by keyword match before a human ever reads your resume.
          This tool closes that gap — fast, without rewriting who you are.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: "20px", padding: "16px 0", borderBottom: i < steps.length - 1 ? "1px solid #1a1a1a" : "none", alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, paddingTop: "1px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", color: "#c8f064", fontVariantNumeric: "tabular-nums" }}>{step.num}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#ddd", marginBottom: "5px" }}>{step.heading}</div>
              <div style={{ fontSize: "13px", color: "#666", lineHeight: 1.6 }}>{step.body}</div>
              <div style={{ fontSize: "12px", color: "#555", marginTop: "5px" }}>{step.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: "1px", background: "#1a1a1a", margin: "8px 0" }} />
      <WhatYouGet />
    </div>
  );
}

// Fix #5: dynamic wait messages
const WAIT_MESSAGES = [
  { at: 0,  msg: "Usually takes 15–25 seconds" },
  { at: 15, msg: "Still working — Gemini is processing…" },
  { at: 25, msg: "Almost there, large resumes take a moment…" },
  { at: 40, msg: "Taking longer than usual — still going…" },
];

export default function App() {
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [jd, setJd] = useState("");
  const [status, setStatus] = useState("idle");
  const [tailoredText, setTailoredText] = useState("");
  const [tailorStats, setTailorStats] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showScrollBtn, setShowScrollBtn] = useState(true);

  // Fix #12: browser back button support
  useEffect(() => {
    if (status === "done") {
      window.history.pushState({ page: "result" }, "");
    }
  }, [status]);

  useEffect(() => {
    const onPop = () => {
      if (status === "done") handleReset();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [status]);

  // Scroll button visibility
  useEffect(() => {
    if (resumeFile || status === "done") { setShowScrollBtn(false); return; }
    const el = document.getElementById("upload-section");
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollBtn(!entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [resumeFile, status]);

  const canTailor = resumeFile && resumeText && jd.trim().length > 50;

  // Elapsed timer
  useEffect(() => {
    if (status !== "processing") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Progress simulation — jumps to 80% immediately, crawls to 95%
  useEffect(() => {
    if (status !== "processing") {
      if (status === "done") setProgress(100);
      else setProgress(0);
      return;
    }
    setProgress(80);
    let current = 80;
    const tick = () => {
      current = current + (95 - current) * 0.04;
      setProgress(Math.min(current, 95));
    };
    const t = setInterval(tick, 300);
    return () => clearInterval(t);
  }, [status]);

  // Fix #5: get current wait message based on elapsed
  const waitMsg = [...WAIT_MESSAGES].reverse().find(m => elapsed >= m.at)?.msg || WAIT_MESSAGES[0].msg;

  function friendlyError(msg = "") {
    const s = msg.toLowerCase();
    if (s.includes("429") || s.includes("quota") || s.includes("rate limit") || s.includes("resource_exhausted"))
      return "Gemini free tier limit reached — wait a few minutes and try again.";
    if (s.includes("timeout") || s.includes("deadline") || s.includes("timed out"))
      return "Request timed out — try with a shorter job description.";
    if (s.includes("api_key") || s.includes("api key") || s.includes("unauthorized") || s.includes("401"))
      return "API key issue — check that GOOGLE_API_KEY is set correctly.";
    if (s.includes("500") || s.includes("internal server"))
      return "Server error — try again in a moment.";
    if (s.includes("network") || s.includes("fetch") || s.includes("failed to fetch") || s.includes("load failed") || s.includes("networkerror"))
      return "Could not reach the server — check your connection, or the server may be starting up. Try again in a moment.";
    return msg.slice(0, 150) || "Something went wrong — please try again.";
  }

  async function handleTailor() {
    setStatus("processing");
    setErrorMsg("");
    try {
      let response;
      try {
        response = await fetch("/api/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resumeText, jd }),
        });
      } catch (fetchErr) {
        // fetch() itself threw — network down or server unreachable
        throw new Error("Could not reach the server — check your connection, or the server may be starting up. Try again in a moment.");
      }
      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(friendlyError(rawText));
      }
      if (!response.ok) throw new Error(friendlyError(data.error || rawText));
      setTailoredText(data.tailoredText);
      setTailorStats(data.stats || null);
      setAnalysis(data.analysis || null);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error"); // Fix #4: keeps jd intact, user can retry
    }
  }

  // Fix #10: handleReset keeps JD so user can edit and retry
  function handleReset() {
    setStatus("idle");
    setTailoredText("");
    setTailorStats(null);
    setAnalysis(null);
    setErrorMsg("");
    setElapsed(0);
    setProgress(0);
    // jd preserved intentionally
  }

  function handleFullReset() {
    handleReset();
    setResumeFile(null);
    setResumeText("");
    setJd("");
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-mark" onClick={handleFullReset} style={{ cursor: "pointer", fontFamily: "'Inter',sans-serif", letterSpacing: "-0.02em" }} title="Back to home">RT</div>
        <div style={{ cursor: "pointer" }} onClick={handleFullReset}>
          <h1>Resume Tailor</h1>
          <p style={{ color: "#777", fontWeight: 500, letterSpacing: "-0.01em" }}>80% yours. 20% theirs. 100% honest.</p>
        </div>
      </header>

      {status === "done" ? (
        <>
          <ResultPanel
            originalText={resumeText}
            tailoredText={tailoredText}
            originalFile={resumeFile}
            jd={jd}
            tailorStats={tailorStats}
            analysis={analysis}
            onRetailor={handleReset}
            onReset={handleFullReset}
          />
          <TestPanel
            resumeText={resumeText}
            tailoredText={tailoredText}
            analysis={analysis}
            tailorStats={tailorStats}
            originalFile={resumeFile}
            jd={jd}
          />
        </>
      ) : (
        <main className="main-grid">
          {!resumeFile && <HowItWorks />}

          {/* Fix #1: privacy note */}
          {!resumeFile && (
            <p style={{ fontSize: "11px", color: "#666", textAlign: "center", marginBottom: "4px" }}>
              🔒 Your file stays in your browser — only text is sent to the AI
            </p>
          )}

          {showScrollBtn && (
            <div style={{ position: "fixed", bottom: "28px", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
              <button
                onClick={() => document.getElementById("upload-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{ background: "#c8f064", color: "#0f0f0f", border: "none", borderRadius: "100px", padding: "12px 28px", fontSize: "13px", fontWeight: 700, cursor: "pointer", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", transition: "opacity 0.15s, transform 0.15s", whiteSpace: "nowrap" }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                Upload your resume <span style={{ fontSize: "15px", lineHeight: 1 }}>↓</span>
              </button>
            </div>
          )}

          <div id="upload-section" />
          <ResumeUpload
            file={resumeFile}
            onFile={(file, text) => { setResumeFile(file); setResumeText(text); }}
          />

          {/* Fix #3: format note */}
          {resumeFile && (
            <p style={{ fontSize: "11px", color: "#555", marginTop: "-8px" }}>
              .docx preserves full formatting · .doc may have limited layout fidelity
            </p>
          )}

          {/* Fix #2: JD with hint */}
          <JDInput value={jd} onChange={setJd} onSubmit={() => canTailor && status !== "processing" && handleTailor()} />

          <div className="action-row">
            {/* Fix #4 + #6: preserve JD on error, show retry */}
            {status === "error" && (
              <div style={{ width: "100%", background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: "8px", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <p style={{ fontSize: "13px", color: "#ff8a8a", margin: 0, flex: 1 }}>{errorMsg}</p>
                <button
                  onClick={handleTailor}
                  disabled={!canTailor}
                  style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff8a8a", borderRadius: "6px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Retry
                </button>
              </div>
            )}

            <button
              className="tailor-btn"
              onClick={handleTailor}
              disabled={!canTailor || status === "processing"}
              style={status === "processing" ? {
                background: `linear-gradient(to right, #a8d840 ${progress}%, #2a3a10 ${progress}%)`,
                color: progress > 45 ? "#0f0f0f" : "#c8f064",
                transition: "background 0.3s ease",
              } : {}}
            >
              {status === "processing" ? (
                <span className="btn-inner">
                  Tailoring… <span style={{ fontWeight: 800, letterSpacing: "-0.02em", marginLeft: "4px" }}>{Math.round(progress)}%</span>
                </span>
              ) : "Tailor Resume"}
            </button>

            {/* Fix #5: dynamic wait message */}
            {status === "processing" && (
              <p className="hint" style={{ transition: "opacity 0.3s" }}>{waitMsg}</p>
            )}

            {!canTailor && status === "idle" && (
              <p className="hint">
                {!resumeFile ? "Upload your resume to get started" : jd.trim().length < 50 ? "Paste the full job description" : ""}
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}