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

// Extract text directly from XML paragraphs — single source of truth
// Returns array of { paraText, xmlPara } in document order
function extractXmlParagraphs(docXml) {
  const result = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let match;
  while ((match = paraRegex.exec(docXml)) !== null) {
    const nodes = extractTextNodes(match[0]);
    const text = nodes.map(n => n.text).join("").trim();
    result.push({ text, xml: match[0] });
  }
  return result;
}

// Build plain text from XML paragraphs (for sending to AI)
// Joins non-empty paragraphs with newlines
export function buildResumeText(docXml) {
  const paras = extractXmlParagraphs(docXml);
  return paras
    .map(p => p.text)
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
    if (at[i] === bt[j]) { ops.push({ type: "same", a: at[i], b: bt[j] }); i++; j++; }
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

// Apply new text into a paragraph's <w:t> nodes using word-level diff
function applyTextToPara(paraXml, origText, newText) {
  if (origText === newText) return paraXml;

  const nodes = extractTextNodes(paraXml);
  if (nodes.length === 0) return paraXml;

  const ops = diffWords(origText, newText);

  // Distribute new text across nodes by tracking original char position
  let origPos = 0;
  const newNodeTexts = nodes.map(node => {
    const runStart = origPos;
    const runEnd = origPos + node.text.length;
    origPos = runEnd;

    let newText = "";
    let opOrigPos = 0;

    for (const op of ops) {
      if (op.type === "same") {
        const tokEnd = opOrigPos + op.a.length;
        if (tokEnd > runStart && opOrigPos < runEnd) {
          const s = Math.max(opOrigPos, runStart) - opOrigPos;
          const e = Math.min(tokEnd, runEnd) - opOrigPos;
          newText += op.a.slice(s, e);
        }
        opOrigPos += op.a.length;
      } else if (op.type === "del") {
        opOrigPos += op.a.length;
      } else if (op.type === "ins") {
        if (opOrigPos >= runStart && opOrigPos <= runEnd) {
          newText += op.b;
        }
      }
    }
    return newText;
  });

  // Apply only changed nodes
  let result = paraXml;
  let offset = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const newNodeText = newNodeTexts[i];
    if (newNodeText === node.text) continue;

    const openTag = (newNodeText !== newNodeText.trim())
      ? (node.openTag.includes('xml:space') ? node.openTag : node.openTag.replace('>', ' xml:space="preserve">'))
      : node.openTag;

    const newNode = `${openTag}${escapeXml(newNodeText)}${node.closeTag}`;
    const s = node.start + offset;
    const e = node.end + offset;
    result = result.slice(0, s) + newNode + result.slice(e);
    offset += newNode.length - node.raw.length;
  }
  return result;
}

// Extract docx and return { arrayBuffer, docXml, resumeText }
// resumeText is built from XML directly — same paragraph boundaries as injection
export async function extractDocx(file) {
  const JSZip = (await import("jszip")).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file("word/document.xml").async("string");
  const resumeText = buildResumeText(docXml);
  return { arrayBuffer, docXml, resumeText };
}

// Keep mammoth extraction as fallback for display if needed
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

  // Extract paragraphs from XML — guaranteed same order/boundaries as originalText
  const xmlParas = extractXmlParagraphs(docXml);

  // Split original and tailored by newline — same paragraph boundaries
  const origLines = originalText.split("\n").map(s => s.trim());
  const tailLines = tailoredText.split("\n").map(s => s.trim());

  // Build replacement map: xmlParaText -> tailoredText
  // Match positionally — origLines[i] should correspond to xmlParas[i]
  // since both come from the same XML extraction
  const replacements = new Map();

  let tailIdx = 0;
  for (let i = 0; i < xmlParas.length; i++) {
    const xmlText = xmlParas[i].text;
    if (!xmlText || xmlText.split(/\s+/).length < 4) continue;

    // Find matching origLine for this xmlPara
    const origIdx = origLines.findIndex(l => l === xmlText);
    if (origIdx === -1) continue;

    // Find corresponding tailored line at same position
    const tailLine = tailLines[origIdx];
    if (tailLine && tailLine !== xmlText) {
      replacements.set(xmlText, tailLine);
    }
  }

  console.log(`[docxProcessor] ${replacements.size} paragraphs to replace`);
  if (replacements.size === 0) return arrayBuffer;

  // Apply replacements to XML
  let modifiedXml = docXml;
  let replaceCount = 0;

  modifiedXml = modifiedXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraXml) => {
    const nodes = extractTextNodes(paraXml);
    const paraText = nodes.map(n => n.text).join("").trim();
    if (!paraText) return paraXml;

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