import { PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";

// Walk every page's font resources and pull out the raw embedded font program
// bytes (TrueType/OpenType/CFF), deduplicated by FontDescriptor reference.
// These can be re-embedded via pdfDoc.embedFont() so overlay text matches the
// original document's fonts instead of falling back to a generic font.
export function extractEmbeddedFontBytes(pdfLibDoc) {
  const fontBytesList = [];
  const seen = new Set();

  for (const page of pdfLibDoc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;

    const fontDict = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fontDict) continue;

    for (const key of fontDict.keys()) {
      const fontRef = fontDict.get(key);
      const fontObj = pdfLibDoc.context.lookupMaybe(fontRef, PDFDict);
      if (!fontObj) continue;

      let descriptor = fontObj.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
      if (!descriptor) {
        const descendants = fontObj.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
        if (descendants && descendants.size() > 0) {
          const descFont = pdfLibDoc.context.lookupMaybe(descendants.get(0), PDFDict);
          descriptor = descFont?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
        }
      }
      if (!descriptor) continue;

      const refKey = fontRef?.toString?.() ?? `${key}`;
      if (seen.has(refKey)) continue;
      seen.add(refKey);

      for (const fileKey of ["FontFile2", "FontFile3", "FontFile"]) {
        const fileRef = descriptor.get(PDFName.of(fileKey));
        if (!fileRef) continue;
        const stream = pdfLibDoc.context.lookupMaybe(fileRef, PDFRawStream);
        if (!stream) continue;
        try {
          const bytes = decodePDFRawStream(stream).getBytes();
          if (bytes && bytes.length > 0) fontBytesList.push(bytes);
        } catch {
          // Unsupported/undecodable font stream — skip it
        }
        break;
      }
    }
  }

  return fontBytesList;
}
