import { callClaude } from './claude.js';
import { sanitizeForLLM, hasPromptInjection } from './sanitize.js';

const INJECTION_ERROR = 'CV mengandung konten yang tidak diizinkan. Pastikan file CV tidak berisi perintah sistem.';

// ---- File Validation ----

export function validateFileData(cvData) {
  // cvData is JSON string: { type: 'pdf'|'docx'|'txt', data: base64|plaintext }
  try {
    const parsed = JSON.parse(cvData);
    if (!parsed.type || !parsed.data) return { valid: false, error: 'Format data tidak valid' };

    // txt files carry raw text — no magic-byte check needed, just size guard
    if (parsed.type === 'txt') {
      if (typeof parsed.data !== 'string') return { valid: false, error: 'Data teks tidak valid' };
      if (parsed.data.length > 5 * 1024 * 1024) return { valid: false, error: 'Ukuran file melebihi 5MB' };
      return { valid: true, parsed };
    }

    // pdf / docx: data is base64-encoded binary — check magic bytes
    // H2 FIX: Validate base64 character set before calling atob() to prevent
    // malformed input from bypassing the magic-byte check via exception handling.
    const sample = parsed.data.slice(0, 8);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sample)) {
      return { valid: false, error: 'Format data tidak valid (bukan base64)' };
    }
    const bytes = atob(sample);
    const codes = Array.from(bytes).map(c => c.charCodeAt(0));

    if (parsed.type === 'pdf') {
      // PDF magic: %PDF (0x25 0x50 0x44 0x46)
      if (codes[0] !== 0x25 || codes[1] !== 0x50 || codes[2] !== 0x44 || codes[3] !== 0x46) {
        return { valid: false, error: 'File bukan PDF yang valid' };
      }
    } else if (parsed.type === 'docx') {
      // DOCX magic: PK (0x50 0x4B)
      if (codes[0] !== 0x50 || codes[1] !== 0x4B) {
        return { valid: false, error: 'File bukan DOCX yang valid' };
      }
    }

    // Size check: base64 size → actual size ≈ base64.length × 0.75
    const approxSize = parsed.data.length * 0.75;
    if (approxSize > 5 * 1024 * 1024) {
      return { valid: false, error: 'Ukuran file melebihi 5MB' };
    }

    return { valid: true, parsed };
  } catch (e) {
    return { valid: false, error: 'Data CV tidak dapat dibaca' };
  }
}

// ---- CV Text Extraction ----

export async function extractCVText(cvData, env) {
  try {
    const parsed = typeof cvData === 'string' ? JSON.parse(cvData) : cvData;

    // TXT files: text is already extracted on the frontend, no Claude call needed
    if (parsed.type === 'txt') {
      const raw = parsed.data || '';
      // Reject before any processing — TXT is the highest-risk path because the
      // user types/pastes content directly and it reaches the LLM verbatim.
      if (hasPromptInjection(raw)) {
        return { success: false, error: INJECTION_ERROR };
      }
      // Enforce the same 60k-char ceiling the frontend textarea claims.
      // Silently truncate rather than reject — extra chars may come from
      // sessionStorage manipulation but the user still deserves a result.
      const text = sanitizeForLLM(raw).slice(0, 60000);
      if (text.trim().length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan file berisi teks CV yang lengkap (minimal 100 karakter).' };
      }
      return { success: true, text };
    }

    // DOCX: extract text locally via ZIP+XML parsing (no API call needed)
    if (parsed.type === 'docx') {
      let rawText;
      try {
        rawText = await extractTextFromDOCX(parsed.data);
      } catch (docxErr) {
        console.error('[extractCVText:docx]', docxErr.message);
        return { success: false, error: 'File DOCX tidak bisa dibaca. Pastikan file tidak terproteksi password, lalu coba upload lagi. Jika masalah berlanjut, coba simpan ulang sebagai PDF.' };
      }
      if (rawText.length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Gunakan CV berbasis teks — bukan tabel gambar, file kosong, atau hasil scan.' };
      }
      if (hasPromptInjection(rawText)) {
        return { success: false, error: INJECTION_ERROR };
      }
      return { success: true, text: sanitizeForLLM(rawText) };
    }

    // PDF: use Claude document API
    let response;
    try {
      response = await callClaude(
        env,
        'Ekstrak semua teks dari dokumen CV ini. Output hanya teks mentah tanpa formatting tambahan.',
        parsed,
        4096
      );
    } catch (pdfErr) {
      console.error('[extractCVText:pdf]', pdfErr.message);
      // Provide actionable guidance based on error type
      const isTimeout = pdfErr.message?.includes('timeout') || pdfErr.message?.includes('Timeout');
      if (isTimeout) {
        return { success: false, error: 'File PDF kamu membutuhkan waktu terlalu lama untuk diproses. Coba kompres PDF atau konversi ke format DOCX, lalu upload lagi.' };
      }
      return { success: false, error: 'File PDF tidak bisa dibaca. Pastikan PDF tidak terproteksi password dan berisi teks (bukan hasil scan). Jika masalah berlanjut, coba konversi ke DOCX.' };
    }

    if (response?.stop_reason === 'max_tokens') {
      return { success: false, error: 'CV kamu terlalu panjang untuk diproses. Coba konversi ke format DOCX, atau ringkas CV menjadi maksimal 3 halaman.' };
    }

    const rawText = response?.content?.[0]?.text || '';

    if (rawText.length < 100) {
      return { success: false, error: 'CV kamu tidak bisa dibaca. Gunakan CV berbasis teks — bukan hasil scan, foto, atau PDF dengan gambar saja. Coba konversi ke DOCX.' };
    }
    // Check extracted PDF text — catches injection embedded in the document body
    if (hasPromptInjection(rawText)) {
      return { success: false, error: INJECTION_ERROR };
    }

    return { success: true, text: sanitizeForLLM(rawText) };
  } catch (e) {
    console.error('[extractCVText]', e.message);
    return { success: false, error: 'Gagal memproses file CV. Pastikan file tidak rusak atau terproteksi, lalu coba lagi.' };
  }
}

