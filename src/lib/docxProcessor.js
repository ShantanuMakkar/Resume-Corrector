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

// Extract all <w:t> nodes with their exact position in the XML string
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

// Build word-level diff between two strings using LCS
function diffWords(a, b) {
  const aToks = a.split(/(\s+)/).filter(Boolean);
  const bToks = b.split(/(\s+)/).filter(Boolean);
  const m = aToks.length, n = bToks.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = aToks[i] === bToks[j]
        ? dp[i+1][j+1] + 1
        : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aToks[i] === bToks[j]) { ops.push({ type: "same", a: aToks[i], b: bToks[j] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type: "del", a: aToks[i] }); i++; }
    else { ops.push({ type: "ins", b: bToks[j] }); j++; }
  }
  while (i < m) ops.push({ type: "del", a: aToks[i++] });
  while (j < n) ops.push({ type: "ins", b: bToks[j++] });
  return ops;
}

// Given a list of original runs and tailored full-paragraph text,
// redistribute changes into the runs minimally — only updating runs that changed.
// Returns an array of new text values parallel to the input runs array.
function computeRunReplacements(origRuns, tailoredParaText) {
  const origParaText = origRuns.map(r => r.text).join("");
  if (origParaText === tailoredParaText) return origRuns.map(r => r.text);

  // Get word-level ops for the whole paragraph
  const ops = diffWords(origParaText, tailoredParaText);

  // Reconstruct the new text for each run by tracking position in original
  // Each run "owns" a slice of the original text — apply only the changes within its slice
  const newRunTexts = [];
  let origPos = 0; // position in origParaText (char index)

  for (const run of origRuns) {
    const runLen = run.text.length;
    const runStart = origPos;
    const runEnd = origPos + runLen;

    // Build replacement text for this run's portion
    // Walk the ops, accumulating what falls within this run's char range
    let charCount = 0;
    let newText = "";
    let opOrigPos = 0; // tracks position in original text across ops

    for (const op of ops) {
      if (op.type === "same") {
        const tokStart = opOrigPos;
        const tokEnd = opOrigPos + op.a.length;
        // Intersection with this run
        if (tokEnd > runStart && tokStart < runEnd) {
          const s = Math.max(tokStart, runStart) - tokStart;
          const e = Math.min(tokEnd, runEnd) - tokStart;
          newText += op.a.slice(s, e);
        }
        opOrigPos += op.a.length;
      } else if (op.type === "del") {
        // Deletion — just skip in original, don't add to newText
        opOrigPos += op.a.length;
      } else if (op.type === "ins") {
        // Insertion — attribute to the run that owns this position in original
        if (opOrigPos >= runStart && opOrigPos <= runEnd) {
          newText += op.b;
        }
      }
    }

    origPos = runEnd;
    newRunTexts.push(newText);
  }

  return newRunTexts;
}

// Core: replace <w:t> content in the XML with minimal changes
// Never touches run structure, paragraph structure, or any formatting
function applyReplacementsToXml(xml, paraReplacements) {
  // paraReplacements: Map of paragraphText -> tailoredText

  // Process paragraph by paragraph
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paraXml) => {
    // Extract all text nodes in this paragraph
    const textNodes = extractTextNodes(paraXml);
    if (textNodes.length === 0) return paraXml;

    // Get the full paragraph text
    const paraText = textNodes.map(n => n.text).join("");
    const trimmed = paraText.trim();
    if (!trimmed || trimmed.split(/\s+/).length < 4) return paraXml;

    // Find if this paragraph has a replacement
    const tailored = paraReplacements.get(trimmed);
    if (!tailored || tailored === trimmed) return paraXml;

    // Compute per-run new texts
    const newTexts = computeRunReplacements(textNodes, tailored);

    // Apply replacements: only update nodes whose text actually changed
    let result = paraXml;
    let offset = 0; // track position shifts from replacements

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const newText = newTexts[i];

      if (newText === node.text) continue; // unchanged — leave it alone

      // Build new <w:t> preserving the exact open tag (which may have xml:space="preserve")
      const openTag = newText !== newText.trimStart() || newText !== newText.trimEnd()
        ? node.openTag.includes('xml:space') ? node.openTag : node.openTag.replace('>', ' xml:space="preserve">')
        : node.openTag;

      const newNode = `${openTag}${escapeXml(newText)}${node.closeTag}`;

      // Replace in result using adjusted position
      const adjustedStart = node.start + offset;
      const adjustedEnd = node.end + offset;
      result = result.slice(0, adjustedStart) + newNode + result.slice(adjustedEnd);
      offset += newNode.length - node.raw.length;
    }

    return result;
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

export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;

  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid docx file");
  const docXml = await docXmlFile.async("string");

  // Build paragraph replacement map
  const origParas = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);

  const replacements = new Map();
  const usedTail = new Set();

  for (const orig of origParas) {
    if (orig.split(/\s+/).length < 4) continue;

    let bestIdx = -1, bestScore = 0;
    for (let j = 0; j < tailParas.length; j++) {
      if (usedTail.has(j)) continue;
      const score = similarity(orig, tailParas[j]);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestScore >= 0.5 && tailParas[bestIdx] !== orig) {
      replacements.set(orig, tailParas[bestIdx]);
      usedTail.add(bestIdx);
    }
  }

  // Also do fuzzy matching against actual XML paragraph texts
  // (mammoth extraction may differ slightly from raw XML text)
  const xmlParaTexts = [];
  const xmlParaRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let xmlMatch;
  while ((xmlMatch = xmlParaRegex.exec(docXml)) !== null) {
    const nodes = extractTextNodes(xmlMatch[0]);
    const text = nodes.map(n => n.text).join("").trim();
    if (text && text.split(/\s+/).length >= 4) {
      xmlParaTexts.push(text);
    }
  }

  // For any XML paragraph not yet in replacements, try fuzzy match
  for (const xmlText of xmlParaTexts) {
    if (replacements.has(xmlText)) continue;
    let bestOrig = null, bestScore = 0;
    for (const [orig] of replacements.entries()) {
      const score = similarity(xmlText, orig);
      if (score > bestScore) { bestScore = score; bestOrig = orig; }
    }
    if (bestOrig && bestScore >= 0.85) {
      replacements.set(xmlText, replacements.get(bestOrig));
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