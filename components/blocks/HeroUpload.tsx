const SHADOW = "0 18px 44px rgba(15, 23, 42, 0.08)";
const SERIF = { fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif', letterSpacing: "-0.03em" } as const;

export default function HeroUpload() {
  return (
    <section
      className="relative overflow-hidden rounded-[24px] px-5 py-8 text-center sm:px-8 sm:py-10 lg:px-10 lg:py-12 backdrop-blur-[14px]"
      style={{ border: "1px solid rgba(148,163,184,0.18)", background: "rgba(255,255,255,0.84)", boxShadow: SHADOW }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(140deg,rgba(255,255,255,0.52),transparent 40%),radial-gradient(circle at top right,rgba(37,99,235,0.08),transparent 25%)" }} />
      <div className="relative z-[1] mx-auto flex max-w-3xl flex-col items-center">
        <div className="max-w-2xl">
          <h1
            className="text-[clamp(2rem,6vw,4.4rem)] leading-[0.95] m-0 max-w-[20ch] mx-auto"
            style={{ ...SERIF, textWrap: "balance" } as React.CSSProperties}
          >
            Gas atau skip? Tahu dulu peluang kamu sebelum apply.
          </h1>
          <p className="mt-5 max-w-xl mx-auto text-[#6b7280] text-base leading-[1.6]">
            Upload CV + job description.<br />Tahu peluang interview kamu dalam 30 detik.
          </p>
        </div>
        <div className="mt-8 w-full">
          <a
            href="upload.html"
            className="inline-flex items-center justify-center min-h-[56px] rounded-[16px] px-[26px] py-4 text-white text-base font-bold no-underline transition-all hover:-translate-y-[1px] w-full sm:w-auto"
            style={{ background: "linear-gradient(180deg,#2563eb,#1d4ed8)", boxShadow: SHADOW }}
          >
            Cek Peluang Saya
          </a>
          <p className="mt-4 text-[#6b7280] text-xs sm:text-[13px] leading-[1.5]">
            CV tidak disimpan • tanpa registrasi • hasil dalam ±30 detik
          </p>
        </div>
      </div>
    </section>
  );
}
