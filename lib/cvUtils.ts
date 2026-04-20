export function extractSampleLine(cvText: string): string | null {
  if (!cvText) return null;

  const lines = cvText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20);

  const bullet = lines.find(l =>
    l.startsWith('•') ||
    l.startsWith('-') ||
    l.match(/^(manage|develop|create|mengelola|membuat|mengembangkan)/i)
  );

  return bullet || lines[0] || null;
}

export function cleanLine(text: string): string {
  return text.replace(/^[•\-]\s*/, '').trim();
}
