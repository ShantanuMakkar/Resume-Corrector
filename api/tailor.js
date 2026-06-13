import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "10mb" } },
};

// Model cascade — tries each in order on quota/timeout/error
const MODEL_CASCADE = [
  { model: "gemini-2.5-flash", useThinking: true },
  { model: "gemini-2.5-flash-lite", useThinking: false },
  { model: "gemini-2.5-pro", useThinking: false },
  { model: "gemini-3.1-flash-lite", useThinking: false },
  { model: "gemini-3.5-flash", useThinking: false },
];

function shouldTryNext(err) {
  const msg = (err?.message || err?.toString() || "").toLowerCase();
  return msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") ||
    msg.includes("rate limit") || msg.includes("timeout") || msg.includes("deadline") ||
    msg.includes("503") || msg.includes("unavailable") || msg.includes("thinking") ||
    msg.includes("thinkingconfig") || msg.includes("unsupported") || msg.includes("not found") ||
    msg.includes("404") || (msg.includes("invalid") && msg.includes("config"));
}

async function generateWithFallback(primaryConfig, _unused, ...args) {
  let lastErr;
  for (const { model, useThinking } of MODEL_CASCADE) {
    try {
      const config = { model };
      if (useThinking) config.generationConfig = { thinkingConfig: { thinkingBudget: 0 } };
      if (primaryConfig.systemInstruction) config.systemInstruction = primaryConfig.systemInstruction;
      console.log(`[cascade] Trying ${model}...`);
      const result = await client.getGenerativeModel(config).generateContent(...args);
      console.log(`[cascade] Success with ${model}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (shouldTryNext(err)) { console.log(`[cascade] ${model} failed, trying next...`); continue; }
      throw err;
    }
  }
  throw lastErr;
}

// Fix #1: Extract only the technical/relevant parts of a JD
// Strip boilerplate: benefits, culture, EEO statements, salary, about company
function extractJDEssentials(jd) {
  const lines = jd.split("\n").map(l => l.trim()).filter(Boolean);

  // Section headers that signal useful content
  const usefulHeaders = /requirements?|qualifications?|responsibilities|skills|experience|what you.ll|what we.re|technical|must have|nice to have|you will|you.ll|duties|expectations|role|position|about the role/i;

  // Lines/sections to skip
  const skipPatterns = /benefits|perks|salary|compensation|equity|bonus|vacation|pto|health insurance|dental|vision|401k|remote|hybrid|office|culture|diversity|inclusion|equal opportunity|eoe|eeo|background check|drug test|we offer|we provide|about us|about the company|who we are|our mission|our values|join us|why work|great place|flexible/i;

  // Strategy: find the first useful section header and take from there
  // Skip "About Us" / company intro sections before the first useful header
  let inUsefulSection = false;
  let foundFirstUsefulHeader = false;
  const usefulLines = [];

  for (const line of lines) {
    if (usefulHeaders.test(line)) {
      inUsefulSection = true;
      foundFirstUsefulHeader = true;
    }
    if (skipPatterns.test(line) && line.length < 60) {
      inUsefulSection = false;
      continue;
    }
    // Always skip clearly irrelevant lines
    if (/^\$|salary range|compensation range|\bpto\b|paid time off|medical dental vision/i.test(line)) continue;
    // Skip company intro lines before first useful section
    if (!foundFirstUsefulHeader && /^about|^who we|^our mission|^we are|^we.re/i.test(line)) continue;
    if (inUsefulSection) usefulLines.push(line);
  }

  // If nothing was filtered, return original (small JD or already clean)
  const result = usefulLines.join("\n");
  return result.length > 200 ? result : jd;
}

// Fix #3: Strip headers/footers and page numbers from resume text
function cleanResumeText(text) {
  const lines = text.split("\n");
  const cleaned = lines.filter(line => {
    const t = line.trim();
    if (!t) return true; // keep blank lines for structure
    // Skip page number patterns: "1 of 2", "Page 1", "1", "2" alone
    if (/^\d+\s+of\s+\d+$/i.test(t)) return false;
    if (/^page\s+\d+/i.test(t)) return false;
    if (/^\d+$/.test(t) && t.length <= 2) return false;
    // Skip common header/footer patterns
    if (/^confidential$/i.test(t)) return false;
    if (/^curriculum vitae$/i.test(t)) return false;
    return true;
  });
  return cleaned.join("\n");
}

function buildLineMetadata(lines) {
  return lines.map((line) => {
    const trimmed = line.trim();
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    const isEmpty = words === 0;
    const isBullet = trimmed.startsWith("●") || trimmed.startsWith("•") || trimmed.startsWith("–") || trimmed.startsWith("-") || trimmed.startsWith("• ");
    const isSkills = trimmed.includes("|") && words > 12;
    const isTechStack = trimmed.toLowerCase().startsWith("technologies used");
    const isSummary = !isBullet && !isSkills && !isTechStack && words >= 3 && words <= 15;
    // Skills: allow net-zero swaps (same word count) — model can replace low-priority with JD keywords
    // Use original word count as budget (no increase) but explicitly allow swaps in prompt
    const budget = isEmpty ? 0 : isSkills ? words + 2 : (isBullet || isTechStack) ? words + 3 : words + 1;
    return { words, budget, isEmpty, isBullet, isSkills, isTechStack, isSummary };
  });
}

// Fix #1: strip numbered line prefixes the AI occasionally echoes back
function stripLinePrefix(line) {
  return line
    .replace(/^(Line\s+)?\d+[\.\):\-]\s+/i, "")
    .replace(/^\[line\s*\d+\]\s*/i, "")
    .trim();
}

function similarityScore(a, b) {
  if (!a || !b) return 0;
  const aW = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bW = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!aW.size || !bW.length) return 0;
  return (2 * bW.filter(w => aW.has(w)).length) / (aW.size + bW.length);
}

function skillsRankingLost(orig, tailored) {
  const rp = /\(\d+\)/g;
  const origR = (orig.match(rp) || []).length, tailR = (tailored.match(rp) || []).length;
  return origR > 3 && tailR < origR / 2;
}

function keywordScore(text, matchedKeywords, missingKeywords) {
  const all = [...matchedKeywords, ...missingKeywords];
  if (!all.length) return 0;
  const present = all.filter(kw => text.toLowerCase().includes(kw.toLowerCase())).length;
  return Math.round((present / all.length) * 100);
}

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

// Fix #7: sanitise text before XML injection
function sanitiseForXml(text) {
  // Remove null bytes and control characters that would corrupt XML
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\uFFFE\uFFFF]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Fix #5: overall timeout guard
  const timeoutMs = 52000; // 52s — leave 8s buffer before Vercel's 60s limit
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
  );

  try {
    const { resumeText: rawResumeText, jd: rawJd } = req.body;
    if (!rawResumeText || !rawJd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    // Fix #3: clean resume text
    const resumeText = sanitiseForXml(cleanResumeText(rawResumeText));

    // Fix #1: extract JD essentials only
    const jd = sanitiseForXml(extractJDEssentials(rawJd));

    console.log(`[tailor] Resume: ${resumeText.split("\n").length} lines, JD: ${rawJd.length} → ${jd.length} chars after extraction`);

    const origLines = resumeText.split("\n");
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;
    const lineMetadata = buildLineMetadata(origLines);
    const sectionMap = buildSectionMap(origLines);

    const contentLines = origLines
      .map((line, i) => ({ line, idx: i, meta: lineMetadata[i], section: sectionMap[i] }))
      .filter(({ meta }) => !meta.isEmpty);

    const contentText = contentLines.map(({ line }) => line).join("\n");
    const contentLineCount = contentLines.length;

    // Fix #6: only include candidate lines in budget prompt (not section headers, names, dates)
    // Exclude first 5 content lines (name + summary) from candidates — never modify these
    const candidateLines = contentLines.filter(({ meta, section }, idx) =>
      idx >= 5 && (meta.isBullet || meta.isSkills || meta.isTechStack)
    );

    // Fix #6: summary check
    const summaryText = contentLines.slice(0, 4).map(l => l.line).join(" ");
    const summaryAlreadyGood = similarityScore(summaryText, jd.slice(0, 500)) > 0.25;

    // Pre-compute missing keywords from JD vs resume for use in prompt
    const NON_TECH_JD_WORDS = new Set(["Automations","Responsibilities","Deployments","Provide","Architect","Services","Engineers","Infrastructure","Requirements","Qualifications","Please","Have","Must","Will","This","With","From","Your","Their","More","Other","Both","Also","Such","Each","These","Those"]);

    const jdTerms = [...new Set(
      (jd.match(/\b[A-Z][a-zA-Z0-9]*(?:\/[A-Z][a-zA-Z0-9]*)?\b/g) || [])
        .filter(t => t.length > 2 && !["The","This","We","Our","You","For","With","And","But","Has","Are","Not","All","Any","Can","May","Will"].includes(t))
    )];
    const promptMissingKws = jdTerms.filter(t => !resumeText.toLowerCase().includes(t.toLowerCase()) && !NON_TECH_JD_WORDS.has(t)).slice(0, 15);

    const systemPrompt = `You are an ATS resume keyword injector. Inject missing JD keywords into bullets and tech stack lines ONLY.

MISSING JD KEYWORDS TO INJECT:
${promptMissingKws.length > 0 ? promptMissingKws.join(", ") : "Extract missing technical keywords from the JD"}

═══ STRICT RULES (violations will be reverted server-side) ═══

NEVER TOUCH — return these EXACTLY as given:
• Name, contact info, email, phone, location
• Summary lines (first 3-4 lines): these are identity lines — do NOT swap keywords in them
• Job titles, company names, dates
• Education, certifications, language, hobbies
• Award bullets ("Got the ... Award")

INJECT INTO — bullets and tech stack lines ONLY:

BULLETS (+3 word budget each):
- Add keywords INLINE using slashes or commas: "SQS/MSK" or "ELK, Splunk, and Opensearch"
- NEVER use parentheses: not "(MSK)", not "(Opensearch)"
- NEVER remove: tools, metrics (%), numbers, outcomes, company-specific context
- Remove ONLY exact filler: the word "ingestion" after SQS, the word "scripting" after Bash/Python
- If no filler exists: append at end of tech list — "...using Terraform, CloudFormation, and CodePipeline"
- Keep ALL existing tools — only ADD, never replace existing tool names in bullets

SKILLS LINE (swap max 2 skills):
- ONLY replace skills with score (1) if they don't appear in any bullet
- Never remove tools that appear elsewhere: ELK, Splunk, Vault, OPA, Karpenter, PagerDuty, etc.
- Add: MWAA, ElastiCache, Opensearch, MSK, DynamoDB — only if genuinely in JD

TECHNOLOGIES USED lines (+3 words):
- Append missing JD tools used in that project: "| CodeCommit | CodeBuild" etc.

HARD COUNTS:
- Output EXACTLY ${contentLineCount} lines
- No line numbers or labels
- Keep (N) rankings in skills line

LINES TO MODIFY:
${candidateLines.map(({ line, meta }) => {
  const t = line.trim();
  const tag = meta.isBullet ? "[bullet]" : meta.isSkills ? "[skills]" : meta.isTechStack ? "[tech]" : "[SKIP-summary]";
  return `${tag}: ${t.slice(0, 65)}${t.length > 65 ? "…" : ""}`;
}).join("\n")}

OUTPUT: ${contentLineCount} lines. Plain text only.`;

    const userPrompt = `JOB DESCRIPTION (technical requirements extracted):
${jd}

RESUME (${contentLineCount} lines — return exactly this count):
${contentText}

Inject missing keywords. Keep ranking numbers. Touch every relevant bullet.`;

    const analysisPrompt = `Analyze this resume against the job description.
Return ONLY valid JSON — no markdown, no code fences.

{
  "matchedKeywords": [<up to 12 JD keywords in resume>],
  "missingKeywords": [<up to 10 JD keywords absent, most critical first>],
  "missingContext": "<one sentence: most critical gap>",
  "titleAlignment": "<one sentence: how well title/seniority matches>",
  "recommendation": "<1-2 sentences: honest fit + strongest talking point>"
}

Resume:
${resumeText}

Job Description:
${jd}`;

    // Primary model config — thinking disabled for speed
    const primaryModelConfig = {
      model: "gemini-2.5-flash",
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
      systemInstruction: systemPrompt,
    };
    const primaryAnalysisConfig = {
      model: "gemini-2.5-flash",
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    };
    const FALLBACK_MODEL = "gemini-2.5-flash-lite";

    const [tailorResponse, analysisResponse] = await Promise.race([
      Promise.all([
        generateWithFallback(primaryModelConfig, FALLBACK_MODEL, userPrompt),
        generateWithFallback(primaryAnalysisConfig, FALLBACK_MODEL, analysisPrompt),
      ]),
      timeoutPromise,
    ]);

    let tailoredContentText = tailorResponse.response.text().trim();
    const tailoredContentLines = tailoredContentText.split("\n").map(stripLinePrefix);

    let analysis = null;
    try {
      let raw = analysisResponse.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(raw);
    } catch (e) {
      console.warn("Analysis parse failed:", e.message);
    }

    // Fix #8: consistent scoring
    const matchedKws = analysis?.matchedKeywords || [];
    // Deduplicate: remove from missing anything already in matched
    const missingKws = (analysis?.missingKeywords || []).filter(k =>
      !matchedKws.some(m => m.toLowerCase() === k.toLowerCase())
    );
    const beforeScore = keywordScore(resumeText, matchedKws, missingKws);

    // Enforce per-line budgets — also enforce minimum (no truncation)
    const correctedContent = contentLines.map(({ line: origLine, meta }, i) => {
      const tailLine = tailoredContentLines[i] ?? origLine;
      if (!tailLine.trim()) return origLine;
      if (meta.isSkills && skillsRankingLost(origLine, tailLine)) return origLine;
      const tailWords = tailLine.trim().split(/\s+/).filter(Boolean).length;
      // Revert if too long
      if (tailWords > meta.budget) {
        console.log(`[enforce] Line ${i+1} too long: ${tailWords}w > ${meta.budget}w budget`);
        return origLine;
      }
      // Revert if too short (truncation) — must keep at least 85% of original words
      const minWords = Math.floor(meta.words * 0.92);
      if (tailWords < minWords && meta.words > 5) {
        console.log(`[enforce] Line ${i+1} truncated: ${tailWords}w < min ${minWords}w`);
        return origLine;
      }
      return tailLine;
    });

    // Reconstruct with empty lines
    let contentIdx = 0;
    const finalLines = origLines.map((origLine, i) => {
      if (lineMetadata[i].isEmpty) return origLine;
      return correctedContent[contentIdx++] ?? origLine;
    });

    const tailoredText = finalLines.join("\n");
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;
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
    console.error("Tailor error:", err.message);

    // Fix #5: meaningful timeout error
    if (err.message === "TIMEOUT") {
      return res.status(504).json({
        error: "Request timed out — try with a shorter job description, or paste only the requirements section."
      });
    }

    return res.status(500).json({ error: err.message });
  }
}