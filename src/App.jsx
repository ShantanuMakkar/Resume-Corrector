import { useState, useEffect } from "react";
import ResumeUpload from "./components/ResumeUpload";
import JDInput from "./components/JDInput";
import ResultPanel from "./components/ResultPanel";
import "./App.css";

export default function App() {
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [jd, setJd] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState("idle");
  const [tailoredText, setTailoredText] = useState("");
  const [tailorStats, setTailorStats] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const canTailor = resumeFile && resumeText && jd.trim().length > 50;

  // Elapsed timer during processing
  useEffect(() => {
    if (status !== "processing") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
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
    setStatus("idle");
    setTailoredText("");
    setTailorStats(null);
    setAnalysis(null);
    setErrorMsg("");
    setJobTitle("");
    setCompany("");
    // Keep resume file — user likely wants to tailor for another JD
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
        <div className="logo-mark">RT</div>
        <div>
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
          jobTitle={jobTitle}
          company={company}
          tailorStats={tailorStats}
          analysis={analysis}
          onRetailor={() => handleReset()}
          onReset={handleFullReset}
        />
      ) : (
        <main className="main-grid">
          <ResumeUpload
            file={resumeFile}
            onFile={(file, text) => {
              setResumeFile(file);
              setResumeText(text);
            }}
          />

          {/* Job meta */}
          <div className="panel">
            <div className="panel-label">Job Details <span style={{fontWeight:400, textTransform:"none", letterSpacing:0}}>— optional but helps track applications</span></div>
            <div className="job-meta-row">
              <input
                className="meta-input"
                placeholder="Job title  e.g. Senior DevOps Engineer"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
              />
              <input
                className="meta-input"
                placeholder="Company  e.g. Stripe"
                value={company}
                onChange={e => setCompany(e.target.value)}
              />
            </div>
          </div>

          <JDInput value={jd} onChange={setJd} />

          <div className="action-row">
            {status === "error" && <p className="error-msg">{errorMsg}</p>}
            <button
              className="tailor-btn"
              onClick={handleTailor}
              disabled={!canTailor || status === "processing"}
            >
              {status === "processing" ? (
                <span className="btn-inner">
                  <span className="spinner" />
                  Tailoring… {elapsed > 0 && <span style={{opacity:0.6, fontWeight:400}}>({elapsed}s)</span>}
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