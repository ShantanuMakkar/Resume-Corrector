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

    // Build per-line word budgets — more natural for LLMs than char counts
    // Allow bullet points up to +3 words (room for keyword injection)
    // Skills lines are longer so allow +5 words
    const lineMetadata = origLines.map((line, i) => {
      const words = line.trim().split(/\s+/).filter(Boolean).length;
      const isBullet = line.trim().startsWith("●") || line.trim().startsWith("•") || line.trim().startsWith("-");
      const isSkills = line.includes("|") && words > 15;
      const budget = isSkills ? words + 5 : isBullet ? words + 3 : words + 1;
      return { words, budget, isBullet, isSkills };
    });

    const systemPrompt = `You are an ATS optimization specialist. Maximize keyword coverage by injecting missing JD keywords into the resume.

STEP 1 — KEYWORD GAP ANALYSIS:
Extract every technical skill, tool, methodology, and domain term from the JD.
Find which are ABSENT or UNDER-REPRESENTED in the resume. These are your injection targets.

STEP 2 — INJECT KEYWORDS (3 targets in priority order):

TARGET 1 — SKILLS LINE (highest priority, most impact):
Restructure to lead with JD-critical terms. Use JD's exact terminology.
Group related tools (e.g. "Observability (Prometheus, Grafana, Dynatrace)").
You have up to +5 words of budget on this line.

TARGET 2 — BULLET POINTS (critical — inject into EVERY relevant bullet):
For each bullet, identify JD keywords that describe work clearly happening in that bullet.
Inject them. You have up to +3 words per bullet.
Strategy: trim filler phrases to make room THEN add keyword.
Filler to remove: "successfully", "effectively", "in order to", "utilizing", "leveraging", "in a timely manner", verbose prepositional phrases.

CONCRETE EXAMPLES of correct bullet injection:
Before: "Built production Alerts App on AWS with Lambda/API Gateway/SQS ingestion, boosting throughput by 40% and cutting latency by 25%."
After:  "Built production Alerts App on AWS (Lambda, SQS, SNS, EventBridge), boosting throughput by 40% and cutting latency by 25%."
(removed "ingestion", added "SNS, EventBridge" — net +1 word, keyword injected)

Before: "Automated Terraform deployments and Dockerized apps with Python/Bash scripting, reducing manual ops efforts by 50%."
After:  "Automated Terraform/GitOps deployments and containerized apps with Python/Bash, reducing manual ops efforts by 50%."
(removed "scripting", added "GitOps" — net 0 words, keyword injected)

Before: "Maintained Kubernetes (EKS) clusters with Helm and GitLab CI/CD for core banking services, achieving 99.9% uptime"
After:  "Maintained Kubernetes (EKS) clusters with Helm/GitLab CI/CD for core banking, achieving 99.9% uptime and SLO compliance"
(removed "services", added "SLO compliance" if JD mentions SLOs — net 0 words)

TARGET 3 — SUMMARY (first 2-3 lines after name):
Mirror JD's exact role title and top 3 required skills. Budget: +1 word.

HARD RULES:
- Output EXACTLY ${origLines.length} lines
- Each line's word count must stay within the per-line budget shown below
- NEVER change: company names, job titles, dates, education, contact info, certifications
- NEVER fabricate experience not in the resume
- Do NOT fix grammar, punctuation, or sentence style
- If a line has no relevant keyword gap, return it UNCHANGED

PER-LINE WORD BUDGETS:
${lineMetadata.map((m, i) => `Line ${i+1}: max ${m.budget} words (current: ${m.words})`).join("\n")}

OUTPUT: Return ONLY the resume text. Exactly ${origLines.length} lines. No commentary.`;

    const userPrompt = `JOB DESCRIPTION:
${jd}

RESUME (${origLines.length} lines):
${resumeText}

Inject missing JD keywords into skills line AND every relevant bullet point. Trim filler to make room.`;

    const model = client.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
    });

    const analysisPrompt = `Analyze this resume against the job description. Return ONLY valid JSON, no markdown:

{
  "matchScore": <0-100 integer>,
  "missingKeywords": [<JD keywords completely absent from resume, max 10, most critical first>],
  "matchedKeywords": [<top JD keywords already in resume, max 12>],
  "missingContext": "<one sentence on the single most critical gap>",
  "titleAlignment": "<one sentence on how well candidate title/level matches>",
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

    // Server-side enforcement: word count per line
    const tailLines = tailoredText.split("\n");
    while (tailLines.length > origLines.length) tailLines.pop();
    while (tailLines.length < origLines.length) tailLines.push(origLines[tailLines.length]);

    const corrected = origLines.map((origLine, i) => {
      const tail = tailLines[i] ?? origLine;
      const tailWords = tail.trim().split(/\s+/).filter(Boolean).length;
      const budget = lineMetadata[i]?.budget ?? (origLine.trim().split(/\s+/).filter(Boolean).length + 2);
      // Revert if word count exceeds budget
      return tailWords > budget ? origLine : tail;
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