export default function JDInput({ value, onChange }) {
  const charCount = value.trim().length;
  const isLong = charCount > 200;

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
        placeholder="Paste the full job description here — include requirements, responsibilities, and skills sections for best results."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
