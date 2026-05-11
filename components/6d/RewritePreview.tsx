import type { RewritePreviewData } from '@/types/result';

interface Props {
  preview: RewritePreviewData | null;
}

export default function RewritePreview({ preview }: Props) {
  if (!preview) return (
    <p data-testid="rewrite-after" className="text-sm text-slate-400 leading-relaxed">
      CV terlalu singkat untuk contoh perbaikan.
    </p>
  );

  return (
    <div className="mb-5 px-1">
      <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">Contoh perbaikan CV kamu</p>
      <div className="text-sm text-slate-400 line-through leading-relaxed">
        <span aria-hidden="true">❌</span><span className="sr-only">Sebelum: </span> {preview.before}
      </div>
      <div data-testid="rewrite-after" className="text-sm text-slate-800 mt-2 leading-relaxed font-medium">
        <span aria-hidden="true">✅</span><span className="sr-only">Sesudah: </span> {preview.after}
      </div>
      {preview.note && (
        <p className="text-sm text-slate-500 mt-1">{preview.note}</p>
      )}
      {preview.personalized && (
        <p className="text-sm text-slate-400 mt-2">
          Perbaikan ini menggunakan informasi dari CV kamu (tanpa menambahkan data baru)
        </p>
      )}
    </div>
  );
}
