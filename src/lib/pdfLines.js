// Group pdf.js text items (which can be partial words/runs) into full visual lines,
// using each item's baseline position. transform[4]/[5] are x/y in PDF user space
// (bottom-left origin), the same coordinate system pdf-lib draws in.
export function groupItemsIntoLines(items) {
  const filtered = items.filter((item) => item.str && item.str.length > 0);

  const lines = [];
  for (const item of filtered) {
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10;

    let line = lines.find((l) => Math.abs(l.y - y) < height * 0.4);
    if (!line) {
      line = { y, height, items: [] };
      lines.push(line);
    }
    line.items.push({ str: item.str, x, width: item.width || 0 });
    line.height = Math.max(line.height, height);
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  // Top of page first (largest y, since y increases upward in PDF space)
  lines.sort((a, b) => b.y - a.y);

  return lines.map((line) => {
    let text = "";
    let prevEnd = null;
    for (const item of line.items) {
      if (prevEnd !== null) {
        const gap = item.x - prevEnd;
        if (gap > line.height * 0.15 && !text.endsWith(" ") && !item.str.startsWith(" ")) {
          text += " ";
        }
      }
      text += item.str;
      prevEnd = item.x + item.width;
    }
    const xs = line.items.map((it) => it.x);
    const xEnds = line.items.map((it) => it.x + it.width);
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: Math.min(...xs),
      xEnd: Math.max(...xEnds),
      y: line.y,
      height: line.height,
    };
  });
}
