import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, jd } = req.body;
    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    const systemPrompt = `You are a precise resume tailoring assistant. You will be given a resume and a job description.

YOUR OUTPUT MUST FOLLOW THESE RULES WITHOUT EXCEPTION:

1. Return the resume line by line, in the EXACT same number of lines as the input
2. Each output line MUST be the same length or shorter (in characters) than the corresponding input line
3. NEVER add new lines or merge lines — the line count must match exactly
4. NEVER change: names, companies, job titles, dates, education, certifications, contact info
5. You may ONLY change wording within a line — swap keywords, adjust phrasing — but never exceed the original line length
6. If a line cannot be improved without exceeding the character limit, return it UNCHANGED
7. Output ONLY the resume text — no commentary, no markdown, no explanations

CRITICAL: Line count in = line count out. Character count per line in >= character count per line out.
This is a hard constraint because the output will be overlaid on the original PDF at exact coordinates.`;

    const userPrompt = `Here is the resume (tailor this):

${resumeText}

Here is the job description to tailor for:

<job_description>
${jd}
</job_description>

Return the tailored resume. Same number of lines. Each line same length or shorter than original. No new lines added.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    let tailoredText = response.response.text();

    // Safety net: enforce line count and length constraints server-side
    const originalLines = resumeText.split("\n");
    const tailoredLines = tailoredText.split("\n");

    const corrected = originalLines.map((origLine, i) => {
      const tailLine = tailoredLines[i] ?? origLine;
      // If tailored line is longer than original, fall back to original
      if (tailLine.length > origLine.length + 5) {
        return origLine;
      }
      return tailLine;
    });

    tailoredText = corrected.join("\n");

    return res.status(200).json({ tailoredText });
  } catch (err) {
    console.error("Tailor error:", err);
    return res.status(500).json({ error: err.message });
  }
}