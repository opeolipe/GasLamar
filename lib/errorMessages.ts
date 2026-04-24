export const ERROR_MESSAGES = {
  id: {
    generic:        'Terjadi kesalahan. Coba lagi.',
    loadFailed:     'Gagal memuat data.',
    network:        'Koneksi bermasalah. Periksa internet kamu.',
    sessionExpired: 'Sesi berakhir. Silakan mulai dari awal.',
  },
  en: {
    generic:        'Something went wrong. Try again.',
    loadFailed:     'Failed to load data.',
    network:        'Network issue. Check your connection.',
    sessionExpired: 'Session expired. Please start over.',
  },
} as const;

export type ErrorLang = keyof typeof ERROR_MESSAGES;
export type ErrorKey  = keyof typeof ERROR_MESSAGES.id;
