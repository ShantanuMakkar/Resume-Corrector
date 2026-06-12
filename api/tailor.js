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

    const systemPrompt = `You are an ATS optimization specialist. Your job is to maximize keyword coverage between a resume and job description by injecting missing JD keywords into the resume.

STEP 1 — IDENTIFY MISSING KEYWORDS:
Extract every technical skill, tool, methodology, and domain term from the JD. Find which ones are absent or under-represented in the resume. These are your injection targets.

STEP 2 — INJECT KEYWORDS:

TARGET 1 — SKILLS LINE (highest priority):
Restructure to lead with JD-critical terms. Use JD's exact terminology. Group related tools.

TARGET 2 — BULLET POINTS (critical — do not skip):
For each bullet point, ask: does this work clearly involve a JD keyword that isn't mentioned?
If yes — inject it. To make room, trim filler words like "successfully", "effectively", "in order to", "utilizing", "leveraging", or verbose phrases.

Example of correct bullet point injection:
Original (128c): "Built production Alerts App on AWS with Lambda/API Gateway/SQS ingestion, boosting throughput by 40% and cutting latency by 25%."
JD has "EventBridge" and "SNS" → inject them, trim "ingestion":
Result (124c):   "Built production Alerts App on AWS (Lambda, SQS, SNS, EventBridge), boosting throughput by 40% and cutting latency by 25%."

Example of correct bullet point injection:
Original: "Automated Terraform deployments and Dockerized apps with Python/Bash scripting, reducing manual ops efforts by 50%."
JD has "GitOps" → inject it, trim "scripting":
Result:   "Automated Terraform/GitOps deployments and containerized apps with Python/Bash, reducing manual ops efforts by 50%."

TARGET 3 — SUMMARY (first 2-3 lines after name):
Mirror the JD's exact role title and top required skills.

HARD RULES:
- Output EXACTLY ${origLines.length} lines — same count as input
- Each output line must be SAME LENGTH OR SHORTER than the corresponding input line
- To inject a keyword into a long line: REMOVE filler words to create space first
- NEVER change: company names, job titles, dates, education, contact info, certifications
- NEVER fabricate experience not in the resume
- Do NOT fix grammar or punctuation — only inject keywords
- If a line truly has no relevant keyword gap, return it UNCHANGED

OUTPUT: Return ONLY the resume text. ${origLines.length} lines. No commentary.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${origLines.length} lines — each output line must be ≤ original line length):
${resumeText}

Inject missing JD keywords into the skills line AND bullet points. Trim filler words to make room.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const analysisPrompt = `Analyze this resume against the job description. Return ONLY valid JSON, no markdown:

{
  "matchScore": <0-100>,
  "matchedKeywords": [<top JD keywords already in resume, max 12>],
  "missingKeywords": [<JD keywords absent from resume, max 10>],
  "missingContext": "<one sentence on the most critical gap>",
  "titleAlignment": "<one sentence on how well the candidate title/level matches>",
  "recommendation": "<1-2 sentences: honest fit assessment and what to lead with>"
}

Resume:
${resumeText}

Job Description:
${jd}`;

    const analysisModel = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const [tailorResponse, analysisResponse] = await Promise.all([
      model.generateContent(userPrompt),
      analysisModel.generateContent(analysisPrompt),
    ]);

    let tailoredText = tailorResponse.response.text().trim();
    let analysis = null;

    try {
      let raw = analysisResponse.response.text().trim()
        .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      analysis = JSON.parse(raw);
    } catch (e) {
      console.warn("Analysis parse failed:", e.message);
    }

    // Server-side enforcement
    const tailLines = tailoredText.split("\n");
    while (tailLines.length > origLines.length) tailLines.pop();
    while (tailLines.length < origLines.length) tailLines.push(origLines[tailLines.length]);

    const corrected = origLines.map((origLine, i) => {
      const tail = tailLines[i] ?? origLine;
      // Allow up to 5 chars over — model should have trimmed to compensate
      // but revert if it went significantly over without trimming
      return tail.length > origLine.length + 5 ? origLine : tail;
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