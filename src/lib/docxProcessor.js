export async function extractTextFromDocx(file) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getParaText(paraXml) {
  return (paraXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map(m => m.replace(/<[^>]+>/g, ""))
    .join("");
}

// Distribute new text across existing runs proportionally by character count.
// This preserves all run formatting (bold, font, size, color) while updating content.
function replaceParaContent(paraXml, newText) {
  const runRegex = /<w:r[ >][\s\S]*?<\/w:r>/g;
  const runs = [];
  let match;
  while ((match = runRegex.exec(paraXml)) !== null) {
    const runText = (match[0].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map(m => m.replace(/<[^>]+>/g, "")).join("");
    runs.push({ full: match[0], text: runText, index: match.index });
  }

  if (runs.length === 0) return paraXml;

  // Filter to runs that actually have text content
  const textRuns = runs.filter(r => r.text.length > 0);
  if (textRuns.length === 0) return paraXml;

  const originalTotal = textRuns.reduce((s, r) => s + r.text.length, 0);

  if (textRuns.length === 1) {
    // Single text run — simple replacement
    const run = textRuns[0];
    const rPrMatch = run.full.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : "";
    const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r>`;
    return paraXml.replace(run.full, newRun);
  }

  // Multiple text runs — distribute new text proportionally
  // Each run gets a slice of newText proportional to its original character share
  let result = paraXml;
  let charPos = 0;
  const newLen = newText.length;

  for (let i = 0; i < textRuns.length; i++) {
    const run = textRuns[i];
    const isLast = i === textRuns.length - 1;

    let slice;
    if (isLast) {
      slice = newText.slice(charPos);
    } else {
      const proportion = run.text.length / originalTotal;
      const charCount = Math.round(proportion * newLen);
      // Snap to word boundary to avoid mid-word cuts
      let end = charPos + charCount;
      if (end < newText.length) {
        const nextSpace = newText.indexOf(" ", end);
        const prevSpace = newText.lastIndexOf(" ", end);
        if (nextSpace !== -1 && prevSpace > charPos) {
          end = (nextSpace - end) < (end - prevSpace) ? nextSpace : prevSpace;
        } else if (nextSpace !== -1) {
          end = nextSpace;
        }
      }
      slice = newText.slice(charPos, end);
      charPos = end;
      // Skip leading space in next slice
      if (charPos < newText.length && newText[charPos] === " ") charPos++;
    }

    const rPrMatch = run.full.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : "";
    const newRun = slice
      ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(slice)}</w:t></w:r>`
      : `<w:r>${rPr}<w:t></w:t></w:r>`;

    result = result.replace(run.full, newRun);
  }

  return result;
}

export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;

  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid docx file");
  const docXml = await docXmlFile.async("string");

  const origParas = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);

  // Build replacement map
  const replacements = new Map();
  const usedTail = new Set();

  for (const orig of origParas) {
    // Skip very short paragraphs — section headers, names, dates unlikely to need changes
    // and short text risks false-positive matching
    if (orig.split(/\s+/).length < 4) continue;

    let bestIdx = -1, bestScore = 0;
    for (let j = 0; j < tailParas.length; j++) {
      if (usedTail.has(j)) continue;
      const score = similarity(orig, tailParas[j]);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }
    // Require score >= 0.5 to avoid false matches on short paragraphs
    if (bestIdx >= 0 && bestScore >= 0.5 && tailParas[bestIdx] !== orig) {
      replacements.set(orig, tailParas[bestIdx]);
      usedTail.add(bestIdx);
    }
  }

  console.log(`[docxProcessor] ${replacements.size} paragraphs to replace`);
  if (replacements.size === 0) return arrayBuffer;

  let modifiedXml = docXml;
  let replaceCount = 0;

  modifiedXml = modifiedXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const paraText = getParaText(para).trim();
    if (!paraText) return para;
    // Skip paragraphs with fewer than 4 words — headers, names, dates
    if (paraText.split(/\s+/).length < 4) return para;

    if (replacements.has(paraText)) {
      replaceCount++;
      return replaceParaContent(para, replacements.get(paraText));
    }

    // Fuzzy fallback
    for (const [orig, repl] of replacements.entries()) {
      if (similarity(paraText, orig) >= 0.78) {
        replaceCount++;
        return replaceParaContent(para, repl);
      }
    }

    return para;
  });

  console.log(`[docxProcessor] Replaced ${replaceCount} paragraphs in XML`);

  zip.file("word/document.xml", modifiedXml);

  return await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}