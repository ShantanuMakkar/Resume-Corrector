import { useRef, useState } from "react";

async function extractTextFromDocx(file) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

export default function ResumeUpload({ file, onFile }) {
  const inputRef = useRef();
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const ACCEPTED = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];

  async function processFile(f) {
    if (!f || !ACCEPTED.includes(f.type)) {
      setParseError("Please upload a .docx or .doc file.");
      return;
    }
    setParsing(true);
    setParseError("");
    try {
      const text = await extractTextFromDocx(f);
      if (!text || text.length < 100) {
        setParseError("Couldn't extract text from the document.");
        return;
      }
      onFile(f, text);
    } catch (err) {
      setParseError("Failed to read document: " + err.message);
    } finally {
      setParsing(false);
    }
  }

  function handleChange(e) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }

  return (
    <div className="panel">
      <div className="panel-label">Resume</div>
      {file ? (
        <div className="file-ready">
          <div className="file-icon">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 2h8l4 4v12H4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 9h6M7 12h6M7 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="file-info">
            <span className="file-name">{file.name}</span>
            <span className="file-size">{(file.size / 1024).toFixed(0)} KB · Text extracted</span>
          </div>
          <button
            className="file-remove"
            onClick={() => {
              onFile(null, "");
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <div
          className={`drop-zone ${dragOver ? "drag-over" : ""} ${parsing ? "parsing" : ""}`}
          onClick={() => !parsing && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {parsing ? (
            <><span className="spinner" /><span>Reading document…</span></>
          ) : (
            <>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 4v16M9 11l7-7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 24h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
                <path d="M5 28h22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
              </svg>
              <span>Drop your resume here or click to browse</span>
              <span className="drop-hint">.docx or .doc · Formatting is preserved</span>
            </>
          )}
        </div>
      )}
      {parseError && <p className="field-error">{parseError}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
        style={{ display: "none" }}
        onChange={handleChange}
      />
    </div>
  );
}