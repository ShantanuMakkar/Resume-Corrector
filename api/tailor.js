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

// Single source of truth for JD technical term extraction.
// Used for: prompt injection targets, before/after scoring, and the missing-keywords display.
// Having ONE extraction function (instead of duplicated logic in multiple places)
// guarantees the score, the injection targets, and the displayed "still missing" list
// are always derived from the same keyword set.
const NON_TECH_JD_WORDS = new Set([
  "Automations","Responsibilities","Deployments","Provide","Architect","Services",
  "Engineers","Infrastructure","Requirements","Qualifications","Please","Have","Must",
  "Will","This","With","From","Your","Their","More","Other","Both","Also","Such",
  "Each","These","Those","Main","Work","Tech","Stack","Cloud","Security","Than",
  "Years","Good","Should","About","Above","Some","Only","Just","Very","Most","Well",
  "Even","Many","Much","Still","High","Best","Fast","Easy","Full","Free","Open","Next",
  "Last","Team","Role","Time","Type","Data","Code","Test","User","File","Tool","Area",
  "Page","List","Item","Base","Core","Mode","Path","Port","Task","Step","Flow","Call",
  "Real","Live","Side","Back","Part","Used","Need","Help","Make","Give","Keep","Take",
  "Know","Show","Find","Turn","Move","Come","Want","Like","Look","Into","Over","Then",
  "When","Here","There","Where","Been","They","Were","What","Which","While","After",
  "Before","Since","Until","During","Within","Between","Against","Through","Around",
  "Below","Under","Along","Across","Behind","Beyond","Inside","Outside","Secret",
  "Manager","Based","Regional","Failure","Tolerance","Industry","Standards","Compliance",
  "Payment","Large","Scale","Distributed","Preferred","Bachelor","Degree","Related",
  "Field","Optional","Required","Nice","Bilingual","English","Japanese","Published",
  "Relevant","Verifiable","Proficiency","Either","Language","Excellent","Written",
  "Verbal","Interpersonal","Demonstrated","Ability","Understanding","Building","Design",
  "Manage","Ensure","Enable","Support","Delivery","Extensive","Technical","Requirement",
  "Card","Platform","Platforms","Engineer","Engineering","Company","Product","Solution",
  "Solutions","Business","Customer","Customers","Users","Application","Applications",
  "System","Systems","Project","Projects","Department","Division","Group","Market",
  "Global","Consultant","Finance","Perform","Implement","Automate","Strong","Familiarity",
  "Familiar","Knowledge","Hands","Solid","Proven","Routine","Amazon","We","You","Our",
  "Their","His","Her","Its"
]);

