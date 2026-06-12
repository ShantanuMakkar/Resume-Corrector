import { useState } from "react";
import ResumeUpload from "./components/ResumeUpload";
import JDInput from "./components/JDInput";
import ResultPanel from "./components/ResultPanel";
import "./App.css";

export default function App() {
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeText, setResumeText] = useState("");
  const [jd, setJd] = useState("");
  const [status, setStatus] = useState("idle");
  const [tailoredText, setTailoredText] = useState("");
  const [tailorStats, setTailorStats] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const canTailor = resumeFile && resumeText && jd.trim().length > 50;

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
      setStatus("done");
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  }

  function handleReset() {
    setResumeFile(null);
    setResumeText("");
    setJd("");
    setStatus("idle");
    setTailoredText("");
    setTailorStats(null);
    setErrorMsg("");
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
          tailorStats={tailorStats}
          onReset={handleReset}
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
                  Tailoring…
                </span>
              ) : (
                "Tailor Resume"
              )}
            </button>
            {!canTailor && status === "idle" && (
              <p className="hint">
                {!resumeFile
                  ? "Upload your resume to get started"
                  : jd.trim().length < 50
                  ? "Paste the full job description"
                  : ""}
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}