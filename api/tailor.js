import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "10mb" } },
};

function buildLineMetadata(lines) {
  return lines.map((line) => {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const isEmpty = words === 0;
    const isBullet = trimmed.startsWith("●") || trimmed.startsWith("•") || trimmed.startsWith("–") || trimmed.startsWith("-");
    const isSkills = trimmed.includes("|") && words > 12;
    const isTechStack = trimmed.toLowerCase().startsWith("technologies used");
    const budget = isEmpty ? 0 : isSkills ? words + 5 : (isBullet || isTechStack) ? words + 3 : words + 1;
    return { words, budget, isEmpty, isBullet, isSkills, isTechStack };
  });
}

// Fix #1: strip numbered line prefixes the AI occasionally echoes back
function stripLinePrefix(line) {
  // Remove "1. ", "Line 1: ", "1) " etc from start of line
  return line
    .replace(/^(Line\s+)?\d+[\.\):\-]\s+/i, "")
    .replace(/^\[line\s*\d+\]\s*/i, "")
    .trim();
}

// Fix #6: check if summary already matches JD well enough to skip
function similarityScore(a, b) {
  if (!a || !b) return 0;
  const aW = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bW = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!aW.size || !bW.length) return 0;
  return (2 * bW.filter(w => aW.has(w)).length) / (aW.size + bW.length);
}

// Fix #5: detect if skills line lost its ranking numbers
function skillsRankingLost(orig, tailored) {
  const rankPattern = /\(\d+\)/g;
  const origRanks = (orig.match(rankPattern) || []).length;
  const tailRanks = (tailored.match(rankPattern) || []).length;
  // If original had rankings and tailored lost more than half, revert
  return origRanks > 3 && tailRanks < origRanks / 2;
}

// Fix #9: extract keywords already injected to avoid duplicates
function extractInjectedKeywords(tailoredLines, origLines) {
  const injected = new Set();
  tailoredLines.forEach((tail, i) => {
    const orig = origLines[i] || "";
    if (tail === orig) return;
    const origWords = new Set(orig.toLowerCase().split(/\s+/).filter(Boolean));
    tail.toLowerCase().split(/\s+/).filter(Boolean).forEach(w => {
      if (!origWords.has(w) && w.length > 3) injected.add(w);
    });
  });
  return injected;
}

// Fix #8: keyword-counting based score for both before and after
function keywordScore(text, matchedKeywords, missingKeywords) {
  const all = [...matchedKeywords, ...missingKeywords];
  if (!all.length) return 0;
  const present = all.filter(kw => text.toLowerCase().includes(kw.toLowerCase())).length;
  return Math.round((present / all.length) * 100);
}

