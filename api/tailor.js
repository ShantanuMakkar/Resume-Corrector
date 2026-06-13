import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "10mb" } },
};

// Fix #3: separate content lines from structural empty lines
// so the AI only sees/modifies real content
function splitLines(text) {
  return text.split("\n");
}

function buildLineMetadata(lines) {
  return lines.map((line) => {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const isEmpty = words === 0;
    const isBullet = trimmed.startsWith("●") || trimmed.startsWith("•") || trimmed.startsWith("–") || trimmed.startsWith("-");
    const isSkills = trimmed.includes("|") && words > 12;
    const isTechStack = trimmed.toLowerCase().startsWith("technologies used");
    // Budget: skills +5, bullets +3, tech stacks +3, others +1, empty 0
    const budget = isEmpty ? 0 : isSkills ? words + 5 : (isBullet || isTechStack) ? words + 3 : words + 1;
    return { words, budget, isEmpty, isBullet, isSkills, isTechStack };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, jd } = req.body;
    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    const origLines = splitLines(resumeText);
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;
    const lineMetadata = buildLineMetadata(origLines);

    // Fix #3: only send non-empty lines to AI with a mapping back to original positions
    // This prevents the AI from being confused by blank lines and changing line count
    const contentLines = origLines.map((line, i) => ({ line, idx: i, meta: lineMetadata[i] }))
      .filter(({ meta }) => !meta.isEmpty);

    const contentText = contentLines.map(({ line }) => line).join("\n");
    const contentLineCount = contentLines.length;

    const systemPrompt = `You are an ATS optimization specialist. Your job is to maximize keyword coverage between a resume and job description by injecting missing JD keywords.

STEP 1 — EXTRACT MISSING KEYWORDS:
Read the JD carefully. List every technical skill, tool, methodology, cloud service, and domain term.
Cross-check against the resume. Identify what is ABSENT or under-represented.

STEP 2 — INJECT KEYWORDS INTO RESUME:

TARGET 1 — SKILLS LINE (highest priority):
- Restructure to lead with JD-critical terms
- Use JD's exact terminology (e.g. if JD says "Observability" group Prometheus/Grafana/Dynatrace under it)
- You have +5 word budget on this line

TARGET 2 — BULLET POINTS (inject into EVERY relevant bullet — do not skip):
- For each bullet: does this work involve a JD keyword not mentioned? If yes — inject it
- To fit within budget: REMOVE filler words first, THEN add keyword
- Filler words to remove: "successfully", "effectively", "utilizing", "leveraging", "in order to", "in a timely manner"
- You have +3 word budget per bullet

INJECTION EXAMPLES (follow this pattern exactly):
Original: "Built production Alerts App on AWS with Lambda/API Gateway/SQS ingestion, boosting throughput by 40%."
After:    "Built production Alerts App on AWS (Lambda, SQS, SNS, EventBridge), boosting throughput by 40%."
Why: removed "ingestion", added SNS+EventBridge — net 0 words

Original: "Automated Terraform deployments and Dockerized apps with Python/Bash scripting, reducing manual ops by 50%."
After:    "Automated Terraform/GitOps deployments and containerized apps with Python/Bash, reducing manual ops by 50%."
Why: removed "scripting", added "GitOps" — net 0 words

Original: "Designed GitLab CI/CD pipelines with Terraform, reducing deployment cycle time by 50%."
After:    "Designed GitLab CI/CD pipelines with Terraform (IaC), reducing deployment cycle time by 50%."
Why: added "(IaC)" — net +1 word, within budget

TARGET 3 — SUMMARY (first 2-3 lines after name):
Mirror the JD role title and top 3 skills. Budget: +1 word.

TARGET 4 — TECHNOLOGIES USED lines:
Reorder to lead with JD-mentioned tools. Add missing ones that genuinely apply.

HARD RULES:
- Output EXACTLY ${contentLineCount} lines — same as input
- Each line must stay within its word budget (shown below)
- NEVER change: name, contact info, company names, job titles, dates, education, certifications
- NEVER fabricate skills or experience not in the resume
- Do NOT change punctuation, grammar, or sentence structure unless injecting a keyword
- If a line has no relevant gap, return it UNCHANGED

PER-LINE WORD BUDGETS:
${contentLines.map(({ line, meta }, i) => {
  const trimmed = line.trim();
  const label = meta.isBullet ? "[bullet]" : meta.isSkills ? "[skills]" : meta.isTechStack ? "[tech]" : "";
  return `Line ${i+1} ${label}: max ${meta.budget} words (now: ${meta.words}) | ${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}`;
}).join("\n")}

OUTPUT: Return ONLY the resume text. Exactly ${contentLineCount} lines. No preamble, no commentary.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${contentLineCount} content lines — match this count exactly):
${contentText}

Inject missing JD keywords. Focus on bullets and skills line. Trim filler to stay within budget.`;

    const analysisPrompt = `Analyze this ORIGINAL resume against the job description.
Return ONLY valid JSON — no markdown, no explanation, no code fences.

{
  "matchScore": <integer 0-100: % of JD keywords present in resume>,
  "missingKeywords": [<up to 10 JD keywords completely absent from resume, most critical first>],
  "matchedKeywords": [<up to 12 JD keywords already in resume>],
  "missingContext": "<one sentence: what is the single most critical gap>",
  "titleAlignment": "<one sentence: how well does candidate title/seniority match the JD>",
  "recommendation": "<1-2 sentences: honest fit assessment and strongest talking point>"
}

Resume:
${resumeText}

Job Description:
${jd}`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });
    const analysisModel = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const [tailorResponse, analysisResponse] = await Promise.all([
      model.generateContent(userPrompt),
      analysisModel.generateContent(analysisPrompt),
    ]);

    let tailoredContentText = tailorResponse.response.text().trim();
    let analysis = null;

    // Parse analysis
    try {
      let raw = analysisResponse.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(raw);
    } catch (e) {
      console.warn("Analysis parse failed:", e.message);
    }

    // Fix #2: robust line count enforcement
    // Split AI output back into content lines
    const tailoredContentLines = tailoredContentText.split("\n");

    // If AI returned wrong count, fix it intelligently
    const correctedContent = contentLines.map(({ line: origLine, meta }, i) => {
      const tailLine = tailoredContentLines[i] ?? origLine;

      // Revert empty lines (should never be in content but safety check)
      if (!tailLine.trim()) return origLine;

      // Word budget enforcement
      const tailWords = tailLine.trim().split(/\s+/).filter(Boolean).length;
      if (tailWords > meta.budget) {
        console.log(`Line ${i+1} reverted: ${tailWords} words > budget ${meta.budget}`);
        return origLine;
      }

      return tailLine;
    });

    // Fix #3: reconstruct full text with original empty lines preserved
    let contentIdx = 0;
    const finalLines = origLines.map((origLine, i) => {
      if (lineMetadata[i].isEmpty) return origLine; // preserve blank lines
      return correctedContent[contentIdx++] ?? origLine;
    });

    const tailoredText = finalLines.join("\n");
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;

    // Fix #6: accurate before/after score
    if (analysis?.matchScore != null) {
      const missing = analysis.missingKeywords || [];
      const matched = analysis.matchedKeywords || [];
      const totalJdKeywords = matched.length + missing.length;

      if (totalJdKeywords > 0) {
        // Count how many missing keywords now appear in tailored text
        const nowPresent = missing.filter(kw =>
          tailoredText.toLowerCase().includes(kw.toLowerCase())
        ).length;

        // Recalculate score: (original matched + newly present) / total
        const originalMatched = matched.length;
        const newTotal = originalMatched + nowPresent;
        const afterScore = Math.min(100, Math.round((newTotal / totalJdKeywords) * 100));

        analysis.beforeScore = analysis.matchScore;
        analysis.matchScore = afterScore;
      }
    }

    return res.status(200).json({
      tailoredText,
      analysis,
      stats: {
        originalLines: origLines.length,
        tailoredLines: finalLines.length,
        originalWords: originalWordCount,
        tailoredWords: tailoredWordCount,
        wordDrift: tailoredWordCount - originalWordCount,
      }
    });
  } catch (err) {
    console.error("Tailor error:", err);
    return res.status(500).json({ error: err.message });
  }
}