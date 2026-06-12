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

    const prompt = `You are a senior career coach reviewing a candidate's resume against a job description.

Analyze the resume and JD deeply, then return ONLY a valid JSON object (no markdown, no explanation) in this exact format:

{
  "suggestedBullets": [
    {
      "section": "Infosys / Truist project",
      "bullet": "Led cross-functional incident response for 15M+ user payment platform, reducing P1 resolution time by X%",
      "reasoning": "Your 9 years of experience and Vault/OPA/PagerDuty usage implies SRE-level incident ownership — the JD explicitly asks for this"
    }
  ],
  "skillsToAdd": [
    {
      "skill": "FinOps",
      "reasoning": "You built $15K savings dashboards with Kubecost/Cost Explorer — that IS FinOps. The JD mentions cost optimization ownership."
    }
  ],
  "framingSuggestions": [
    {
      "current": "Designed GitLab CI/CD pipelines with Terraform",
      "reframe": "Owned end-to-end CI/CD platform engineering for a 15M-user production system",
      "reasoning": "The JD is for a senior role — own the platform, don't just describe the tool"
    }
  ],
  "genuineGaps": [
    {
      "gap": "Multi-region disaster recovery",
      "severity": "high",
      "suggestion": "If you've done any DR planning at HSBC or Truist, add it explicitly. Otherwise be prepared to discuss this in interviews."
    }
  ],
  "coverLetterHooks": [
    "Lead with the Truist platform scale — 15M users, 10M+ daily notifications is enterprise-grade and directly matches this role",
    "Mention the $15K cloud savings as a concrete FinOps win"
  ]
}

Rules:
- suggestedBullets: 2-4 specific bullets the candidate COULD truthfully add based on their implied experience. Be specific, use their actual stack and numbers.
- skillsToAdd: 2-4 skills/frameworks they demonstrably have but didn't list
- framingSuggestions: 2-3 existing bullets that undersell the candidate and how to reframe them for this JD
- genuineGaps: honest gaps with severity (high/medium/low) and actionable suggestion
- coverLetterHooks: 2-3 specific talking points for the cover letter/interview

Resume:
${resumeText}

Job Description:
${jd}`;

    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    let raw = response.response.text().trim();

    // Strip markdown code fences if present
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    const recommendations = JSON.parse(raw);
    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Recommend error:", err);
    return res.status(500).json({ error: err.message });
  }
}