// Fix #10: detect which section a line belongs to
function buildSectionMap(lines) {
  const sectionHeaders = ["TECHNICAL SKILLS", "WORK EXPERIENCE", "EDUCATION", "ACHIEVEMENTS", "CERTIFICATIONS", "LANGUAGE", "HOBBIES", "SUMMARY", "PROFILE"];
  let currentSection = "HEADER";
  return lines.map(line => {
    const upper = line.trim().toUpperCase();
    for (const h of sectionHeaders) {
      if (upper.includes(h)) { currentSection = h; break; }
    }
    return currentSection;
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, jd } = req.body;
    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    const origLines = resumeText.split("\n");
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;
    const lineMetadata = buildLineMetadata(origLines);

    // Fix #10: build section map
    const sectionMap = buildSectionMap(origLines);

    // Fix #3: separate content from empty lines
    const contentLines = origLines
      .map((line, i) => ({ line, idx: i, meta: lineMetadata[i], section: sectionMap[i] }))
      .filter(({ meta }) => !meta.isEmpty);

    const contentText = contentLines.map(({ line }) => line).join("\n");
    const contentLineCount = contentLines.length;

    // Fix #6: compute summary similarity to JD upfront
    const summaryLines = contentLines.slice(0, 4); // first 4 non-empty lines
    const summaryText = summaryLines.map(l => l.line).join(" ");
    const jdWords = jd.toLowerCase().split(/\s+/).filter(Boolean);
    const summaryJdSim = similarityScore(summaryText, jd.slice(0, 500));
    const summaryAlreadyGood = summaryJdSim > 0.25; // if >25% overlap, summary is already decent

    const systemPrompt = `You are an ATS optimization specialist. Inject missing JD keywords into the resume to maximize keyword coverage.

STEP 1 — IDENTIFY MISSING KEYWORDS:
Extract every technical skill, tool, methodology, cloud service, and domain term from the JD.
Find which are ABSENT from the resume. These are your injection targets.

STEP 2 — INJECT INTO THESE TARGETS (in order):

TARGET 1 — SKILLS LINE (highest priority):
- Keep ALL existing ranking numbers like "(9)", "(8)" — do not remove them
- Reorder to lead with JD-critical terms but preserve the (number) format
- Add missing JD keywords that genuinely belong here
- Budget: +5 words

TARGET 2 — BULLET POINTS in WORK EXPERIENCE section:
- Inject per-bullet: identify what JD keyword this work clearly involved but didn't name
- Remove filler words to make room: "successfully", "utilizing", "leveraging", "in a timely manner"
- Budget: +3 words per bullet
- Inject into EVERY relevant bullet — do not skip any

TARGET 3 — TECHNOLOGIES USED lines:
- Add missing JD tools that were genuinely used in this project
- Reorder to lead with JD-mentioned tools
- Budget: +3 words

${summaryAlreadyGood ? "TARGET 4 — SUMMARY: Already matches JD reasonably well. Only change if JD role title is significantly different from current title." : `TARGET 4 — SUMMARY (first 2-3 lines after name):
- Mirror JD's exact role title
- Add top 3 JD skills not already mentioned
- Budget: +1 word`}

INJECTION PATTERN (follow exactly):
Before: "Built production Alerts App on AWS with Lambda/API Gateway/SQS ingestion, boosting throughput by 40%."
After:  "Built production Alerts App on AWS (Lambda, SQS, SNS, EventBridge), boosting throughput by 40%."
Change: removed "ingestion" (+0), added "SNS, EventBridge" — net neutral

Before: "Automated Terraform deployments and Dockerized apps with Python/Bash scripting, reducing ops by 50%."
After:  "Automated Terraform/GitOps deployments and containerized apps with Python/Bash, reducing ops by 50%."
Change: removed "scripting" (+0), added "GitOps" — net neutral

HARD RULES:
- Output EXACTLY ${contentLineCount} lines
- DO NOT prefix lines with numbers, labels, or "Line X:" — output ONLY the resume text
- Keep ranking numbers like "(9)", "(8)" in skills lines — do not remove them
- Each line word count must stay within budget
- NEVER change: name, contact info, company names, job titles, dates, education, certifications
- NEVER fabricate skills not in resume
- Do NOT change punctuation or grammar unless injecting a keyword
- Return UNCHANGED lines that have no relevant keyword gap

PER-LINE BUDGETS:
${contentLines.map(({ line, meta }, i) => {
  const trimmed = line.trim();
  const tag = meta.isBullet ? "[bullet]" : meta.isSkills ? "[skills]" : meta.isTechStack ? "[tech]" : "";
  return `${i+1}${tag}: max ${meta.budget}w (now ${meta.words}w) — ${trimmed.slice(0, 55)}${trimmed.length > 55 ? "…" : ""}`;
}).join("\n")}

OUTPUT: Plain resume text only. ${contentLineCount} lines. No numbering, no labels, no commentary.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${contentLineCount} lines — return exactly this many lines, no numbering):
${contentText}

Inject missing keywords. Keep ranking numbers. Every relevant bullet must get at least one keyword injection.`;

    const analysisPrompt = `Analyze this resume against the job description.
Return ONLY valid JSON — no markdown, no code fences, no explanation.

{
  "matchedKeywords": [<up to 12 JD keywords present in resume>],
  "missingKeywords": [<up to 10 JD keywords absent from resume, most critical first>],
  "missingContext": "<one sentence: single most critical gap>",
  "titleAlignment": "<one sentence: how well candidate title/seniority matches JD>",
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

    // Fix #1: strip any line numbering the AI echoed back
    const tailoredContentLines = tailoredContentText
      .split("\n")
      .map(stripLinePrefix);

    // Parse analysis
    let analysis = null;
    try {
      let raw = analysisResponse.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(raw);
    } catch (e) {
      console.warn("Analysis parse failed:", e.message);
    }

    // Fix #8: compute consistent keyword-based scores
    const matchedKws = analysis?.matchedKeywords || [];
    const missingKws = analysis?.missingKeywords || [];
    const beforeScore = keywordScore(resumeText, matchedKws, missingKws);

    // Server-side enforcement per content line
    const correctedContent = contentLines.map(({ line: origLine, meta }, i) => {
      const tailLine = tailoredContentLines[i] ?? origLine;
      if (!tailLine.trim()) return origLine;

      const tailWords = tailLine.trim().split(/\s+/).filter(Boolean).length;

      // Fix #5: revert skills line if ranking numbers were lost
      if (meta.isSkills && skillsRankingLost(origLine, tailLine)) {
        console.log(`Skills line reverted: ranking numbers lost`);
        return origLine;
      }

      // Word budget enforcement
      if (tailWords > meta.budget) {
        console.log(`Line ${i+1} reverted: ${tailWords}w > budget ${meta.budget}w`);
        return origLine;
      }

      return tailLine;
    });

    // Fix #9: check for keyword duplication across injected lines
    const injectedKws = extractInjectedKeywords(
      correctedContent.map(l => l),
      contentLines.map(({ line }) => line)
    );
    console.log(`[tailor] Injected keywords: ${[...injectedKws].join(", ")}`);

    // Fix #3: reconstruct full text with empty lines preserved
    let contentIdx = 0;
    const finalLines = origLines.map((origLine, i) => {
      if (lineMetadata[i].isEmpty) return origLine;
      return correctedContent[contentIdx++] ?? origLine;
    });

    const tailoredText = finalLines.join("\n");
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;

    // Fix #8: consistent keyword-based afterScore
    const afterScore = keywordScore(tailoredText, matchedKws, missingKws);

    if (analysis) {
      analysis.beforeScore = beforeScore;
      analysis.matchScore = afterScore;
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