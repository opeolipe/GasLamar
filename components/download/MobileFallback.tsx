import { useState } from 'react';
import { copyToClipboard } from '@/lib/sessionUtils';

interface Props {
  cvTextId: string;
  cvTextEn: string | null;
  bilingual: boolean;
}

export default function MobileFallback({ cvTextId, cvTextEn, bilingual }: Props) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedEn, setCopiedEn] = useState(false);

  async function handleCopy(text: string, lang: 'id' | 'en') {
    await copyToClipboard(text).catch(() => {});
    if (lang === 'id') {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } else {
      setCopiedEn(true);
      setTimeout(() => setCopiedEn(false), 2000);
    }
  }

  return (
    <div
      className="rounded-[20px] p-5 mb-5"
      style={{ background: 'rgba(254,252,232,0.8)', border: '1px solid #FDE68A' }}
    >
      <p className="text-sm font-semibold text-amber-800 mb-4">
        Tidak bisa download? Salin teks CV di bawah ini
      </p>
      <div className={`grid gap-4 ${bilingual && cvTextEn ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
        <div>
          <p className="text-sm font-semibold text-slate-500 mb-1">Bahasa Indonesia</p>
          <textarea
            readOnly
            rows={8}
            value={cvTextId}
            aria-label="Teks CV Bahasa Indonesia — bisa disalin manual"
            className="w-full text-sm rounded-[12px] p-2 resize-none font-mono outline-none"
            style={{ border: '1px solid #FDE68A', background: 'white' }}
          />
          <button
            onClick={() => handleCopy(cvTextId, 'id')}
            className="text-sm text-blue-600 font-semibold bg-transparent border-none cursor-pointer mt-1 font-[inherit] min-h-[44px] px-2 py-2 inline-flex items-center"
            aria-label="Salin teks CV Bahasa Indonesia ke clipboard"
          >
            {copiedId ? 'Tersalin! ✓' : 'Salin'}
          </button>
        </div>

        {bilingual && cvTextEn && (
          <div>
            <p className="text-sm font-semibold text-slate-500 mb-1">English</p>
            <textarea
              readOnly
              rows={8}
              value={cvTextEn}
              aria-label="CV text in English — can be copied manually"
              className="w-full text-sm rounded-[12px] p-2 resize-none font-mono outline-none"
              style={{ border: '1px solid #FDE68A', background: 'white' }}
            />
            <button
              onClick={() => handleCopy(cvTextEn, 'en')}
              className="text-sm text-blue-600 font-semibold bg-transparent border-none cursor-pointer mt-1 font-[inherit] min-h-[44px] px-2 py-2 inline-flex items-center"
              aria-label="Copy English CV text to clipboard"
            >
              {copiedEn ? 'Copied! ✓' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
