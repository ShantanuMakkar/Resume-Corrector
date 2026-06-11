// Extract plain text from docx using mammoth, preserving paragraph structure
export async function extractTextFromDocx(file) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from ? Buffer.from(arrayBuffer) : arrayBuffer;

  // Extract as plain text, preserving paragraph breaks
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

// Inject tailored text back into the original docx XML
// Strategy: parse the docx zip, find word/document.xml, 
// replace text runs paragraph by paragraph
export async function injectTextIntoDocx(originalFile, originalText, tailoredText) {
  const JSZip = (await import("jszip")).default;

  const arrayBuffer = await originalFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Read the main document XML
  const docXml = await zip.file("word/document.xml").async("string");

  // Parse paragraphs from both texts
  const originalParas = originalText.split("\n").map(p => p.trim());
  const tailoredParas = tailoredText.split("\n").map(p => p.trim());

  // Build replacement map: original paragraph text → tailored paragraph text
  const replacements = new Map();
  const maxLen = Math.max(originalParas.length, tailoredParas.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = originalParas[i] || "";
    const tail = tailoredParas[i] || "";
    if (orig && tail && orig !== tail) {
      replacements.set(orig, tail);
    }
  }

  if (replacements.size === 0) {
    // Nothing changed — return original
    return arrayBuffer;
  }

  // Replace text in XML while preserving all formatting tags
  let modifiedXml = replaceTextInXml(docXml, replacements);

  // Write modified XML back into zip
  zip.file("word/document.xml", modifiedXml);

  // Generate new docx blob
  const blob = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return blob;
}

// Replace paragraph text in the XML, preserving all <w:r> run formatting
function replaceTextInXml(xml, replacements) {
  // Extract all <w:p>...</w:p> paragraph blocks
  // For each paragraph, get its plain text, check if it needs replacement,
  // and if so, replace the text content while keeping the first run's formatting
  
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  
  return xml.replace(paraRegex, (para) => {
    const plainText = extractPlainTextFromPara(para);
    const trimmed = plainText.trim();
    
    if (!trimmed) return para;
    
    const replacement = replacements.get(trimmed);
    if (!replacement) return para;
    
    // Replace the text content in this paragraph's runs
    return replaceParaText(para, plainText, replacement);
  });
}

// Extract plain text from a <w:p> block by concatenating all <w:t> values
function extractPlainTextFromPara(para) {
  const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let text = "";
  let match;
  while ((match = textRegex.exec(para)) !== null) {
    text += match[1];
  }
  return text;
}

// Replace text in a paragraph while keeping formatting of the first run
// and removing extra runs if the replacement is shorter
function replaceParaText(para, originalText, replacementText) {
  // Find all <w:r>...</w:r> runs
  const runRegex = /<w:r[ >][\s\S]*?<\/w:r>/g;
  const runs = [];
  let match;
  while ((match = runRegex.exec(para)) !== null) {
    runs.push({ full: match[0], index: match.index });
  }

  if (runs.length === 0) return para;

  // Strategy: keep the first run's formatting (<w:rPr>), 
  // put all replacement text into it, blank out all other runs
  const firstRun = runs[0].full;
  
  // Extract run properties from first run
  const rPrMatch = firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : "";
  
  // Escape XML special characters in replacement text
  const escapedText = replacementText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Build new first run with replacement text
  const newFirstRun = `<w:r>${rPr}<w:t xml:space="preserve">${escapedText}</w:t></w:r>`;

  // Replace first run with new content, blank out remaining runs
  let result = para;
  
  // Replace all runs with empty text first
  result = result.replace(runRegex, "");
  
  // Find where the first run was and insert the new run before </w:p>
  result = result.replace(/<\/w:p>/, `${newFirstRun}</w:p>`);
  
  return result;
}