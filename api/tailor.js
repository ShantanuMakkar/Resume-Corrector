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

    const originalLines = resumeText.split("\n");
    const originalWordCount = resumeText.split(/\s+/).filter(Boolean).length;

    // Build per-paragraph character budget
    const paraLimits = originalLines
      .map((line, i) => `Line ${i+1} (max ${line.length} chars): ${line}`)
      .join("\n");

    const systemPrompt = `You are a precise resume tailoring assistant.

HARD CONSTRAINTS — MUST BE FOLLOWED EXACTLY:
1. Output must have EXACTLY ${originalLines.length} lines — same as input
2. Each output line must be EQUAL OR SHORTER in character count than the input line
3. Total word count must stay within ±20 words of the original (${originalWordCount} words)
4. NEVER add new sentences, bullet points, or expand existing ones
5. If you cannot improve a line without exceeding its character limit, return it UNCHANGED

TAILORING RULES:
- NEVER change: name, companies, job titles, dates, education, certifications, contact info
- ONLY swap individual keywords/phrases within existing lines
- Mirror JD language only where it maps directly to existing experience
- Same tone, same voice

OUTPUT: Return ONLY the resume text. No commentary. No markdown. Exact same line count as input.`;

    const userPrompt = `Tailor this resume for the job description below.
Each line has a character limit — do NOT exceed it.

${paraLimits}

JOB DESCRIPTION:
${jd}`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    let tailoredText = response.response.text().trim();

    // Server-side enforcement: check every line against original char count
    const origLines = resumeText.split("\n");
    const tailLines = tailoredText.split("\n");

    // If line count drifted, trim or pad
    while (tailLines.length > origLines.length) tailLines.pop();
    while (tailLines.length < origLines.length) tailLines.push(origLines[tailLines.length]);

    // Enforce per-line char limit
    const corrected = origLines.map((origLine, i) => {
      const tailLine = tailLines[i] ?? origLine;
      // If tailored line exceeds original length by more than 5 chars, revert
      if (tailLine.length > origLine.length + 5) {
        return origLine;
      }
      return tailLine;
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