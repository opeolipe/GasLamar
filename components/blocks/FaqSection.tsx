import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ_ITEMS = [
  {
    q: "Apakah CV saya aman?",
    a: "Untuk paket Coba Dulu dan Single, CV kamu dihapus otomatis setelah kamu download (maks 2 jam). Untuk paket 3-Pack dan Job Hunt Pack, CV disimpan selama 30 hari agar kamu bisa kembali generate CV untuk loker berikutnya tanpa upload ulang — lalu dihapus otomatis setelah 30 hari atau saat semua kredit habis. Kami tidak menyimpan CV kamu secara permanen.",
  },
  {
    q: "Format CV apa yang didukung?",
    a: "GasLamar menerima CV dalam format PDF dan DOCX (Word). Pastikan CV kamu adalah file teks — bukan hasil scan atau foto — agar bisa dibaca dengan akurat.",
  },
  {
    q: "Apakah fakta di CV saya akan diubah?",
    a: "Tidak. GasLamar hanya mereframe dan highlight pengalaman yang paling relevan untuk posisi yang kamu lamar. Semua fakta, perusahaan, jabatan, dan tanggal tetap sama persis.",
  },
  {
    q: "Metode pembayaran apa yang tersedia?",
    a: "Pembayaran via Virtual Account (semua bank), QRIS, GoPay, OVO, Dana, dan kartu kredit/debit. Diproses melalui Mayar yang terpercaya.",
  },
  {
    q: "Apa itu paket 3-Pack dan Job Hunt Pack?",
    a: "Paket multi-CV memungkinkan kamu tailoring CV untuk beberapa posisi berbeda dengan harga lebih hemat. Setiap CV dianalisis dan disesuaikan dengan job description masing-masing loker.",
  },
  {
    q: "Bagaimana jika tidak bisa download setelah bayar?",
    a: "Sistem akan otomatis menunggu konfirmasi pembayaran (biasanya 1–2 menit). Jika masih bermasalah, hubungi kami di support@gaslamar.com dengan bukti pembayaran dan kami bantu dalam 24 jam.",
  },
];

export default function FaqSection() {
  return (
    <section className="py-12 max-w-3xl mx-auto">
      <h2 className="text-2xl font-extrabold tracking-tight mb-8">FAQ</h2>
      <Accordion type="single" collapsible className="space-y-3">
        {FAQ_ITEMS.map((item, i) => (
          <AccordionItem
            key={i}
            value={`item-${i}`}
            className="border border-gray-100 rounded-2xl bg-gray-50 overflow-hidden px-2"
          >
            <AccordionTrigger className="px-4 py-5 text-left font-semibold text-slate-800 hover:no-underline [&>svg]:text-slate-400">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-5 text-sm leading-relaxed text-gray-500">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
