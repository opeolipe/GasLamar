/**
 * upload.js — GasLamar
 * Handles: file reading (PDF/DOCX), job description input, send to Worker /analyze
 */

const WORKER_URL = 'https://gaslamar-worker.gaslamar.workers.dev';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_JD_CHARS = 3000;
const MIN_CV_TEXT_LENGTH = 100;

let selectedFile = null;
let cvText = '';

// ---- Drag & Drop ----

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drop-zone-active');
}

function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drop-zone-active');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drop-zone-active');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function removeFile() {
  selectedFile = null;
  cvText = '';
  document.getElementById('drop-idle').classList.remove('hidden');
  document.getElementById('drop-preview').classList.add('hidden');
  document.getElementById('cv-file').value = '';
  hideError('file-error');
}

function processFile(file) {
  hideError('file-error');
  hideError('cv-text-warning');

  // Validate file type by extension + MIME
  const validTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  const validExts = ['.pdf', '.docx'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!validExts.includes(ext) && !validTypes.includes(file.type)) {
    showError('file-error', 'Format file tidak didukung. Gunakan PDF atau DOCX.');
    return;
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    showError('file-error', `Ukuran file terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maksimal 5MB.`);
    return;
  }

  selectedFile = file;
  showFilePreview(file);
  extractTextFromFile(file);
}

function showFilePreview(file) {
  document.getElementById('drop-idle').classList.add('hidden');
  document.getElementById('drop-preview').classList.remove('hidden');
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-size').textContent = formatFileSize(file.size);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ---- Text Extraction ----

async function extractTextFromFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  try {
    if (ext === '.pdf') {
      cvText = await extractFromPDF(file);
    } else if (ext === '.docx') {
      cvText = await extractFromDOCX(file);
    }

    // Validate minimum text length
    if (cvText.trim().length < MIN_CV_TEXT_LENGTH) {
      document.getElementById('cv-text-warning').classList.remove('hidden');
      cvText = '';
    }
  } catch (err) {
    showError('file-error', 'Gagal membaca file. Pastikan file tidak rusak dan coba lagi.');
    cvText = '';
  }
}

async function extractFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Validate PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
        const bytes = new Uint8Array(e.target.result.slice(0, 4));
        if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
          reject(new Error('Bukan file PDF yang valid'));
          return;
        }

        // Use pdf.js if available, otherwise send raw bytes to worker
        // For now we'll send the binary to the worker for server-side extraction
        const base64 = arrayBufferToBase64(e.target.result);
        resolve(JSON.stringify({ type: 'pdf', data: base64 }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

async function extractFromDOCX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // Validate DOCX magic bytes: PK (0x50 0x4B) — ZIP format
        const bytes = new Uint8Array(e.target.result.slice(0, 2));
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
          reject(new Error('Bukan file DOCX yang valid'));
          return;
        }

        const base64 = arrayBufferToBase64(e.target.result);
        resolve(JSON.stringify({ type: 'docx', data: base64 }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---- Character Counter ----

function updateCharCount() {
  const jd = document.getElementById('job-desc');
  const count = jd.value.length;
  document.getElementById('char-count').textContent = count.toLocaleString('id-ID');

  const warning = document.getElementById('char-warning');
  if (count > 2500) {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

// ---- Form Submit ----

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const jobDesc = document.getElementById('job-desc').value.trim();

  // Validate inputs
  if (!selectedFile || !cvText) {
    showError('file-error', 'Mohon upload CV kamu terlebih dahulu.');
    return;
  }

  if (cvText === '') {
    document.getElementById('cv-text-warning').classList.remove('hidden');
    return;
  }

  if (jobDesc.length < 50) {
    showError('jd-error', 'Job description terlalu pendek. Paste bagian Requirements dan Responsibilities.');
    return;
  }

  if (jobDesc.length > MAX_JD_CHARS) {
    showError('jd-error', `Job description terlalu panjang. Maksimal ${MAX_JD_CHARS.toLocaleString('id-ID')} karakter.`);
    return;
  }

  // Prevent double submit
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.classList.add('hidden');
  document.getElementById('loading-state').classList.remove('hidden');
  setLoadingText('Membaca CV kamu...');

  try {
    await analyzeCV(cvText, jobDesc);
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.classList.remove('hidden');
    document.getElementById('loading-state').classList.add('hidden');
    showError('file-error', err.message || 'Terjadi kesalahan. Coba lagi.');
  }
});

async function analyzeCV(cvData, jobDesc) {
  setLoadingText('AI sedang menganalisis CV kamu...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${WORKER_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: cvData, job_desc: jobDesc }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Server error: ${response.status}`);
    }

    const result = await response.json();

    // Save scoring results and server-side key for hasil.html
    // Store cv_text_key (not raw CV bytes) so payment.js can reference
    // the server-side KV entry — no sensitive file data in sessionStorage
    sessionStorage.setItem('gaslamar_scoring', JSON.stringify(result));
    sessionStorage.setItem('gaslamar_cv_key', result.cv_text_key || '');
    sessionStorage.removeItem('gaslamar_cv'); // clear any stale raw CV data

    // Redirect to scoring page
    setLoadingText('Menyiapkan hasil analisis...');
    window.location.href = 'hasil.html';

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Analisis memakan waktu terlalu lama. Coba lagi.');
    }
    throw err;
  }
}

function setLoadingText(text) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text;
}

// ---- Helpers ----

function showError(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// ---- Init: pre-select tier from URL param ----

(function init() {
  const params = new URLSearchParams(location.search);
  const tier = params.get('tier');
  if (tier) {
    sessionStorage.setItem('gaslamar_tier', tier);
  }
})();
