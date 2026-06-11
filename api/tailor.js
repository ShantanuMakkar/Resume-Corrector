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

    const systemPrompt = `You are a precise resume tailoring assistant. You will receive a resume as plain text (extracted from a Word document) and a job description.

YOUR JOB:
- Make minimal, surgical changes to tailor the resume to the job description
- Preserve at least 80% of the text verbatim
- Only modify: professional summary/objective, skills keywords, and up to 2-3 action verb/keyword tweaks per role's bullet points
- NEVER change: names, companies, job titles, dates, education, certifications, contact info
- Do NOT fabricate skills or experience not already present
- Mirror the JD's language where it genuinely matches existing experience
- Keep the same tone and writing style

OUTPUT FORMAT:
- Return ONLY the modified resume text
- Preserve all paragraph breaks exactly as in the input
- No commentary, no markdown, no explanations
- The paragraph count must match the input exactly`;

    const userPrompt = `Resume to tailor:

${resumeText}

Job description:

${jd}`;

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