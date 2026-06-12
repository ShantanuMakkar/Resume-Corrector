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

    const systemPrompt = `You are an expert resume tailoring assistant.

YOUR GOAL: Tailor the resume to better match the job description by making targeted keyword and phrasing changes.

WHAT TO CHANGE (priority order):
1. Professional summary lines (usually the first 2-3 lines after the name) — rewrite to mirror JD's role title and key focus areas
2. Skills section — swap or add keywords from JD that match the candidate's actual experience; remove or deprioritize skills not mentioned in JD
3. Bullet points — swap action verbs and tech keywords to match JD language where genuinely applicable
4. "Technologies used" lines — reorder or swap to lead with JD-relevant technologies

HARD RULES:
- Output must have EXACTLY ${origLines.length} lines — same line count as input, no more, no less
- Each output line must be no longer than the corresponding input line (in characters) — this is critical for page layout
- NEVER change: name, contact info, company names, job titles, dates, education institution, certifications
- NEVER fabricate skills or experience not already present in the resume
- NEVER add new lines or merge lines
- If a line cannot be improved within its character limit, return it UNCHANGED

OUTPUT: Return ONLY the resume text. Exact same number of lines as input. No commentary.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME TO TAILOR (${origLines.length} lines, ${originalWordCount} words):
${resumeText}

Return exactly ${origLines.length} lines. Each line must be same length or shorter than the original.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    let tailoredText = response.response.text().trim();

    // Server-side enforcement
    const tailLines = tailoredText.split("\n");

    // Fix line count
    while (tailLines.length > origLines.length) tailLines.pop();
    while (tailLines.length < origLines.length) tailLines.push(origLines[tailLines.length]);

    // Fix per-line length — revert any line that got longer
    const corrected = origLines.map((origLine, i) => {
      const tail = tailLines[i] ?? origLine;
      return tail.length > origLine.length + 3 ? origLine : tail;
    });

    tailoredText = corrected.join("\n");
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;

    return res.status(200).json({
      tailoredText,
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