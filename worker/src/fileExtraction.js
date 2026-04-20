import { callClaude } from './claude.js';

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
    const bytes = atob(parsed.data.slice(0, 8));
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
      const text = parsed.data || '';
      if (text.trim().length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan file berisi teks CV yang lengkap.' };
      }
      return { success: true, text };
    }

    // DOCX: extract text locally via ZIP+XML parsing (no API call needed)
    if (parsed.type === 'docx') {
      const text = await extractTextFromDOCX(parsed.data);
      if (text.length < 100) {
        return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan CV berisi teks, bukan tabel gambar atau file hasil scan.' };
      }
      return { success: true, text };
    }

    // PDF: use Claude document API
    const response = await callClaude(
      env,
      'Ekstrak semua teks dari dokumen CV ini. Output hanya teks mentah tanpa formatting tambahan.',
      parsed,
      2000
    );

    if (response?.stop_reason === 'max_tokens') {
      return { success: false, error: 'CV kamu terlalu panjang untuk diproses. Coba ringkas atau pisahkan menjadi beberapa halaman.' };
    }

    const text = response?.content?.[0]?.text || '';

    if (text.length < 100) {
      return { success: false, error: 'CV kamu tidak bisa dibaca. Pastikan CV dalam format teks, bukan hasil scan atau foto.' };
    }

    return { success: true, text };
  } catch (e) {
    console.error('[extractCVText]', e.message);
    return { success: false, error: 'Gagal memproses file CV: ' + e.message };
  }
}

// ---- DOCX text extraction (client-side ZIP+XML parsing) ----

export async function extractTextFromDOCX(base64Data) {
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const target = 'word/document.xml';

  for (let i = 0; i < bytes.length - 30; i++) {
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
      while (end < bytes.length - 4) {
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