function extractJdTechTerms(jd) {
  // Frequency check: words appearing 3+ times are likely the company/role name, not a tool
  const wordFrequency = {};
  (jd.match(/\b[A-Z][a-zA-Z0-9]*\b/g) || []).forEach(w => {
    wordFrequency[w] = (wordFrequency[w] || 0) + 1;
  });

  const isLikelyTechTerm = (t) => {
    if (/^[A-Z0-9]{2,8}$/.test(t)) return true; // acronyms always pass (EC2, KMS, VPC)
    if ((wordFrequency[t] || 0) >= 3) return false; // frequent word = company/role name
    if (/[0-9]/.test(t)) return true; // contains digit (S3, EC2)
    if (/[A-Z].*[A-Z]/.test(t) && t.length > 4) return true; // CamelCase (CloudFormation)
    return !NON_TECH_JD_WORDS.has(t);
  };

  return [...new Set(
    (jd.match(/\b[A-Z][a-zA-Z0-9]*(?:\/[A-Z][a-zA-Z0-9]*)?\b/g) || [])
      .filter(t => {
        if (t.length < 3 && !/^[A-Z0-9]{2,8}$/.test(t)) return false;
        return !NON_TECH_JD_WORDS.has(t) && isLikelyTechTerm(t);
      })
  )];
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

    // Single canonical JD tech term extraction — reused for prompt injection targets,
    // before/after scoring, and the missing-keywords display further below.
    const jdTechTerms = extractJdTechTerms(jd);
    const promptMissingKws = jdTechTerms
      .filter(t => !resumeText.toLowerCase().includes(t.toLowerCase()))
      .slice(0, 15);

    const systemPrompt = `You are an ATS resume keyword injector. Inject missing JD keywords into bullets and tech stack lines ONLY.

MISSING JD KEYWORDS TO INJECT:
${promptMissingKws.length > 0 ? promptMissingKws.join(", ") : "Extract missing technical keywords from the JD"}

ONLY inject from the list above. Do NOT invent your own keywords from reading the JD text.
NEVER inject: company names, product names, team names, or generic words like "Platform", "Card", "Service", "Cloud" on their own — these are not technologies.
A valid injection is a specific tool, language, cloud service, or protocol (e.g. "Terraform", "EC2", "OAuth2") — never a business or brand term.

═══ STRICT RULES (violations will be reverted server-side) ═══

NEVER TOUCH — return these EXACTLY as given:
• Name, contact info, email, phone, location
• Summary lines (first 3-4 lines): these are identity lines — do NOT swap keywords in them
• Job titles, company names, dates
• Education, certifications, language, hobbies
• Award bullets ("Got the ... Award")

INJECT INTO — bullets and tech stack lines ONLY:

BULLETS (+3 word budget each):
- Add keywords INLINE using slashes or commas: "Lambda/Tool1/Tool2" or "ELK, Splunk, and NewTool"
- NEVER use parentheses: not "(Tool)" — always inline
- Preserve correct punctuation: if inserting before a comma-separated clause, keep the comma (e.g. "SQS, EC2, SNS, boosting throughput" not "SQS, EC2, SNS boosting throughput")
- GRAMMAR: always keep a comma between the injected list and what follows (e.g. "SQS, EC2, SNS, boosting throughput" — NOT "SQS, EC2, SNS boosting throughput")
- NEVER remove: tools, metrics (%), numbers, outcomes, company-specific context
- Remove ONLY exact filler: the word "ingestion" after SQS, the word "scripting" after Bash/Python
- If no filler exists: append at end of tech list — "...using Terraform, CloudFormation, and CodePipeline"
- Keep ALL existing tools — only ADD, never replace existing tool names in bullets

SKILLS LINE (swap max 2 skills):
- ONLY replace skills with score (1) if they don't appear in any bullet AND don't appear in any tech stack line
- Never remove tools that appear elsewhere in the resume (in bullets, tech stacks, or certifications)
- Never change tool names or capitalization (keep "Argo CD" as "Argo CD", not "ArgoCD")
- Add: whichever missing JD keywords fit naturally in the skills line

TECHNOLOGIES USED lines (+3 words):
- Look at the missing keywords list above and append any that genuinely apply to that project
- Match the missing keyword to the project: if a CI/CD tool is missing, add it to CI/CD tech stacks
- If a database/storage tool is missing, add it to the project that involved databases
- Format: append as "| ToolName" to match existing style

HARD COUNTS:
- Output EXACTLY ${contentLineCount} lines
- No line numbers or labels
- Keep (N) rankings in skills line
- CRITICAL: Output lines in the EXACT SAME ORDER as the input. Do not reorder, swap, or shuffle lines.
  Each output line N must be a modified (or unmodified) version of input line N — never a different line's content.

LINES TO MODIFY (line number : current content):
${candidateLines.map(({ line, meta, idx }) => {
  const t = line.trim();
  const tag = meta.isBullet ? "[bullet]" : meta.isSkills ? "[skills]" : meta.isTechStack ? "[tech]" : "[SKIP-summary]";
  return `Line ${idx + 1} ${tag}: ${t.slice(0, 65)}${t.length > 65 ? "…" : ""}`;
}).join("\n")}

OUTPUT: ${contentLineCount} lines, same order as input. Plain text only.`;

    const userPrompt = `JOB DESCRIPTION (technical requirements extracted):
${jd}

RESUME (${contentLineCount} lines — return exactly this count):
${contentText}

Inject missing keywords. Keep ranking numbers. Touch every relevant bullet.`;

    const analysisPrompt = `Analyze this resume against the job description.
Return ONLY valid JSON — no markdown, no code fences.

RULES:
- matchedKeywords and missingKeywords must be MUTUALLY EXCLUSIVE — a keyword cannot appear in both
- Only include TECHNICAL TOOLS and CLOUD SERVICES — not certifications (CKA/CKAD), not languages (Japanese), not compliance phrases, not optional skills (Go/Rust, CDK)
- missingKeywords: only list tools that are genuinely absent AND injectable into the resume

{
  "matchedKeywords": [<up to 12 JD technical tools/services present in resume>],
  "missingKeywords": [<up to 10 JD critical technical tools/services NOT in resume, most impactful first>],
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

    // Reuse the single canonical term list computed earlier — guarantees the score,
    // the injection prompt, and the missing-keywords display never disagree.
    const beforeScore = keywordScore(resumeText, jdTechTerms, []);

    // Deterministic matched/missing — derived from jdTechTerms, NOT from Gemini's analysis.
    // Gemini's keyword lists vary run-to-run on the same JD; this does not.
    // Gemini's analysis is still used for qualitative text (recommendation, titleAlignment, missingContext).
    const matchedKws = jdTechTerms.filter(t => resumeText.toLowerCase().includes(t.toLowerCase()));
    const missingKws = jdTechTerms.filter(t => !resumeText.toLowerCase().includes(t.toLowerCase()));

    // Enforce per-line budgets — also enforce minimum (no truncation)
    const correctedContent = contentLines.map(({ line: origLine, meta }, i) => {
      const tailLine = tailoredContentLines[i] ?? origLine;
      if (!tailLine.trim()) return origLine;

      // -1. Revert if a forbidden business/brand word was injected as a fake keyword
      // Reject if a generic JD "soft language" word leaked in as a fake keyword
      // These are adjectives/qualifiers from JD prose (e.g. "Strong understanding...",
      // "Familiarity with...", "Demonstrated experience...") — never real skills
      const SOFT_LANGUAGE_WORDS = ["strong", "good", "excellent", "demonstrated", "proactive",
        "successful", "effective", "advantageous", "crucial", "highly", "familiarity",
        "familiar", "knowledge", "understanding", "experience", "skills", "ability",
        "expertise", "exposure", "hands-on", "extensive", "solid", "proven"];
      if (meta.isBullet || meta.isSkills || meta.isTechStack) {
        const origLowerCheck = origLine.toLowerCase();
        const tailLowerCheck = tailLine.toLowerCase();
        const leakedWord = SOFT_LANGUAGE_WORDS.find(w => {
          const re = new RegExp(`\\b${w}\\b`, "i");
          return re.test(tailLowerCheck) && !re.test(origLowerCheck);
        });
        if (leakedWord) {
          console.log(`[enforce] Line ${i+1} reverted: soft-language JD word "${leakedWord}" leaked as fake keyword`);
          return origLine;
        }
      }

      const FORBIDDEN_INJECTIONS = ["paypay", "card", "platform", "platforms", "service", "services", "company", "team", "product", "solution", "solutions", "business"];

      // Also reject if 2+ consecutive generic/section-header words were injected together
      // (e.g. "Linux, Windows, administration, maintenance" — dumped JD header words, not real skills)
      if (meta.isBullet) {
        const SECTION_HEADER_WORDS = ["administration", "maintenance", "implementation", "monitoring", "automation"];
        const origWords = new Set(origLine.toLowerCase().split(/\W+/).filter(Boolean));
        const tailWordsArr = tailLine.toLowerCase().split(/\W+/).filter(Boolean);
        const newSectionWords = tailWordsArr.filter(w => SECTION_HEADER_WORDS.includes(w) && !origWords.has(w));
        if (newSectionWords.length >= 2) {
          console.log(`[enforce] Line ${i+1} reverted: dumped JD section-header words (${newSectionWords.join(", ")})`);
          return origLine;
        }
      }
      if (meta.isBullet || meta.isSkills || meta.isTechStack) {
        const origLower = origLine.toLowerCase();
        const tailLower = tailLine.toLowerCase();
        const newlyAddedForbidden = FORBIDDEN_INJECTIONS.some(w => {
          const re = new RegExp(`\\b${w}\\b`, "i");
          return re.test(tailLower) && !re.test(origLower);
        });
        if (newlyAddedForbidden) {
          console.log(`[enforce] Line ${i+1} reverted: forbidden business word injected`);
          return origLine;
        }
      }

      // 0. CRITICAL: revert if line was swapped with a completely different line
      // (similarity too low means content was replaced, not edited)
      if (meta.isBullet || meta.isSkills || meta.isTechStack) {
        const origWordSet = new Set(origLine.toLowerCase().split(/\s+/).filter(Boolean));
        const tailWords = tailLine.toLowerCase().split(/\s+/).filter(Boolean);
        const overlap = tailWords.filter(w => origWordSet.has(w)).length;
        const overlapRatio = overlap / Math.max(origWordSet.size, 1);
        if (overlapRatio < 0.4 && origWordSet.size > 5) {
          console.log(`[enforce] Line ${i+1} reverted: low overlap (${(overlapRatio*100).toFixed(0)}%) — likely swapped with different line`);
          return origLine;
        }
      }

      // 1.5. Revert if a filler word survived alongside an injected keyword (grammatically broken)
      // e.g. "SQS, EC2, Cloudfront, MWAA ingestion" — "ingestion" should have been removed, not left dangling
      if (meta.isBullet) {
        const FILLER_WORDS = ["ingestion", "scripting"];
        for (const filler of FILLER_WORDS) {
          const origHasFiller = new RegExp(`\\b${filler}\\b`, "i").test(origLine);
          const tailHasFiller = new RegExp(`\\b${filler}\\b`, "i").test(tailLine);
          if (origHasFiller && tailHasFiller && tailLine !== origLine) {
            console.log(`[enforce] Line ${i+1} reverted: filler word "${filler}" left dangling after injection`);
            return origLine;
          }
        }
      }

      // 1. Always protect first 5 content lines (name, summary, contact)
      if (i < 5) return origLine;

      // 2. Skills: revert if ranking numbers lost
      if (meta.isSkills && skillsRankingLost(origLine, tailLine)) {
        console.log(`[enforce] Line ${i+1} reverted: skills ranking lost`);
        return origLine;
      }

      // 2b. Skills: revert if an added word matches a frequent JD brand/company term
      // (heuristic: words appearing 2+ times in JD that aren't in our tech allowlist)
      if (meta.isSkills) {
        const origWordSet = new Set(origLine.toLowerCase().split(/\s+/).filter(Boolean));
        const addedWords = tailLine.toLowerCase().split(/\s+/).filter(w => !origWordSet.has(w) && w.length > 3);
        const suspicious = addedWords.some(w => {
          const clean = w.replace(/[^a-z0-9]/g, "");
          return !promptMissingKws.some(kw => kw.toLowerCase().replace(/[^a-z0-9]/g, "") === clean);
        });
        if (suspicious) {
          console.log(`[enforce] Line ${i+1} reverted: skills line added a word not in approved keyword list`);
          return origLine;
        }
      }

      const tailWords = tailLine.trim().split(/\s+/).filter(Boolean).length;

      // 3. Revert if over word budget
      if (tailWords > meta.budget) {
        console.log(`[enforce] Line ${i+1} too long: ${tailWords}w > ${meta.budget}w budget`);
        return origLine;
      }

      // 4. Revert if truncated (< 92% of original words)
      const minWords = Math.floor(meta.words * 0.92);
      if (tailWords < minWords && meta.words > 5) {
        console.log(`[enforce] Line ${i+1} truncated: ${tailWords}w < min ${minWords}w`);
        return origLine;
      }

      // 5. Revert if a new clause/sentence was appended after the original ending
      if (meta.isBullet && origLine.trim().endsWith('.')) {
        const stripBullet = s => s.trim().replace(/^[•●–\-]\s+/, '').trim();
        const origClean = stripBullet(origLine);
        const tailClean = stripBullet(tailLine);
        // Count sentences: if tail has more, something was appended
        const countS = s => (s.match(/[.!?]/g) || []).length;
        if (countS(tailClean) > countS(origClean)) {
          console.log(`[enforce] Line ${i+1} reverted: sentence appended after original`);
          return origLine;
        }
        // If tail starts with original content but adds 10+ chars after
        const origWithoutPeriod = origClean.slice(0, -1);
        if (tailClean.startsWith(origWithoutPeriod) && tailClean.length > origWithoutPeriod.length + 10) {
          console.log(`[enforce] Line ${i+1} reverted: content appended after sentence`);
          return origLine;
        }
      }

      // 6. Revert false migration target injection
      // Catches both slash ("RDS/DynamoDB") and comma ("RDS, DynamoDB, X") injection
      if (meta.isBullet && /\b(?:migrat|mov|convert|upgrad)/i.test(origLine)) {
        // Slash detection: "RDS" → "RDS/Something"
        const origWords = origLine.split(/\s+/);
        const tailWords2 = tailLine.split(/\s+/);
        const slashInjection = origWords.some((ow, wi) => {
          const tw = tailWords2[wi] || '';
          return !ow.includes('/') && tw.includes('/') &&
            tw.toLowerCase().startsWith(ow.toLowerCase().replace(/[,.]$/, ''));
        });
        // Comma detection: count words between "to" and "using/with/achieving"
        // If tail has more tech terms in that range than original, it's false injection
        const toUsing = /\bto\s+(.+?)\s+(?:using|with|achieving|via|by)\b/i;
        const origToUsing = origLine.match(toUsing);
        const tailToUsing = tailLine.match(toUsing);
        const commaInjection = origToUsing && tailToUsing &&
          tailToUsing[1].split(/[,\/]/).length > origToUsing[1].split(/[,\/]/).length + 1;
        if (slashInjection || commaInjection) {
          console.log(`[enforce] Line ${i+1} reverted: false migration target injection`);
          return origLine;
        }
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
    // Deterministic after score: same JD terms, now against tailored text
    const afterScore = keywordScore(tailoredText, jdTechTerms, []);

    // Deterministic after-tailoring missing list — which jdTechTerms are STILL absent post-injection
    const afterMissingKws = jdTechTerms.filter(t => !tailoredText.toLowerCase().includes(t.toLowerCase()));
    const afterMatchedKws = jdTechTerms.filter(t => tailoredText.toLowerCase().includes(t.toLowerCase()));

    if (analysis) {
      analysis.beforeScore = beforeScore;
      analysis.matchScore = afterScore;
      // Override Gemini's inconsistent keyword lists with deterministic ones.
      // Show post-tailoring state: what's matched/missing in the FINAL resume the user downloads.
      analysis.matchedKeywords = afterMatchedKws.slice(0, 12);
      analysis.missingKeywords = afterMissingKws.slice(0, 10);
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