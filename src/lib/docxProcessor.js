// Extract plain text from docx using mammoth
export async function extractTextFromDocx(file) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

// Similarity score between two strings
function similarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (aWords.size === 0 || bWords.length === 0) return 0;
  const common = bWords.filter(w => aWords.has(w)).length;
  return (2 * common) / (aWords.size + bWords.length);
}

// Escape XML special characters
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Get all text from a paragraph's <w:t> elements
function getParaText(paraXml) {
  const matches = paraXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  return matches.map(m => m.replace(/<[^>]+>/g, "")).join("");
}

// Replace all text content in a paragraph with new text,
// keeping only the FIRST run's formatting and discarding the rest
function replaceParaContent(paraXml, newText) {
  // Find first <w:r> run
  const firstRunMatch = paraXml.match(/<w:r[ >][\s\S]*?<\/w:r>/);
  if (!firstRunMatch) return paraXml; // No runs found, return unchanged

  const firstRun = firstRunMatch[0];

  // Extract run properties <w:rPr>...</w:rPr> from first run if present
  const rPrMatch = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : "";

  // Build a single new run with all the replacement text
  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(newText)}</w:t></w:r>`;

  // Remove ALL existing runs from the paragraph
  let result = paraXml.replace(/<w:r[ >][\s\S]*?<\/w:r>/g, "");

  // Insert new run just before closing </w:p>
  result = result.replace(/<\/w:p>/, `${newRun}</w:p>`);

  return result;
}

export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;

  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Get the document XML
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Not a valid docx file");
  const docXml = await docXmlFile.async("string");

  // Build paragraph replacement map from diff
  const origParas = originalText.split("\n").map(s => s.trim()).filter(Boolean);
  const tailParas = tailoredText.split("\n").map(s => s.trim()).filter(Boolean);

  // Match each original paragraph to its tailored counterpart
  const replacements = new Map(); // origText → tailoredText
  const usedTail = new Set();

  for (const orig of origParas) {
    let bestIdx = -1, bestScore = 0;
    for (let j = 0; j < tailParas.length; j++) {
      if (usedTail.has(j)) continue;
      const score = similarity(orig, tailParas[j]);
      if (score > bestScore) { bestScore = score; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestScore >= 0.4 && tailParas[bestIdx] !== orig) {
      replacements.set(orig, tailParas[bestIdx]);
      usedTail.add(bestIdx);
    }
  }

  console.log(`[docxProcessor] ${replacements.size} paragraphs to replace`);

  if (replacements.size === 0) {
    console.warn("[docxProcessor] No replacements found — returning original");
    return arrayBuffer;
  }

  // Process each <w:p> paragraph in the XML
  let modifiedXml = docXml;
  let replaceCount = 0;

  modifiedXml = modifiedXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const paraText = getParaText(para).trim();
    if (!paraText) return para;

    // Direct match first
    if (replacements.has(paraText)) {
      replaceCount++;
      return replaceParaContent(para, replacements.get(paraText));
    }

    // Fuzzy match: find if any replacement key is similar enough
    for (const [orig, repl] of replacements.entries()) {
      if (similarity(paraText, orig) >= 0.75) {
        replaceCount++;
        return replaceParaContent(para, repl);
      }
    }

    return para;
  });

  console.log(`[docxProcessor] Replaced ${replaceCount} paragraphs in XML`);

  // Save modified XML back into zip
  zip.file("word/document.xml", modifiedXml);

  const result = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return result; 
}