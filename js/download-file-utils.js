// ── Module: download-file-utils.js ────────────────────────────────────────────
// Pure file-download and filename-construction utilities.
// No dependency on shared download-state.js variables.
// These functions are self-contained and reusable across pages if needed.

// ── triggerDownload ───────────────────────────────────────────────────────────
// Creates a temporary object URL, clicks an invisible <a> to trigger the
// browser save dialog, then revokes the URL after a short delay.
function triggerDownload(blob, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// ── extractCandidateName ──────────────────────────────────────────────────────
// Returns the first short non-blank line of a CV as a hyphenated slug,
// suitable for use in a filename. Returns null if nothing usable is found.
function extractCandidateName(cvText) {
  if (!cvText) return null;
  const firstLine = cvText.split('\n').map(function(l) { return l.trim(); })
    .find(function(l) { return l.length > 1 && l.length < 60; });
  if (!firstLine) return null;
  const sanitized = firstLine.replace(/[^a-zA-Z0-9\s\-]/g, '').trim()
    .replace(/\s+/g, '-').slice(0, 30);
  return sanitized || null;
}

// ── sanitizeFilenamePart ──────────────────────────────────────────────────────
// Strips accents, removes characters unsafe in filenames, collapses whitespace
// to hyphens, and trims to maxLen. Returns null for empty/whitespace-only input.
function sanitizeFilenamePart(raw, maxLen) {
  if (!raw) return null;
  const ACCENT_MAP = {
    'é':'e','è':'e','ê':'e','ë':'e','à':'a','â':'a','ä':'a',
    'î':'i','ï':'i','ô':'o','ö':'o','ù':'u','û':'u','ü':'u',
    'ç':'c','ñ':'n','ã':'a','õ':'o',
  };
  let s = raw.replace(/[éèêëàâäîïôöùûüçñãõ]/gi, function(c) {
    return ACCENT_MAP[c.toLowerCase()] || '';
  });
  s = s.replace(/[^a-zA-Z0-9\s-]/g, '').trim()
       .replace(/\s+/g, '-')
       .replace(/-+/g, '-')
       .slice(0, maxLen)
       .replace(/-+$/, '');
  return s || null;
}

// ── buildCVFilename ───────────────────────────────────────────────────────────
// Constructs a descriptive filename from CV content, job title, company, and
// language. Falls back to "CV-<lang>.<ext>" when only the language label is
// available (i.e. all other parts are null/empty after sanitization).
function buildCVFilename(cvText, jobTitle, company, lang, ext) {
  // Take the first word of the first non-blank, non-all-uppercase line
  // (all-uppercase lines are section headings — skip them)
  const nameLine = cvText
    ? cvText.split('\n').map(function(l) { return l.trim(); })
        .find(function(l) { return l.length > 1 && l.length < 60 && !/^[A-Z\s]{4,}$/.test(l); })
    : null;
  const firstName = nameLine ? sanitizeFilenamePart(nameLine.split(/\s+/)[0], 20) : null;

  const langLabel = lang === 'id' ? 'Indonesia' : 'English';

  const parts = [
    firstName,
    sanitizeFilenamePart(jobTitle, 20),
    sanitizeFilenamePart(company,  20),
    langLabel,
  ].filter(Boolean);

  if (parts.length === 1) return 'CV-' + langLabel + '.' + ext;
  return parts.join('_') + '.' + ext;
}
