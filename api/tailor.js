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

    const systemPrompt = `You are an expert ATS resume optimization assistant helping a candidate bulk-apply to jobs efficiently.

Your job has TWO parts:

---
PART 1 — TAILOR THE RESUME

Make targeted changes to maximize ATS keyword match and recruiter relevance for the specific JD.

What to change (in priority order):
1. SUMMARY (first 2-3 lines after name): Rewrite to mirror the JD's exact role title and primary focus areas
2. SKILLS SECTION: Reorder to lead with JD-critical skills. Swap generic terms for JD's exact terminology (e.g. "Shell Scripting" → "Bash" if JD says "Bash"). Add JD keywords the candidate demonstrably has but didn't list.
3. BULLET POINTS: Replace action verbs and tech terms with JD's exact language where the underlying experience matches. Lead bullets with the most JD-relevant achievements.
4. TECH STACKS: Reorder "Technologies used" lines to lead with tools the JD explicitly mentions.

Hard rules:
- Output must have EXACTLY ${origLines.length} lines
- Each output line must be equal or shorter in characters than the corresponding input line
- NEVER change: name, contact info, company names, job titles, dates, education, certifications
- NEVER fabricate experience or skills not present in the resume
- NEVER add new lines or merge lines — same structure

---
PART 2 — ANALYSIS

After the resume, output a JSON block (and ONLY valid JSON, no markdown) in this exact format:

<<<ANALYSIS>>>
{
  "matchScore": 72,
  "matchedKeywords": ["keyword1", "keyword2"],
  "missingKeywords": ["keyword3", "keyword4"],
  "missingContext": "Brief note on what's missing and why it matters for this role",
  "titleAlignment": "How well the candidate's title/experience aligns with the JD role",
  "recommendation": "1-2 sentence honest assessment: should they apply, and what to highlight in cover letter"
}
<<<END>>>`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${origLines.length} lines, ${originalWordCount} words — output must match line count exactly):
${resumeText}`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    const raw = response.response.text().trim();

    // Split resume text from analysis JSON
    const analysisSplit = raw.split("<<<ANALYSIS>>>");
    let tailoredText = analysisSplit[0].trim();
    let analysis = null;

    if (analysisSplit.length > 1) {
      const jsonRaw = analysisSplit[1].split("<<<END>>>")[0].trim();
      try {
        analysis = JSON.parse(jsonRaw);
      } catch (e) {
        console.warn("Failed to parse analysis JSON:", e.message);
      }
    }

    // Server-side enforcement: line count + per-line length
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