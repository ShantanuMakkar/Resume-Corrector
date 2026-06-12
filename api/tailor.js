import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, jd } = req.body;
    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    const origLines = resumeText.split("\n");
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;

    const systemPrompt = `You are an expert ATS optimization specialist. Your ONLY job is to maximize keyword coverage between the resume and job description.

STEP 1 — KEYWORD GAP ANALYSIS (do this mentally first):
- Extract every technical skill, tool, methodology, and domain term from the JD
- Find which ones are ABSENT or UNDER-REPRESENTED in the resume
- These missing keywords are your insertion targets

STEP 2 — KEYWORD INJECTION (this is your actual task):
Insert missing JD keywords into the resume where they GENUINELY fit based on the candidate's existing experience.

WHERE to inject keywords:
1. SKILLS LINE: This is your primary target. Swap lower-priority skills for missing JD keywords. Reorder to lead with JD-critical terms. Rename existing skills to match JD's exact terminology (e.g. if JD says "Observability" and resume has "Prometheus/Grafana", replace with "Observability (Prometheus/Grafana)")
2. BULLET POINTS: If a bullet describes work that clearly used a missing JD technology, add that technology by name. Only add where genuinely applicable.
3. SUMMARY: Mirror the JD's exact role title and top 3 required skills

WHAT NOT TO DO:
- Do NOT fix grammar, punctuation, or rephrase sentences for style
- Do NOT swap "and" for "&" or change formatting
- Do NOT reorder bullet points
- Do NOT change any numbers, percentages, company names, dates
- Do NOT add technologies the candidate clearly doesn't have
- NEVER fabricate experience

LINE COUNT RULE:
- Output must have EXACTLY ${origLines.length} lines
- Each line must be equal or shorter in characters than the original
- If a line cannot absorb a keyword without exceeding its character limit, skip it

OUTPUT: Return ONLY the modified resume text. No commentary. Exact same line count.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${origLines.length} lines — output must match exactly):
${resumeText}

Focus: inject missing JD keywords where they genuinely fit. Do not touch lines that don't need keyword changes.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    // Also get analysis in parallel
    const analysisPrompt = `Analyze this resume against the job description and return ONLY valid JSON (no markdown):

{
  "matchScore": <0-100 integer based on keyword overlap>,
  "matchedKeywords": [<top JD keywords already in resume, max 12>],
  "missingKeywords": [<JD keywords completely absent from resume, max 10>],
  "missingContext": "<one sentence on the most critical gap>",
  "titleAlignment": "<one sentence on how well candidate title/level matches>",
  "recommendation": "<1-2 sentences: honest fit assessment and what to lead with>"
}

Resume:
${resumeText}

Job Description:
${jd}`;

    const analysisModel = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Run both in parallel
    const [tailorResponse, analysisResponse] = await Promise.all([
      model.generateContent(userPrompt),
      analysisModel.generateContent(analysisPrompt),
    ]);

    let tailoredText = tailorResponse.response.text().trim();
    let analysis = null;

    try {
      let analysisRaw = analysisResponse.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(analysisRaw);
    } catch (e) {
      console.warn("Analysis parse failed:", e.message);
    }

    // Server-side enforcement
    const tailLines = tailoredText.split("\n");
    while (tailLines.length > origLines.length) tailLines.pop();
    while (tailLines.length < origLines.length) tailLines.push(origLines[tailLines.length]);

    const corrected = origLines.map((origLine, i) => {
      const tail = tailLines[i] ?? origLine;
      return tail.length > origLine.length + 3 ? origLine : tail;
    });

    tailoredText = corrected.join("\n");
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;

    return res.status(200).json({
      tailoredText,
      analysis,
      stats: {
        originalLines: origLines.length,
        tailoredLines: corrected.length,
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