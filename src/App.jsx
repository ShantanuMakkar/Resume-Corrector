import { useState, useEffect } from "react";
import ResumeUpload from "./components/ResumeUpload";
import JDInput from "./components/JDInput";
import ResultPanel from "./components/ResultPanel";
import "./App.css";

function HowItWorks() {
  const steps = [
    {
      tag: "Upload",
      heading: "Your resume, unchanged",
      body: "Drop your .docx file. We read the structure, not just the text — fonts, layout, and formatting are preserved exactly.",
      detail: "Nothing gets reformatted or rebuilt.",
      accent: "#c8f064",
    },
    {
      tag: "Paste",
      heading: "The job description",
      body: "Copy the full JD — requirements, responsibilities, skills. The more you paste, the sharper the match.",
      detail: "Works with any portal: LinkedIn, Naukri, Workday, company sites.",
      accent: "#7eb8ff",
    },
    {
      tag: "Get back",
      heading: "A surgically tailored resume",
      body: "We inject the JD's missing keywords into your skills and bullets. You see exactly what changed, accept or reject each one.",
      detail: "Plus: JD match score, missing keywords, and what to say in your cover letter.",
      accent: "#4ddb8a",
    },
  ];

  return (
    <div style={{ marginBottom: "40px" }}>
      {/* Headline */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#e8e8e8", letterSpacing: "-0.03em", marginBottom: "8px", lineHeight: 1.3 }}>
          Built for people applying to<br />
          <span style={{ color: "#c8f064" }}>a lot of jobs at once.</span>
        </h2>
        <p style={{ fontSize: "14px", color: "#555", lineHeight: 1.6, maxWidth: "480px" }}>
          Every JD is different. ATS systems filter by keyword match before a human ever reads your resume.
          This tool closes that gap — fast, without rewriting who you are.
        </p>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: "flex",
            gap: "16px",
            padding: "16px 0",
            borderBottom: i < steps.length - 1 ? "1px solid #1e1e1e" : "none",
            alignItems: "flex-start",
          }}>
            <div style={{
              flexShrink: 0,
              width: "64px",
              paddingTop: "2px",
            }}>
              <span style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: step.accent,
                background: `${step.accent}18`,
                border: `1px solid ${step.accent}30`,
                borderRadius: "4px",
                padding: "2px 7px",
                whiteSpace: "nowrap",
              }}>{step.tag}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#ddd", marginBottom: "4px" }}>{step.heading}</div>
              <div style={{ fontSize: "13px", color: "#666", lineHeight: 1.55 }}>{step.body}</div>
              <div style={{ fontSize: "12px", color: "#444", marginTop: "4px", fontStyle: "italic" }}>{step.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* What you get */}
      <div style={{
        marginTop: "24px",
        background: "#161616",
        border: "1px solid #2a2a2a",
        borderRadius: "10px",
        padding: "16px 20px",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#444", marginBottom: "12px" }}>
          What you get
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {[
            { label: "Tailored .docx", color: "#c8f064" },
            { label: "JD match score", color: "#7eb8ff" },
            { label: "Missing keywords", color: "#ff8a8a" },
            { label: "Keyword injection into bullets", color: "#4ddb8a" },
            { label: "Accept / reject each change", color: "#f0c040" },
            { label: "Cover letter hooks", color: "#c8f064" },
            { label: "Reframing suggestions", color: "#7eb8ff" },
            { label: "Genuine gap analysis", color: "#ff8a8a" },
          ].map((item, i) => (
            <span key={i} style={{
              fontSize: "12px",
              color: item.color,
              background: `${item.color}12`,
              border: `1px solid ${item.color}25`,
              borderRadius: "5px",
              padding: "4px 10px",
            }}>{item.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

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

  const canTailor = resumeFile && resumeText && jd.trim().length > 50;

  // Elapsed timer during processing
  useEffect(() => {
    if (status !== "processing") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Simulated progress bar — mimics real timing without streaming
  useEffect(() => {
    if (status !== "processing") {
      if (status === "done") setProgress(100);
      else setProgress(0);
      return;
    }
    setProgress(0);
    // Phases: 0-30% fast, 30-75% slow crawl, 75-95% medium
    let current = 0;
    const tick = () => {
      current = current < 30 ? current + 3
               : current < 75 ? current + 0.6
               : current < 95 ? current + 0.3
               : current;
      setProgress(Math.min(current, 95));
    };
    const t = setInterval(tick, 300);
    return () => clearInterval(t);
  }, [status]);

  async function handleTailor() {
    setStatus("processing");
    setErrorMsg("");
    try {
      const response = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText, jd }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Server error");
      }
      const data = await response.json();
      setTailoredText(data.tailoredText);
      setTailorStats(data.stats || null);
      setAnalysis(data.analysis || null);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  }

  function handleReset() {
    // Immediately clear result state so UI snaps back to input screen
    setStatus("idle");
    setTailoredText("");
    setTailorStats(null);
    setAnalysis(null);
    setErrorMsg("");
    setElapsed(0);
    // Keep resume + JD — user likely wants to tailor for another JD or retry
  }

  function handleFullReset() {
    setStatus("idle");
    setTailoredText("");
    setTailorStats(null);
    setAnalysis(null);
    setErrorMsg("");
    setElapsed(0);
    setProgress(0);
    setResumeFile(null);
    setResumeText("");
    setJd("");
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-mark" onClick={handleFullReset} style={{cursor:"pointer"}} title="Back to home">RT</div>
        <div style={{cursor:"pointer"}} onClick={handleFullReset}>
          <h1>Resume Tailor</h1>
          <p>80% yours. 20% theirs. 100% honest.</p>
        </div>
      </header>

      {status === "done" ? (
        <ResultPanel
          originalText={resumeText}
          tailoredText={tailoredText}
          originalFile={resumeFile}
          jd={jd}
          tailorStats={tailorStats}
          analysis={analysis}
          onRetailor={() => handleReset()}
          onReset={handleFullReset}
        />
      ) : (
        <main className="main-grid">
          {!resumeFile && <HowItWorks />}
          <ResumeUpload
            file={resumeFile}
            onFile={(file, text) => {
              setResumeFile(file);
              setResumeText(text);
            }}
          />

          <JDInput value={jd} onChange={setJd} />

          <div className="action-row">
            {status === "error" && <p className="error-msg">{errorMsg}</p>}
            <button
              className={`tailor-btn ${status === "processing" ? "tailor-btn-progress" : ""}`}
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
                  {Math.round(progress)}% — Tailoring…
                </span>
              ) : (
                "Tailor Resume"
              )}
            </button>
            {status === "processing" && (
              <p className="hint">Usually takes 15–25 seconds</p>
            )}
            {!canTailor && status === "idle" && (
              <p className="hint">
                {!resumeFile ? "Upload your resume to get started"
                  : jd.trim().length < 50 ? "Paste the full job description" : ""}
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}