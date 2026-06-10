import { GoogleGenerativeAI } from "@google/generative-ai";

const client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { resumeText, pages, jd } = req.body;

    if (!resumeText || !jd) {
      return res.status(400).json({ error: "Missing resumeText or jd" });
    }

    const systemPrompt = `You are a precise resume tailoring assistant. Your job is to make MINIMAL, SURGICAL changes to a resume to better match a job description.

STRICT RULES:
1. Preserve AT LEAST 80% of the original text verbatim
2. NEVER change: names, companies, job titles, dates, education details, degrees, GPA, certifications
3. ONLY modify: professional summary/objective, skills section keywords, and up to 2-3 action verb/keyword tweaks per role's bullet points
4. Do NOT fabricate experience, skills, or achievements not already present
5. Mirror the JD's language and keywords where they genuinely match existing experience
6. Keep the same tone, voice, and writing style as the original
7. Output ONLY the modified resume text — no commentary, no explanations, no markdown

The goal: a hiring manager's ATS system sees the JD keywords, but the resume still reads as the candidate's authentic voice.`;

    const userPrompt = `Here is the candidate's resume:

<resume>
${resumeText}
</resume>

Here is the job description to tailor for:

<job_description>
${jd}
</job_description>

Return the tailored resume text. Make only the minimal necessary changes. Preserve all formatting structure (line breaks, bullet points, section headers) exactly as-is.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const response = await model.generateContent(userPrompt);
    const tailoredText = response.response.text();

    return res.status(200).json({ tailoredText });
  } catch (err) {
    console.error("Tailor error:", err);
    return res.status(500).json({ error: err.message });
  }
}
