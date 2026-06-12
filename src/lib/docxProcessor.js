// Extract text directly from XML paragraph by paragraph
// This ensures extraction order matches injection order exactly
async function extractXmlParas(arrayBuffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file("word/document.xml").async("string");

  const paras = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let match;
  while ((match = paraRegex.exec(docXml)) !== null) {
    const text = decodeXml(
      (match[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .map(m => m.replace(/<[^>]+>/g, ""))
        .join("")
    ).trim();
    paras.push(text);
  }
  return paras;
}

// Public: extract resume text for display and sending to AI
// Uses mammoth for readable output (handles tables, lists etc nicely)
export async function extractTextFromDocx(file) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

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

// Distribute new text across existing <w:t> nodes using word-level diff
// Only changes nodes whose text actually changed — never touches run structure
function applyTextToNodes(nodes, origParaText, newParaText) {
  if (origParaText === newParaText) return null; // nothing to do

  const ops = diffWords(origParaText, newParaText);

  // Reconstruct per-node text by tracking original char position
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

  return newNodeTexts;
}

// Apply replacement map directly to XML — only touching <w:t> content
function applyReplacementsToXml(xml, replacements) {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraXml) => {
    const nodes = extractTextNodes(paraXml);
    if (nodes.length === 0) return paraXml;

    const paraText = nodes.map(n => n.text).join("").trim();
    if (!paraText || paraText.split(/\s+/).length < 4) return paraXml;

    const replacement = replacements.get(paraText);
    if (!replacement) return paraXml;

    const newTexts = applyTextToNodes(nodes, paraText, replacement);
    if (!newTexts) return paraXml;

    // Apply replacements surgically — only update changed nodes
    let result = paraXml;
    let offset = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const newText = newTexts[i];
      if (newText === node.text) continue;

      const openTag = (newText !== newText.trim())
        ? (node.openTag.includes('xml:space') ? node.openTag : node.openTag.replace('>', ' xml:space="preserve">'))
        : node.openTag;

      const newNode = `${openTag}${escapeXml(newText)}${node.closeTag}`;
      const s = node.start + offset;
      const e = node.end + offset;
      result = result.slice(0, s) + newNode + result.slice(e);
      offset += newNode.length - node.raw.length;
    }

    return result;
  });
}

export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;
  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid docx file");
  const docXml = await docXmlFile.async("string");

  // Extract paragraphs directly from XML — same source as injection
  // This guarantees text matches exactly, no mammoth interpretation differences
  const xmlParas = [];
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRegex.exec(docXml)) !== null) {
    const nodes = extractTextNodes(m[0]);
    const text = nodes.map(n => n.text).join("").trim();
    if (text) xmlParas.push(text);
  }

  // Split tailored text into paragraphs
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);

  // Match XML paragraphs to tailored paragraphs using exact + fuzzy matching
  // We match in ORDER — the AI returns paragraphs in the same order as the original
  const replacements = new Map();

  // First pass: exact matches
  const usedTail = new Set();
  for (const xmlPara of xmlParas) {
    if (xmlPara.split(/\s+/).length < 4) continue;
    const idx = tailParas.findIndex((t, i) => !usedTail.has(i) && t === xmlPara);
    if (idx !== -1) {
      usedTail.add(idx);
      // exact match — no change needed
    }
  }

  // Second pass: match changed paragraphs in order
  // For each XML para, find the closest tailored para not yet used
  // Use ORDER-AWARE matching — only look within a window around the same position
  const usedTail2 = new Set();
  for (let i = 0; i < xmlParas.length; i++) {
    const xmlPara = xmlParas[i];
    if (xmlPara.split(/\s+/).length < 4) continue;

    // Estimate corresponding position in tailored (proportional)
    const approxIdx = Math.round((i / xmlParas.length) * tailParas.length);
    const windowSize = 5; // look ±5 around expected position
    const start = Math.max(0, approxIdx - windowSize);
    const end = Math.min(tailParas.length - 1, approxIdx + windowSize);

    let bestIdx = -1, bestScore = 0;
    for (let j = start; j <= end; j++) {
      if (usedTail2.has(j)) continue;
      const score = similarity(xmlPara, tailParas[j]);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }

    if (bestIdx >= 0 && bestScore >= 0.5 && tailParas[bestIdx] !== xmlPara) {
      replacements.set(xmlPara, tailParas[bestIdx]);
      usedTail2.add(bestIdx);
    } else if (bestIdx >= 0) {
      usedTail2.add(bestIdx); // mark as used even if unchanged
    }
  }

  console.log(`[docxProcessor] ${replacements.size} paragraphs to replace`);
  if (replacements.size === 0) return arrayBuffer;

  const modifiedXml = applyReplacementsToXml(docXml, replacements);
  zip.file("word/document.xml", modifiedXml);

  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}