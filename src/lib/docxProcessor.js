function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTextNodes(xml) {
  const nodes = [];
  const regex = /(<w:t[^>]*>)([^<]*)(<\/w:t>)/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      openTag: match[1],
      text: decodeXml(match[2]),
      closeTag: match[3],
      raw: match[0],
    });
  }
  return nodes;
}

// Fix #3: extract ALL paragraphs including those inside tables
// Also detects Word list/bullet paragraphs via w:numPr
function extractAllParagraphs(docXml) {
  const result = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let match;
  while ((match = paraRegex.exec(docXml)) !== null) {
    const nodes = extractTextNodes(match[0]);
    const text = nodes.map(n => n.text).join("").trim();
    // Detect Word list paragraphs — these are bullet points even without ● prefix
    const isBullet = match[0].includes("<w:numPr>");
    result.push({ text, isBullet, start: match.index, end: match.index + match[0].length });
  }
  return result;
}

// Build plain text for AI — includes table cell text
// Marks bullet paragraphs (w:numPr) with • prefix so metadata detects them correctly
export function buildResumeText(docXml) {
  const paras = extractAllParagraphs(docXml);
  return paras
    .map(p => {
      if (!p.text) return null;
      // Mark Word list paragraphs with bullet prefix if not already marked
      if (p.isBullet && !p.text.startsWith("●") && !p.text.startsWith("•") && !p.text.startsWith("-")) {
        return "• " + p.text;
      }
      return p.text;
    })
    .filter(Boolean)
    .join("\n");
}

// Word-level LCS diff
function diffWords(a, b) {
  const at = a.split(/(\s+)/).filter(Boolean);
  const bt = b.split(/(\s+)/).filter(Boolean);
  const m = at.length, n = bt.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = at[i] === bt[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (at[i] === bt[j]) { ops.push({ type: "same", a: at[i] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type: "del", a: at[i] }); i++; }
    else { ops.push({ type: "ins", b: bt[j] }); j++; }
  }
  while (i < m) ops.push({ type: "del", a: at[i++] });
  while (j < n) ops.push({ type: "ins", b: bt[j++] });
  return ops;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}

// Fix #2: bold/formatting preservation
// Instead of distributing text across runs proportionally (which breaks formatting),
// we identify which runs contain the changed words and only update those runs.
// Unchanged runs (bold labels, hyperlinks, etc.) are left completely untouched.
function applyTextToPara(paraXml, origText, newText) {
  if (origText === newText) return paraXml;

  const nodes = extractTextNodes(paraXml);
  if (nodes.length === 0) return paraXml;

  // Single run — simple replacement
  if (nodes.length === 1) {
    const node = nodes[0];
    const openTag = (newText !== newText.trim())
      ? (node.openTag.includes('xml:space') ? node.openTag : node.openTag.replace('>', ' xml:space="preserve">'))
      : node.openTag;
    const newNode = `${openTag}${escapeXml(newText)}${node.closeTag}`;
    return paraXml.slice(0, node.start) + newNode + paraXml.slice(node.end);
  }

  // Fix #2: Multi-run paragraph
  // Strategy: use word-level diff to find what changed, then
  // assign each changed word to the run that contains that position in the original text
  const ops = diffWords(origText, newText);

  // Build a char-position → run index map
  let charPos = 0;
  const runRanges = nodes.map(node => {
    const start = charPos;
    charPos += node.text.length;
    return { start, end: charPos, text: node.text };
  });

  // For each run, compute its new text by applying only the ops relevant to its range
  const newRunTexts = runRanges.map(({ start: rs, end: re }) => {
    let newRunText = "";
    let opPos = 0;

    for (const op of ops) {
      if (op.type === "same") {
        const tokEnd = opPos + op.a.length;
        if (tokEnd > rs && opPos < re) {
          const s = Math.max(opPos, rs) - opPos;
          const e = Math.min(tokEnd, re) - opPos;
          newRunText += op.a.slice(s, e);
        }
        opPos += op.a.length;
      } else if (op.type === "del") {
        opPos += op.a.length;
      } else if (op.type === "ins") {
        // Attribute insertion to the run that owns this position
        if (opPos >= rs && opPos <= re) {
          newRunText += op.b;
        }
      }
    }
    return newRunText;
  });

  // Apply only to runs whose text actually changed — leave bold/hyperlink runs untouched
  let result = paraXml;
  let offset = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nt = newRunTexts[i];

    if (nt === node.text) continue; // unchanged — preserve formatting exactly

    const openTag = (nt !== nt.trim())
      ? (node.openTag.includes('xml:space') ? node.openTag : node.openTag.replace('>', ' xml:space="preserve">'))
      : node.openTag;

    const newNode = `${openTag}${escapeXml(nt)}${node.closeTag}`;
    const s = node.start + offset;
    const e = node.end + offset;
    result = result.slice(0, s) + newNode + result.slice(e);
    offset += newNode.length - node.raw.length;
  }

  return result;
}

