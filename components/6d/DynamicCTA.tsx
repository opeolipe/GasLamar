import { getUrgencyMessage } from '@/lib/resultUtils';

const CTA_COPY: Record<string, string> = {
  portfolio:        'Tambahkan bukti hasil kerja di CV saya',
  recruiter_signal: 'Bikin CV saya lebih menarik di 7 detik pertama',
  north_star:       'Sesuaikan CV saya dengan job ini',
  effort:           'Tunjukkan apa yang harus saya perbaiki dulu',
  risk:             'Update CV saya biar tetap relevan',
};

const FALLBACK = 'Lihat versi lengkap CV saya';

interface Props {
  issueKey?: string | null;
  score?:    number;
}

export default function DynamicCTA({ issueKey, score }: Props) {
  const label   = (issueKey && CTA_COPY[issueKey]) || FALLBACK;
  const urgency = getUrgencyMessage(issueKey, score ?? 10);

  function scrollToPricing() {
    document.getElementById('pricing-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="mt-4">
      <button
        onClick={scrollToPricing}
        className="w-full rounded-full bg-blue-600 hover:bg-blue-700 text-white py-3 font-medium transition-colors cursor-pointer text-sm"
        style={{ fontFamily: 'inherit' }}
      >
        🔓 {label}
      </button>
      {urgency && (
        <p className="text-xs text-slate-500 text-center mt-2">
          {urgency}
        </p>
      )}
      <p className="text-xs text-slate-500 text-center mt-2">
        Dapatkan versi CV yang sudah diperbaiki &amp; siap kirim
      </p>
    </div>
  );
}
