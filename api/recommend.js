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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, jd } = req.body;
    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    // Fix #5: fully generic prompt — no hardcoded examples
    const prompt = `You are a senior career coach. Analyze this candidate's resume against the job description.
Your advice must be SPECIFIC to this candidate's actual experience, companies, numbers, and stack.
Do not give generic advice. Reference their real projects, metrics, and technologies.

Return ONLY a valid JSON object. No markdown, no code fences, no explanation.

{
  "suggestedBullets": [
    {
      "section": "<exact project/company name from resume where this bullet belongs>",
      "bullet": "<a specific, truthful bullet the candidate could add — use their actual numbers, stack, and context>",
      "reasoning": "<why this bullet is relevant to THIS specific JD — reference the JD requirement it addresses>"
    }
  ],
  "skillsToAdd": [
    {
      "skill": "<skill/tool/methodology the candidate demonstrably has but didn't list>",
      "reasoning": "<which part of their experience implies this skill, and which JD requirement it addresses>"
    }
  ],
  "framingSuggestions": [
    {
      "current": "<exact text of an existing bullet that undersells the candidate>",
      "reframe": "<stronger version of the same bullet, using JD language, same facts>",
      "reasoning": "<why the reframe is stronger for this specific role>"
    }
  ],
  "genuineGaps": [
    {
      "gap": "<skill or experience the JD requires that is genuinely absent from the resume>",
      "severity": "<high|medium|low>",
      "suggestion": "<specific actionable advice: if they have partial experience, say where; if not, how to address in interviews>"
    }
  ],
  "coverLetterHooks": [
    "<specific talking point from their actual experience that directly addresses a key JD requirement — be concrete, name the project/metric>"
  ]
}

Rules:
- suggestedBullets: 2-4 bullets. Must be truthful — inferred from what they clearly did, not fabricated.
- skillsToAdd: 2-4 skills. Only suggest what their work clearly implies.
- framingSuggestions: 2-3 bullets that undersell. Show the stronger version using their real facts.
- genuineGaps: 1-4 honest gaps. Be direct about severity. Low = nice to have, High = likely screened out.
- coverLetterHooks: 2-3 hooks. Must be specific to their experience, not generic advice.

Resume:
${resumeText}

Job Description:
${jd}`;

    const primaryConfig = {
      model: "gemini-2.5-flash",
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    };
    const response = await generateWithFallback(primaryConfig, "gemini-2.5-flash-lite", prompt);
    let raw = response.response.text().trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    const recommendations = JSON.parse(raw);

    // Fix #7: post-process to remove hallucinated bullets
    // A suggested bullet is hallucinated if it references tools/tech not in the resume
    if (recommendations.suggestedBullets) {
      // Extract all tech terms from the resume (words > 3 chars, capitalised or known patterns)
      const resumeTerms = new Set(
        resumeText.toLowerCase().split(/[\s|,;()\[\]]+/).filter(w => w.length > 3)
      );
      recommendations.suggestedBullets = recommendations.suggestedBullets.filter(item => {
        if (!item.bullet) return false;
        // Check bullet doesn't reference major tech terms absent from resume
        const bulletTerms = item.bullet.toLowerCase().split(/[\s|,;()\[\]]+/).filter(w => w.length > 4);
        const unknownTerms = bulletTerms.filter(w => {
          // Skip common English words
          const commonWords = new Set(["built","created","implemented","developed","designed","managed","delivered","reduced","improved","increased","ensured","using","with","across","within","during","their","these","those","which","while","through","between","about","after","before","other","every","under","above","below"]);
          if (commonWords.has(w)) return false;
          return !resumeTerms.has(w);
        });
        // Reject if more than 3 unknown technical terms
        const tooManyUnknowns = unknownTerms.length > 3;
        if (tooManyUnknowns) console.log(`[recommend] Filtered hallucinated bullet: ${item.bullet.slice(0,60)}`);
        return !tooManyUnknowns;
      });
    }

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Recommend error:", err);
    return res.status(500).json({ error: err.message });
  }
}