// Extract docx and return resumeText built from XML
export async function extractDocx(file) {
  const JSZip = (await import("jszip")).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file("word/document.xml").async("string");
  const resumeText = buildResumeText(docXml);
  return { arrayBuffer, docXml, resumeText };
}

export async function extractTextFromDocx(file) {
  const { resumeText } = await extractDocx(file);
  return resumeText;
}

export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;
  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid docx file");
  const docXml = await docXmlFile.async("string");

  // Fix #3: extract ALL paragraphs including table cells
  const xmlParas = extractAllParagraphs(docXml);

  const origLines = originalText.split("\n").map(s => s.trim());
  const tailLines = tailoredText.split("\n").map(s => s.trim());

  // Build replacement map: xmlParaText -> tailoredText (positional match)
  const replacements = new Map();

  let tailIdx = 0;
  for (let i = 0; i < xmlParas.length; i++) {
    const xmlText = xmlParas[i].text;
    if (!xmlText || xmlText.split(/\s+/).length < 3) continue;

    const origIdx = origLines.findIndex(l => l === xmlText);
    if (origIdx === -1) continue;

    const tailLine = tailLines[origIdx];
    if (tailLine && tailLine !== xmlText) {
      replacements.set(xmlText, tailLine);
    }
  }

  // Fix #7: sanitise replacement values
  for (const [k, v] of replacements.entries()) {
    const clean = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/[\uFFFE\uFFFF]/g, "");
    if (clean !== v) replacements.set(k, clean);
  }

  // Fuzzy fallback — also normalise bullet prefixes
  for (const xmlPara of xmlParas) {
    const xt = xmlPara.text;
    if (!xt || xt.split(/\s+/).length < 3 || replacements.has(xt)) continue;
    const xtNorm = stripBulletPrefix(xt);
    let bestOrig = null, bestScore = 0;
    for (const [orig] of replacements.entries()) {
      const s = similarity(xtNorm, stripBulletPrefix(orig));
      if (s > bestScore) { bestScore = s; bestOrig = orig; }
    }
    if (bestOrig && bestScore >= 0.85) {
      replacements.set(xt, replacements.get(bestOrig));
    }
  }

  console.log(`[docxProcessor] ${replacements.size} paragraphs to replace`);
  if (replacements.size === 0) return arrayBuffer;

  // Fix #4: multi-line bullets — use global replace on full docXml
  // so all <w:p> are found regardless of nesting
  let modifiedXml = docXml;
  let replaceCount = 0;

  modifiedXml = modifiedXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraXml) => {
    const nodes = extractTextNodes(paraXml);
    const paraText = nodes.map(n => n.text).join("").trim();
    if (!paraText || paraText.split(/\s+/).length < 3) return paraXml;

    const replacement = replacements.get(paraText);
    if (!replacement) return paraXml;

    replaceCount++;
    return applyTextToPara(paraXml, paraText, replacement);
  });

  console.log(`[docxProcessor] Replaced ${replaceCount} paragraphs`);

  zip.file("word/document.xml", modifiedXml);
  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}