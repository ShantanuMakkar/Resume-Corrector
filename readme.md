# Resume Tailor

> Upload your resume. Paste a job description. Get a surgically tailored `.docx` in seconds.

Live: [resume-corrector.vercel.app](https://resume-corrector.vercel.app)

---

## What it does

Resume Tailor reads your `.docx` resume and a job description, identifies missing ATS keywords, and injects them into your existing bullets and skills line — without changing your layout, formatting, or voice. You review every change and accept or reject each one before downloading.

**What you get:**
- Tailored `.docx` with identical formatting
- JD match score (before and after)
- Missing keyword list
- Per-change accept/reject control
- Cover letter hooks, reframing tips, gap analysis

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite |
| Styling | CSS variables, Inter font |
| Deployment | Vercel (serverless functions) |
| AI | Google Gemini (5-model cascade) |
| Docx processing | JSZip (XML-level manipulation) |

---

## Project structure

```
/
├── api/
│   ├── tailor.js          # Core tailoring endpoint
│   └── recommend.js       # Recommendations endpoint
├── src/
│   ├── App.jsx            # Main app, routing, state
│   ├── App.css            # Global styles
│   ├── main.jsx           # Entry point
│   ├── lib/
│   │   └── docxProcessor.js   # Docx extraction + injection
│   └── components/
│       ├── ResumeUpload.jsx   # File upload panel
│       ├── JDInput.jsx        # Job description textarea
│       ├── ResultPanel.jsx    # Diff view, scores, recommendations
│       └── TestPanel.jsx      # Dev-only test report (remove before launch)
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

---

## Local development

### Prerequisites
- Node.js 18+
- Vercel CLI (`npm i -g vercel`)
- Google AI Studio API key

### Setup

```bash
git clone <repo>
cd resume-tailor
npm install
```

Create `.env.local`:
```
GOOGLE_API_KEY=your_key_here
```

Run locally:
```bash
vercel dev
```

Open `http://localhost:3000`

### Testing mode
Add `?test=1` to the URL after tailoring to see the full diagnostic report. Click **🧪 Copy Test Report** to copy it to clipboard.

---

## How it works

### 1. Extraction (`docxProcessor.js`)
- Loads the `.docx` as a zip using JSZip
- Parses `word/document.xml` directly — no Word dependency
- Extracts all `<w:p>` paragraphs including table cells
- Detects bullet points via `<w:numPr>` (Word's list numbering)
- Prefixes bullet lines with `•` so the AI classifies them correctly
- Builds plain text resume while preserving paragraph order

### 2. Tailoring (`api/tailor.js`)
- Preprocesses the JD: strips benefits, salary, EEO, company intro
- Classifies each line: `[bullet]`, `[skills]`, `[tech]`, `[summary]`
- Computes per-line word budgets: bullets get +3 words, skills get +2 (swap)
- Extracts missing JD keywords using regex + filtering
- Sends content lines + budget list to Gemini with strict injection rules
- Server-side enforcement: reverts lines that are truncated (< 92% original words), over-budget, or have keywords appended after metrics

**Model cascade** (tries in order on quota/timeout):
1. `gemini-2.5-flash`
2. `gemini-2.5-flash-lite`
3. `gemini-2.5-pro`
4. `gemini-3.1-flash-lite`
5. `gemini-3.5-flash`

### 3. Scoring
- JD keywords extracted deterministically from the JD text (not from Gemini's opinion)
- Before score = JD keywords present in original resume / total JD keywords
- After score = same calculation on tailored resume
- Delta = after - before (consistent across runs)

### 4. Injection (`docxProcessor.js`)
- Builds a replacement map: original paragraph text → tailored text
- Applies changes using word-level LCS diff
- Preserves bold, italic, hyperlink runs — only changes runs that need updating
- Fuzzy matching fallback (≥ 0.85 similarity) for minor extraction differences
- Strips `•` prefix before XML matching (prefix was for AI only)

### 5. Diff view (`ResultPanel.jsx`)
- Similarity-based matching within ±3 line window (not purely positional)
- Classifies changes as semantic (content) or cosmetic (punctuation/spacing)
- Accept/reject per change — excluded changes revert to original in download

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google AI Studio API key |

---

## Deployment

```bash
vercel --prod
```

The `vercel.json` sets 60s max duration for API functions (Gemini can be slow on free tier).

---

## Key design decisions

**Why `.docx` only (not PDF)?**
PDF injection without destroying layout requires font embedding and pixel-level positioning. `.docx` XML is structured and injectable. Users can open the tailored `.docx` in Google Docs and export as PDF.

**Why XML-level docx manipulation (not a library)?**
Libraries like `mammoth` are great for reading but don't preserve formatting on write. Direct XML manipulation keeps bold, fonts, spacing, and layout exactly as-is.

**Why Gemini (not GPT or Claude)?**
Free tier with generous quotas for development. The cascade handles quota exhaustion automatically. Switch to any provider by replacing the SDK calls in `api/tailor.js`.

**Why extract JD keywords ourselves for scoring?**
Gemini's keyword lists are inconsistent across runs — the same keyword can appear as both "matched" and "missing" in different runs. Deterministic regex extraction gives stable, reproducible scores.

---

## Prompt strategy

The tailor prompt is structured to be:
1. **Directive** — tells the AI exactly which lines to change, not "use your judgment"
2. **Constrained** — per-line word budgets shown explicitly
3. **Safe** — explicit list of what never to change (name, dates, company names, metrics)
4. **Generic** — no hardcoded tool names; always references the extracted missing keyword list

Server-side enforcement catches what the prompt misses.

---

## Known limitations (v1)

- Only `.docx` input — `.doc` (old Word format) has limited fidelity
- Free tier Gemini is rate-limited to ~20-40 requests/day per model
- Very long resumes (> 800 words) may hit the 60s Vercel timeout
- Go/Rust and niche tool keywords are rarely injectable (no good bullet context)

---

## Author

Shantanu Makkar