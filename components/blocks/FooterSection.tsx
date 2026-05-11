import React from 'react';

export default function FooterSection({ ref }: { ref?: React.Ref<HTMLElement> }) {
  return (
    <footer ref={ref} className="border-t border-slate-100 py-12 pb-20 md:pb-12 text-center text-sm text-slate-500">
      <p>© 2026 GasLamar · Gas apply aja dulu</p>
      <p className="mt-3 leading-relaxed text-slate-400">
        Privasi utama: CV tidak disimpan permanen, tanpa registrasi, diproses otomatis dan dihapus sesuai masa aktif.
      </p>
      <p className="mt-4 space-x-2">
        <a
          href="access.html"
          className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline font-medium"
        >
          Akses CV
        </a>
        <span className="text-slate-300" aria-hidden="true">•</span>
        <a
          href="https://gaslamar.com/privacy.html"
          className="text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          Kebijakan Privasi
        </a>
        <span className="text-slate-300" aria-hidden="true">•</span>
        <a
          href="https://gaslamar.com/terms.html"
          className="text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          Syarat Layanan
        </a>
        <span className="text-slate-300" aria-hidden="true">•</span>
        <a
          href="https://gaslamar.com/accessibility.html"
          className="text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          Aksesibilitas
        </a>
      </p>
    </footer>
  );
}
