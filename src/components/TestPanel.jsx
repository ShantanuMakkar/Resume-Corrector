import { useState } from "react";

export default function TestPanel({ resumeText, tailoredText, analysis, tailorStats, originalFile, jd }) {
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);

  if (typeof window === "undefined") return null;
  if (!new URLSearchParams(window.location.search).has("test")) return null;

  async function runDiagnostic() {
    setRunning(true);
    const lines = [];
    const sep = "─".repeat(50);

    lines.push("═".repeat(55));
    lines.push("RESUME TAILOR — COMPREHENSIVE TEST REPORT");
    lines.push(`Time: ${new Date().toISOString()}`);
    lines.push(`URL: ${window.location.href}`);
    lines.push("═".repeat(55));

    // ── 1. File info ──────────────────────────────────────────
    lines.push("\n[1] FILE INFO");
    lines.push(sep);
    lines.push(`Resume file: ${originalFile?.name || "none"}`);
    lines.push(`File size: ${originalFile ? (originalFile.size/1024).toFixed(1) + " KB" : "none"}`);
    lines.push(`File type: ${originalFile?.type || "none"}`);
    lines.push(`JD length: ${jd?.length || 0} chars / ${jd?.split(/\s+/).filter(Boolean).length || 0} words`);
    lines.push(`JD lines: ${jd?.split("\n").length || 0}`);

    // ── 2. Resume extraction ──────────────────────────────────
    lines.push("\n[2] RESUME EXTRACTION");
    lines.push(sep);
    if (resumeText) {
      const rLines = resumeText.split("\n");
      const nonEmpty = rLines.filter(l => l.trim());
      const bullets = rLines.filter(l => l.trim().startsWith("•") || l.trim().startsWith("●"));
      const skillsLines = rLines.filter(l => l.includes("|") && l.split(/\s+/).length > 12);
      const techLines = rLines.filter(l => l.toLowerCase().startsWith("technologies used"));
      const emptyLines = rLines.filter(l => !l.trim());
      lines.push(`Total lines: ${rLines.length} (${nonEmpty.length} content, ${emptyLines.length} empty)`);
      lines.push(`Bullet lines: ${bullets.length}`);
      lines.push(`Skills lines: ${skillsLines.length}`);
      lines.push(`Tech stack lines: ${techLines.length}`);
      lines.push(`Word count: ${resumeText.split(/\s+/).filter(Boolean).length}`);
      lines.push(`Char count: ${resumeText.length}`);
      lines.push(`\nAll lines with type:`);
      rLines.forEach((l, i) => {
        const t = l.trim();
        if (!t) return;
        const type = t.startsWith("•") || t.startsWith("●") ? "[BULLET]"
          : t.includes("|") && t.split(/\s+/).length > 12 ? "[SKILLS]"
          : t.toLowerCase().startsWith("technologies used") ? "[TECH  ]"
          : t.toUpperCase() === t && t.length < 30 ? "[HEADER]"
          : "[TEXT  ]";
        lines.push(`  ${String(i).padStart(2,'0')} ${type} (${t.split(/\s+/).filter(Boolean).length}w): ${t.slice(0,70)}${t.length>70?"…":""}`);
      });
    } else {
      lines.push("⚠ No resume text extracted");
    }

    // ── 3. JD analysis ────────────────────────────────────────
    lines.push("\n[3] JD ANALYSIS");
    lines.push(sep);
    if (jd) {
      const hasReqs = /requirements?|qualifications?|responsibilities/i.test(jd);
      const hasBenefits = /benefits|salary|pto|health insurance/i.test(jd);
      const hasAboutUs = /^about us|^who we are|^our mission/im.test(jd);
      lines.push(`Has requirements section: ${hasReqs ? "✓" : "✗"}`);
      lines.push(`Has benefits/salary (stripped): ${hasBenefits ? "YES" : "no"}`);
      lines.push(`Has About Us intro (stripped): ${hasAboutUs ? "YES" : "no"}`);
      // Extract capitalised terms from JD
      const jdTerms = [...new Set((jd.match(/\b[A-Z][a-zA-Z0-9]+\b/g)||[]).filter(t=>t.length>2))];
      lines.push(`Technical terms in JD: ${jdTerms.slice(0,30).join(", ")}`);
    }

    // ── 4. Tailoring results ──────────────────────────────────
    lines.push("\n[4] TAILORING RESULTS");
    lines.push(sep);
    if (tailoredText && resumeText) {
      const origLines = resumeText.split("\n").map(s => s.trim());
      const tailLines = tailoredText.split("\n").map(s => s.trim());
      lines.push(`Original lines: ${origLines.length}`);
      lines.push(`Tailored lines: ${tailLines.length}`);
      lines.push(`Line count match: ${origLines.length === tailLines.length ? "✓ YES" : "✗ MISMATCH"}`);
      lines.push(`Word drift: ${tailorStats?.wordDrift > 0 ? "+" : ""}${tailorStats?.wordDrift ?? "N/A"} words`);

      const changed = [];
      const max = Math.max(origLines.length, tailLines.length);
      for (let i = 0; i < max; i++) {
        const o = origLines[i] ?? "";
        const t = tailLines[i] ?? "";
        if (o !== t) {
          const oWords = o.split(/\s+/).filter(Boolean).length;
          const tWords = t.split(/\s+/).filter(Boolean).length;
          const drift = tWords - oWords;
          const type = o.startsWith("•") || o.startsWith("●") ? "BULLET"
            : o.includes("|") && oWords > 12 ? "SKILLS"
            : o.toLowerCase().startsWith("technologies") ? "TECH"
            : "TEXT";
          changed.push({ idx: i, orig: o, tail: t, oWords, tWords, drift, type });
        }
      }

      lines.push(`Changed lines: ${changed.length}`);
      const byType = {};
      changed.forEach(c => { byType[c.type] = (byType[c.type]||0)+1; });
      lines.push(`By type: ${Object.entries(byType).map(([k,v])=>`${k}=${v}`).join(", ")}`);

      const truncated = changed.filter(c => c.tWords < c.oWords * 0.85 && c.oWords > 5);
      const expanded = changed.filter(c => c.tWords > c.oWords + 3);
      lines.push(`Truncated lines (reverted by server): ${truncated.length}`);
      lines.push(`Over-budget lines: ${expanded.length}`);

      lines.push(`\nAll changes (with word counts):`);
      changed.forEach(({ idx, orig, tail, oWords, tWords, drift, type }) => {
        lines.push(`  Line ${String(idx+1).padStart(2,'0')} [${type}] ${oWords}w→${tWords}w (${drift>=0?"+":""}${drift}):`);
        lines.push(`    BEFORE: ${orig.slice(0,100)}${orig.length>100?"…":""}`);
        lines.push(`    AFTER:  ${tail.slice(0,100)}${tail.length>100?"…":""}`);
        // Show what was added/removed
        const origWords = new Set(orig.toLowerCase().split(/\s+/));
        const tailWords = tail.toLowerCase().split(/\s+/);
        const added = tailWords.filter(w => !origWords.has(w) && w.length > 2);
        const origWordArr = orig.toLowerCase().split(/\s+/);
        const tailWordSet = new Set(tail.toLowerCase().split(/\s+/));
        const removed = origWordArr.filter(w => !tailWordSet.has(w) && w.length > 2);
        if (added.length) lines.push(`    ADDED:   ${added.join(", ")}`);
        if (removed.length) lines.push(`    REMOVED: ${removed.join(", ")}`);
      });
    } else {
      lines.push("⚠ No tailored text — run tailoring first");
    }

    // ── 5. Score analysis ─────────────────────────────────────
    lines.push("\n[5] SCORE ANALYSIS");
    lines.push(sep);
    if (analysis) {
      lines.push(`Before score: ${analysis.beforeScore ?? "N/A"}%`);
      lines.push(`After score:  ${analysis.matchScore ?? "N/A"}%`);
      lines.push(`Delta:        ${analysis.matchScore != null && analysis.beforeScore != null ? (analysis.matchScore - analysis.beforeScore >= 0 ? "+" : "") + (analysis.matchScore - analysis.beforeScore) + "%" : "N/A"}`);
      lines.push(`\nMatched keywords (${analysis.matchedKeywords?.length ?? 0}):`);
      lines.push(`  ${(analysis.matchedKeywords||[]).join(", ")}`);
      lines.push(`\nMissing keywords (${analysis.missingKeywords?.length ?? 0}):`);
      lines.push(`  ${(analysis.missingKeywords||[]).join(", ")}`);
      lines.push(`\nTitle alignment: ${analysis.titleAlignment}`);
      lines.push(`Recommendation: ${analysis.recommendation}`);
      lines.push(`Missing context: ${analysis.missingContext}`);
    } else {
      lines.push("⚠ No analysis data");
    }

    // ── 6. Keyword injection audit ────────────────────────────
    lines.push("\n[6] KEYWORD INJECTION AUDIT");
    lines.push(sep);
    if (resumeText && tailoredText && analysis?.missingKeywords?.length) {
      let injected = 0, alreadyThere = 0, stillMissing = 0;
      analysis.missingKeywords.forEach(kw => {
        const wasIn = resumeText.toLowerCase().includes(kw.toLowerCase());
        const nowIn = tailoredText.toLowerCase().includes(kw.toLowerCase());
        if (wasIn) { alreadyThere++; lines.push(`  ○ ${kw}: was already present`); }
        else if (nowIn) { injected++; lines.push(`  ✓ ${kw}: INJECTED`); }
        else { stillMissing++; lines.push(`  ✗ ${kw}: still missing`); }
      });
      lines.push(`\nSummary: ${injected} injected, ${alreadyThere} already present, ${stillMissing} still missing`);
      lines.push(`Injection rate: ${analysis.missingKeywords.length > 0 ? Math.round((injected / analysis.missingKeywords.length) * 100) : 0}%`);
    } else {
      lines.push("⚠ Need analysis data and tailored text");
    }

    // ── 7. Bullet analysis ────────────────────────────────────
    lines.push("\n[7] BULLET ANALYSIS");
    lines.push(sep);
    if (resumeText && tailoredText) {
      const origBullets = resumeText.split("\n").filter(l => l.trim().startsWith("•") || l.trim().startsWith("●"));
      const tailBullets = tailoredText.split("\n").filter(l => l.trim().startsWith("•") || l.trim().startsWith("●"));
      lines.push(`Original bullets: ${origBullets.length}`);
      lines.push(`Tailored bullets: ${tailBullets.length}`);
      const changedBullets = origBullets.filter((b, i) => b.trim() !== (tailBullets[i]||"").trim());
      lines.push(`Changed bullets: ${changedBullets.length} of ${origBullets.length}`);
      lines.push(`Unchanged bullets: ${origBullets.length - changedBullets.length}`);
      if (changedBullets.length > 0) {
        lines.push(`\nChanged bullets detail:`);
        origBullets.forEach((ob, i) => {
          const tb = (tailBullets[i]||"").trim();
          if (ob.trim() !== tb) {
            const ow = ob.trim().split(/\s+/).length;
            const tw = tb.split(/\s+/).length;
            lines.push(`  Bullet ${i+1} (${ow}w→${tw}w ${tw-ow>=0?"+":""}${tw-ow}):`);
            lines.push(`    B: ${ob.trim().slice(0,90)}`);
            lines.push(`    A: ${tb.slice(0,90)}`);
          }
        });
      }
    }

    // ── 8. Quality checks ─────────────────────────────────────
    lines.push("\n[8] QUALITY CHECKS");
    lines.push(sep);
    if (resumeText && tailoredText) {
      const origLines = resumeText.split("\n").map(s=>s.trim());
      const tailLines = tailoredText.split("\n").map(s=>s.trim());

      // Check: contact info unchanged
      const contactOrig = origLines.slice(0,5).join(" ");
      const contactTail = tailLines.slice(0,5).join(" ");
      lines.push(`Contact info preserved: ${contactOrig === contactTail ? "✓" : "✗ CHANGED"}`);

      // Check: no truncated lines
      let truncCount = 0;
      origLines.forEach((o, i) => {
        const t = tailLines[i] || "";
        const ow = o.split(/\s+/).filter(Boolean).length;
        const tw = t.split(/\s+/).filter(Boolean).length;
        if (ow > 5 && tw < ow * 0.85) truncCount++;
      });
      lines.push(`Truncated lines: ${truncCount === 0 ? "✓ none" : `✗ ${truncCount} lines truncated`}`);

      // Check: word drift within bounds
      const drift = tailorStats?.wordDrift ?? 0;
      lines.push(`Word drift (${drift>=0?"+":""}${drift}): ${Math.abs(drift) <= 20 ? "✓ acceptable" : "⚠ large drift"}`);

      // Check: no numbers changed in bullets
      const numPattern = /\d+[%KkMm]?/g;
      let numChanged = 0;
      origLines.forEach((o, i) => {
        const t = tailLines[i] || "";
        if (o !== t) {
          const origNums = (o.match(numPattern)||[]).sort().join(",");
          const tailNums = (t.match(numPattern)||[]).sort().join(",");
          if (origNums !== tailNums) numChanged++;
        }
      });
      lines.push(`Numbers/metrics changed: ${numChanged === 0 ? "✓ none" : `⚠ ${numChanged} lines have changed numbers`}`);

      // Check: bold company/project names intact (heuristic)
      const importantTerms = ["Truist","HSBC","Infosys","Tech Mahindra","Argo CD","GitLab"];
      const termCheck = importantTerms.every(term =>
        tailoredText.includes(term) === resumeText.includes(term)
      );
      lines.push(`Key terms preserved (companies, tools): ${termCheck ? "✓" : "✗ some terms changed"}`);
    }

    lines.push("\n" + "═".repeat(55));
    lines.push("END OF REPORT");
    lines.push("═".repeat(55));

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
          background: "#0d1117", border: "1px solid #7eb8ff", color: "#7eb8ff",
          borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 600,
          cursor: "pointer", fontFamily: "monospace", boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        }}
      >
        {running ? "Running…" : copied ? "✓ Copied to clipboard!" : "🧪 Copy Test Report"}
      </button>
      {report && (
        <div style={{
          background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: "8px",
          padding: "10px 12px", maxWidth: "380px", maxHeight: "160px", overflowY: "auto",
          fontSize: "10px", color: "#555", fontFamily: "monospace", lineHeight: 1.4,
        }}>
          {report.slice(0, 300)}…
        </div>
      )}
    </div>
  );
}