import { useState } from "react";

// Hidden test panel — only shown when ?test=1 is in the URL
// Runs full diagnostic and copies report to clipboard

export default function TestPanel({ resumeText, tailoredText, analysis, tailorStats, originalFile, jd }) {
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);

  if (typeof window === "undefined") return null;
  if (!new URLSearchParams(window.location.search).has("test")) return null;

  async function runDiagnostic() {
    setRunning(true);
    const lines = [];

    lines.push("═══════════════════════════════════════");
    lines.push("RESUME TAILOR — TEST DIAGNOSTIC REPORT");
    lines.push(`Time: ${new Date().toISOString()}`);
    lines.push("═══════════════════════════════════════");

    // ── 1. File info ─────────────────────────────────────────────────────────
    lines.push("\n── FILE INFO ──");
    lines.push(`File: ${originalFile?.name || "none"}`);
    lines.push(`File size: ${originalFile ? (originalFile.size/1024).toFixed(1) + " KB" : "none"}`);
    lines.push(`JD length: ${jd?.length || 0} chars`);

    // ── 2. Resume text analysis ───────────────────────────────────────────────
    lines.push("\n── RESUME TEXT EXTRACTION ──");
    if (resumeText) {
      const rLines = resumeText.split("\n");
      const nonEmpty = rLines.filter(l => l.trim());
      const bullets = rLines.filter(l => l.trim().startsWith("•") || l.trim().startsWith("●"));
      const skillsLines = rLines.filter(l => l.includes("|") && l.split(/\s+/).length > 12);
      const techLines = rLines.filter(l => l.toLowerCase().startsWith("technologies used"));
      lines.push(`Total lines: ${rLines.length}`);
      lines.push(`Non-empty lines: ${nonEmpty.length}`);
      lines.push(`Bullet lines detected: ${bullets.length}`);
      lines.push(`Skills lines: ${skillsLines.length}`);
      lines.push(`Tech stack lines: ${techLines.length}`);
      lines.push(`Word count: ${resumeText.split(/\s+/).filter(Boolean).length}`);
      lines.push(`\nFirst 5 lines:`);
      nonEmpty.slice(0, 5).forEach((l, i) => lines.push(`  [${i}] ${l.slice(0, 80)}`));
      if (bullets.length > 0) {
        lines.push(`\nFirst 3 bullets:`);
        bullets.slice(0, 3).forEach((l, i) => lines.push(`  [${i}] ${l.slice(0, 80)}`));
      }
      if (skillsLines.length > 0) {
        lines.push(`\nSkills line (first 120 chars):`);
        lines.push(`  ${skillsLines[0].slice(0, 120)}`);
      }
    } else {
      lines.push("No resume text — file not uploaded or extraction failed");
    }

    // ── 3. Tailoring results ──────────────────────────────────────────────────
    lines.push("\n── TAILORING RESULTS ──");
    if (tailoredText && resumeText) {
      const origLines = resumeText.split("\n").map(s => s.trim());
      const tailLines = tailoredText.split("\n").map(s => s.trim());
      lines.push(`Original lines: ${origLines.length}`);
      lines.push(`Tailored lines: ${tailLines.length}`);
      lines.push(`Line count match: ${origLines.length === tailLines.length ? "✓ YES" : "✗ NO — MISMATCH"}`);
      lines.push(`Word drift: ${tailorStats?.wordDrift > 0 ? "+" : ""}${tailorStats?.wordDrift ?? "N/A"}`);

      // Find changed lines
      const changed = [];
      const max = Math.max(origLines.length, tailLines.length);
      for (let i = 0; i < max; i++) {
        const o = origLines[i] ?? "";
        const t = tailLines[i] ?? "";
        if (o !== t) changed.push({ idx: i, orig: o, tail: t });
      }
      lines.push(`Changed lines: ${changed.length}`);

      if (changed.length > 0) {
        lines.push(`\nAll changes:`);
        changed.forEach(({ idx, orig, tail }) => {
          lines.push(`  Line ${idx + 1}:`);
          lines.push(`    BEFORE: ${orig.slice(0, 100)}`);
          lines.push(`    AFTER:  ${tail.slice(0, 100)}`);
        });
      } else {
        lines.push("⚠ NO CHANGES MADE — possible prompt/budget issue");
      }
    } else {
      lines.push("No tailored text — tailoring not run yet");
    }

    // ── 4. Analysis / scores ─────────────────────────────────────────────────
    lines.push("\n── ANALYSIS ──");
    if (analysis) {
      lines.push(`Before score: ${analysis.beforeScore ?? "N/A"}%`);
      lines.push(`After score: ${analysis.matchScore ?? "N/A"}%`);
      lines.push(`Score delta: ${analysis.matchScore != null && analysis.beforeScore != null ? `+${analysis.matchScore - analysis.beforeScore}%` : "N/A"}`);
      lines.push(`Matched keywords (${analysis.matchedKeywords?.length ?? 0}): ${(analysis.matchedKeywords || []).join(", ")}`);
      lines.push(`Missing keywords (${analysis.missingKeywords?.length ?? 0}): ${(analysis.missingKeywords || []).join(", ")}`);
      lines.push(`Title alignment: ${analysis.titleAlignment}`);
      lines.push(`Recommendation: ${analysis.recommendation}`);
    } else {
      lines.push("No analysis data");
    }

    // ── 5. JD preprocessing check ────────────────────────────────────────────
    lines.push("\n── JD INFO ──");
    if (jd) {
      lines.push(`Raw JD: ${jd.length} chars, ${jd.split("\n").length} lines`);
      const hasRequirements = /requirements?|qualifications?|responsibilities/i.test(jd);
      const hasBenefits = /benefits|salary|pto|health insurance/i.test(jd);
      lines.push(`Has requirements section: ${hasRequirements ? "✓" : "✗"}`);
      lines.push(`Has benefits/salary (will be stripped): ${hasBenefits ? "yes" : "no"}`);
      lines.push(`\nJD first 300 chars:`);
      lines.push(`  ${jd.slice(0, 300)}`);
    }

    // ── 6. Keyword injection check ───────────────────────────────────────────
    lines.push("\n── KEYWORD INJECTION CHECK ──");
    if (resumeText && tailoredText && analysis?.missingKeywords?.length) {
      lines.push("Missing keywords status post-tailoring:");
      analysis.missingKeywords.forEach(kw => {
        const wasIn = resumeText.toLowerCase().includes(kw.toLowerCase());
        const nowIn = tailoredText.toLowerCase().includes(kw.toLowerCase());
        const status = wasIn ? "was already present" : nowIn ? "✓ INJECTED" : "✗ still missing";
        lines.push(`  ${kw}: ${status}`);
      });
    }

    lines.push("\n═══════════════════════════════════════");
    lines.push("END OF REPORT");
    lines.push("═══════════════════════════════════════");

    const fullReport = lines.join("\n");
    setReport(fullReport);
    await navigator.clipboard.writeText(fullReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    setRunning(false);
  }

  return (
    <div style={{
      position: "fixed", bottom: "80px", right: "20px", zIndex: 999,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px",
    }}>
      <button
        onClick={runDiagnostic}
        disabled={running}
        style={{
          background: "#1a1a2e", border: "1px solid #7eb8ff", color: "#7eb8ff",
          borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 600,
          cursor: "pointer", fontFamily: "monospace",
        }}
      >
        {running ? "Running…" : copied ? "✓ Copied!" : "🧪 Copy Test Report"}
      </button>
      {report && (
        <div style={{
          background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: "8px",
          padding: "12px", maxWidth: "400px", maxHeight: "200px", overflowY: "auto",
          fontSize: "10px", color: "#666", fontFamily: "monospace", lineHeight: 1.4,
        }}>
          {report.slice(0, 500)}…
        </div>
      )}
    </div>
  );
}