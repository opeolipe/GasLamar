import { generateRewritePreview, generateRewrite } from '@/lib/rewriteUtils';
import { extractSampleLine }                       from '@/lib/cvUtils';

interface Props {
  issue:    string;
  cvText?:  string;
}

export default function RewritePreview({ issue, cvText }: Props) {
  const sample  = cvText ? extractSampleLine(cvText) : null;
  const preview = sample ? generateRewrite(issue, sample) : generateRewritePreview(issue);
  if (!preview) return null;

  return (
    <div className="mb-5 rounded-[16px] px-4 py-3" style={{ background: 'rgba(248,250,252,0.8)', border: '1px solid rgba(148,163,184,0.18)' }}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Contoh perbaikan CV kamu</p>
      <div className="text-sm text-slate-400 line-through leading-relaxed">
        ❌ {preview.before}
      </div>
      <div className="text-sm text-slate-800 mt-2 leading-relaxed font-medium">
        ✅ {preview.after}
      </div>
      {preview.note && (
        <p className="text-xs text-slate-500 mt-1">{preview.note}</p>
      )}
    </div>
  );
}
