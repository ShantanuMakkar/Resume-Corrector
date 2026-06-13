export default function JDInput({ value, onChange, onSubmit }) {
  const charCount = value.trim().length;
  const isLong = charCount > 200;

  // JD validation warning
  const looksLikeUrl = value.trim().startsWith("http") && charCount < 300;
  const tooShort = charCount > 10 && charCount < 100;
  const warning = looksLikeUrl
    ? "Looks like a URL — paste the actual job description text, not the link."
    : tooShort
    ? "This looks too short to be a full JD — paste the requirements and skills sections too."
    : null;

  function handleKeyDown(e) {
    // Fix #19: Cmd+Enter / Ctrl+Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
    }
  }

  return (
    <div className="panel">
      <div className="panel-label">
        Job Description
        {charCount > 0 && (
          <span className={`char-count ${isLong ? "count-good" : "count-low"}`}>
            {charCount} chars{!isLong ? " — paste more for better results" : ""}
          </span>
        )}
      </div>
      <textarea
        className="jd-textarea"
        placeholder="Paste the full job description — include requirements, responsibilities, and skills sections for best results."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      {warning && (
        <p style={{ fontSize: "12px", color: "#f0a040", marginTop: "7px", lineHeight: 1.4 }}>
          ⚠ {warning}
        </p>
      )}
      {isLong && (
        <p style={{ fontSize: "11px", color: "#444", marginTop: "6px" }}>
          ⌘ + Enter to tailor
        </p>
      )}
    </div>
  );
}