import { generateRewritePreview } from '@/lib/rewriteUtils';

interface Props {
  issue:       string;
  sampleText?: string;
}

export default function RewritePreview({ issue, sampleText }: Props) {
  const preview = generateRewritePreview(issue, sampleText);
  if (!preview) return null;

  return (
    <div className="mb-5 rounded-[16px] px-4 py-3" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Contoh perbaikan</p>
      <div className="text-sm text-slate-400 line-through leading-relaxed">
        ❌ {preview.before}
      </div>
      <div className="text-sm text-slate-800 mt-2 leading-relaxed font-medium">
        ✅ {preview.after}
      </div>
    </div>
  );
}