// ---- DOCX text extraction (client-side ZIP+XML parsing) ----

export async function extractTextFromDOCX(base64Data) {
  // H2 FIX: Lightweight base64 character-set check before atob() on the full payload.
  // A quick scan of the first 64 chars is sufficient to catch obviously invalid input
  // without the cost of a regex on a multi-megabyte string.
  const head = base64Data.slice(0, 64);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(head)) {
    throw new Error('File CV tampak rusak atau tidak lengkap. Coba upload file yang berbeda.');
  }
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const target = 'word/document.xml';

  // Cap the outer scan at the first 2 MB — word/document.xml is always near the
  // start of a well-formed ZIP. Scanning beyond this protects against malformed
  // files that would otherwise keep the Worker busy for its full CPU budget.
  const SCAN_LIMIT = Math.min(bytes.length - 30, 2 * 1024 * 1024);
  for (let i = 0; i < SCAN_LIMIT; i++) {
    // ZIP local file header signature: PK\x03\x04
    if (bytes[i] !== 0x50 || bytes[i+1] !== 0x4B || bytes[i+2] !== 0x03 || bytes[i+3] !== 0x04) continue;

    const flags        = bytes[i+6]  | (bytes[i+7]  << 8);
    const comprMethod  = bytes[i+8]  | (bytes[i+9]  << 8);
    let   compressedSz = (bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24)) >>> 0;
    const filenameLen  = bytes[i+26] | (bytes[i+27] << 8);
    const extraLen     = bytes[i+28] | (bytes[i+29] << 8);

    const filename = new TextDecoder().decode(bytes.slice(i + 30, i + 30 + filenameLen));
    if (filename !== target) continue;

    const dataStart = i + 30 + filenameLen + extraLen;

    // Bit 3 of general-purpose flags = data descriptor mode: Word, LibreOffice, and Google Docs
    // all set this flag, meaning compressedSz in the local header is 0 and the real size is
    // written in a data descriptor record (PK\x07\x08) AFTER the compressed data.
    // Scan forward to find either the data descriptor or the next local file header.
    if ((flags & 0x08) || compressedSz === 0) {
      let end = dataStart;
      // H3 FIX: Reduced inner-scan ceiling from 10 MB to 1 MB.
      // word/document.xml is always small (well under 1 MB for real CVs).
      // A 10 MB per-entry scan on a malicious DOCX could exhaust the Worker CPU budget.
      const innerLimit = Math.min(bytes.length - 4, dataStart + 1 * 1024 * 1024);
      while (end < innerLimit) {
        if (bytes[end] === 0x50 && bytes[end+1] === 0x4B) {
          // Data descriptor signature (PK\x07\x08) or next local file header (PK\x03\x04)
          if ((bytes[end+2] === 0x07 && bytes[end+3] === 0x08) ||
              (bytes[end+2] === 0x03 && bytes[end+3] === 0x04)) {
            break;
          }
        }
        end++;
      }
      compressedSz = end - dataStart;
    }

    const compressed = bytes.slice(dataStart, dataStart + compressedSz);

    let xmlBytes;
    if (comprMethod === 0) {
      xmlBytes = compressed; // stored, no compression
    } else if (comprMethod === 8) {
      // raw DEFLATE (ZIP uses no zlib header)
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      xmlBytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } else {
      throw new Error('File CV tampak rusak atau tidak lengkap. Coba upload file yang berbeda.');
    }

    const xmlText = new TextDecoder('utf-8').decode(xmlBytes);
    // Extract text from <w:t> elements, preserving space runs
    const parts = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xmlText)) !== null) parts.push(m[1]);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  throw new Error('File CV tampak rusak atau tidak lengkap. Coba upload file yang berbeda.');
}
