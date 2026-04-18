export default function FooterSection() {
  return (
    <footer className="border-t border-slate-100 py-8 text-center text-sm text-slate-500">
      <p>© 2026 GasLamar — CV optimizer yang berpikir seperti HR, bukan sekadar AI generik.</p>
      <p className="mt-2">
        🔒 Privasi utama: CV tidak disimpan, tanpa registrasi, hasil download hanya untukmu.
      </p>
      <p className="mt-2 space-x-2">
        <a
          href="privacy.html"
          className="text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          Kebijakan Privasi
        </a>
        <span className="text-slate-200" aria-hidden="true">·</span>
        <a
          href="terms.html"
          className="text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline"
        >
          Syarat Layanan
        </a>
      </p>
    </footer>
  );
}
