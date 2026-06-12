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

    // Measure original document size
    const originalLines = resumeText.split("\n");
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;
    const originalCharCount = resumeText.length;

    const systemPrompt = `You are a precise resume tailoring assistant.

DOCUMENT SIZE CONSTRAINT — THIS IS THE MOST IMPORTANT RULE:
The original resume has exactly ${originalLines.length} lines, ${originalWordCount} words, and ${originalCharCount} characters.
Your output MUST have the same number of lines (±2 max).
Your output MUST have a similar word count (±30 words max).
Do NOT add new bullet points, new sentences, or expand existing ones.
If you add a word somewhere, remove a word elsewhere in the same paragraph to compensate.
Think of it as a fixed-size container — you are swapping words, not adding content.

TAILORING RULES:
- Preserve at least 80% of the text verbatim
- NEVER change: name, companies, job titles, dates, education, certifications, contact info
- ONLY modify: professional summary keywords, skills section keywords, and selective word swaps in bullet points (action verbs, tech keywords)
- Do NOT fabricate skills or experience not already present
- Mirror the JD language only where it genuinely maps to existing experience
- Keep the same tone and writing style

OUTPUT FORMAT:
- Return ONLY the modified resume text
- Preserve all paragraph and line breaks exactly as in the input — same number of lines
- No commentary, no markdown, no explanations`;

    const userPrompt = `Resume to tailor (${originalLines.length} lines, ${originalWordCount} words — output must match this size):

${resumeText}

Job description:

${jd}`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    let tailoredText = response.response.text();

    // Server-side safety net: enforce line count
    const tailoredLines = tailoredText.split("\n");
    const origLines = resumeText.split("\n");

    // If line count drifted by more than 3, trim or pad to match
    if (Math.abs(tailoredLines.length - origLines.length) > 3) {
      if (tailoredLines.length > origLines.length) {
        // Trim extra lines from the end
        tailoredText = tailoredLines.slice(0, origLines.length).join("\n");
      }
    }

    // Verify word count didn't explode
    const tailoredWordCount = tailoredText.split(/\s+/).filter(Boolean).length;
    const wordDrift = tailoredWordCount - originalWordCount;

    return res.status(200).json({
      tailoredText,
      stats: {
        originalLines: origLines.length,
        tailoredLines: tailoredText.split("\n").length,
        originalWords: originalWordCount,
        tailoredWords: tailoredWordCount,
        wordDrift,
      }
    });
  } catch (err) {
    console.error("Tailor error:", err);
    return res.status(500).json({ error: err.message });
  }
}