/**
 * staging-cvs.js — GasLamar
 * Staging-only test panel: 8 CV edge-case templates for QA.
 * Renders only on staging.gaslamar.pages.dev or localhost.
 * Requires upload.js to be loaded first (accesses selectedFile, cvText, showFilePreview).
 */

(function () {
  const IS_STAGING =
    window.location.hostname === 'staging.gaslamar.pages.dev' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (!IS_STAGING) return;

  // ---- Job Descriptions for test cases ----

  const JD_PM = `Product Manager – Teknologi
Tanggung Jawab:
- Mendefinisikan roadmap dan strategi produk
- Bekerja sama dengan tim engineering untuk deliver fitur
- Menganalisis data pengguna dan feedback pasar
- Memimpin tim cross-functional 8–15 orang

Requirements:
- Min. 3 tahun pengalaman sebagai Product Manager
- Kemampuan analisis data kuat (SQL, Google Analytics)
- Pengalaman Agile/Scrum
- Komunikasi dan presentasi yang sangat baik
- S1 semua jurusan, diutamakan Teknik/Bisnis`;

  const JD_SWE = `Software Engineer – Backend
Tanggung Jawab:
- Desain dan implementasi REST API
- Menulis unit dan integration tests
- Code review dan dokumentasi teknis
- Kolaborasi dengan tim product dan design

Requirements:
- Min. 2 tahun pengalaman backend development
- Mahir Python, Java, atau Node.js
- Pengalaman dengan database relasional (PostgreSQL/MySQL)
- Familiar dengan cloud platform (AWS/GCP)
- S1 Ilmu Komputer atau bidang terkait`;

  // ---- CV Templates ----

  const CVID = {};
  const CVEN = {};

  // CV 1 – Scanned / Unreadable (< 100 chars → triggers server rejection)
  CVID[1] = `R3sum3 Puti W1dY4
T3L: 082xxxxx
Eduk4si S1 [tak terbaca]
Pengal4man manajer`;

  CVEN[1] = `R3sum3 Puti W1dY4
T3L: 082xxxxx
Educ4tion S1 [unreadable]
W0rk exp manager`;

  // CV 2 – Keyword Stuffing
  CVID[2] = `ANDI PRAKOSO
Jakarta | andi@email.com | 081234567890

RINGKASAN
Python JavaScript TypeScript React Angular Vue Node.js Docker Kubernetes AWS GCP Azure CI/CD DevOps Agile Scrum Kanban Machine Learning AI Deep Learning TensorFlow PyTorch Data Science Big Data Hadoop Spark REST API GraphQL Microservices Cloud Native Full Stack Git Jenkins Terraform Redis MongoDB PostgreSQL MySQL Elasticsearch Kafka Blockchain Web3 NFT DeFi AR VR Metaverse

PENGALAMAN
2019 – sekarang: Software Engineer
- Python JavaScript TypeScript Docker Kubernetes AWS microservices agile scrum CI/CD
- Machine learning deep learning TensorFlow PyTorch data science big data
- React Angular Vue full stack REST GraphQL mobile iOS Android
- Redis MongoDB PostgreSQL MySQL Elasticsearch Kafka RabbitMQ

PENDIDIKAN
S1 Ilmu Komputer – Universitas Indonesia (2019)

KEAHLIAN
Python JavaScript TypeScript Java Go Rust C++ PHP Ruby Swift Kotlin R MATLAB SQL NoSQL HTML CSS Bootstrap Tailwind jQuery React Angular Vue Svelte Node Express Django Flask FastAPI Spring Laravel`;

  CVEN[2] = `ANDI PRAKOSO
Jakarta | andi@email.com | 081234567890

SUMMARY
Python JavaScript TypeScript React Angular Vue Node.js Docker Kubernetes AWS GCP Azure CI/CD DevOps Agile Scrum Kanban Machine Learning AI Deep Learning TensorFlow PyTorch Data Science Big Data Hadoop Spark REST API GraphQL Microservices Full Stack Git Jenkins Terraform Redis MongoDB PostgreSQL MySQL Elasticsearch Kafka Blockchain Web3

EXPERIENCE
2019 – present: Software Engineer
- Python JavaScript TypeScript Docker Kubernetes AWS microservices agile CI/CD
- Machine learning TensorFlow PyTorch data science big data
- React Angular Vue full stack REST GraphQL mobile iOS Android

EDUCATION
B.Sc. Computer Science – University of Indonesia (2019)

SKILLS
Python JavaScript TypeScript Java Go Rust C++ PHP Ruby Swift Kotlin SQL NoSQL HTML CSS Bootstrap Tailwind jQuery React Angular Vue Svelte Node Express Django Flask FastAPI Spring`;

  // CV 3 – Overclaim / Unrealistic
  CVID[3] = `RIZKY MAHARDHIKA, 22 tahun
Jakarta | rizky@email.com | 081298765432

RINGKASAN PROFESIONAL
Inovator teknologi kelas dunia dengan 15 tahun pengalaman memimpin transformasi digital global. Penemu algoritma machine learning yang digunakan oleh 3 miliar pengguna. Mantan CTO sekaligus CEO di 5 perusahaan Fortune 500 secara bersamaan.

PENGALAMAN
2022 – sekarang: Founder & CEO – 3 startup unicorn senilai $100M+ masing-masing
- Memimpin tim 500+ engineer di 12 negara
- Meningkatkan revenue perusahaan dari $0 menjadi $500M dalam 6 bulan
- Menciptakan bahasa pemrograman baru yang lebih cepat dari C++

2020 – 2022: VP Engineering – Google, Meta, Amazon (semua sekaligus)
- Merancang arsitektur yang digunakan oleh seluruh internet
- Menyelamatkan perusahaan dari kebangkrutan $10T

2018 – 2020: Magang (SMA kelas 11)
- Menemukan kerentanan keamanan di semua bank dunia

PENDIDIKAN
Dropout – terlalu sibuk memimpin perusahaan global`;

  CVEN[3] = `RIZKY MAHARDHIKA, age 22
Jakarta | rizky@email.com | 081298765432

PROFESSIONAL SUMMARY
World-class technology innovator with 15 years of experience leading global digital transformations. Inventor of machine learning algorithms used by 3 billion users. Former simultaneous CTO and CEO at 5 Fortune 500 companies.

EXPERIENCE
2022 – present: Founder & CEO – 3 unicorn startups valued at $100M+ each
- Led team of 500+ engineers across 12 countries
- Grew revenue from $0 to $500M in 6 months
- Created a new programming language faster than C++

2020 – 2022: VP Engineering – Google, Meta, Amazon (all simultaneously)
- Designed the architecture powering the entire internet
- Saved companies from $10T bankruptcy

2018 – 2020: Intern (high school, age 16)
- Discovered security vulnerabilities in all world banks

EDUCATION
Dropped out of university — too busy running global companies`;

  // CV 4 – Mixed Language
  CVID[4] = `SARI DEWI LESTARI
Jakarta | sari@email.com | 081345678901

PROFESSIONAL SUMMARY / RINGKASAN
I am a dedicated product manager dengan passion di bidang teknologi. My experience spans across various industries dan saya sangat excited untuk bergabung dengan tim yang dinamis. I believe that kolaborasi adalah kunci kesuksesan in any product development environment.

WORK EXPERIENCE / PENGALAMAN KERJA
2021 – sekarang: Product Manager at PT Teknologi Maju
- Led the development of fitur-fitur baru yang meningkatkan user engagement by 25%
- Bekerja sama dengan tim engineering dan design untuk deliver quarterly roadmap on time
- Managed backlog dan melakukan prioritization berdasarkan user research dan business impact

2019 – 2021: Associate PM di Startup Fintech
- Assist senior PM dalam mengelola product lifecycle dari ideation sampai launch
- Conducting user interviews dan analyzing data untuk inform product decisions

EDUCATION / PENDIDIKAN
S1 Manajemen Bisnis – Universitas Gadjah Mada (2019), IPK 3.6/4.0

SKILLS / KEAHLIAN
Product roadmap, Agile/Scrum, SQL, Figma, user research, A/B testing, JIRA`;

  CVEN[4] = `SARI DEWI LESTARI
Jakarta | sari@email.com | 081345678901

PROFESSIONAL SUMMARY
I am a dedicated product manager dengan passion di bidang teknologi. My experience spans various industries and saya sangat excited to join a dynamic team. I believe collaboration is kunci kesuksesan in every product development environment.

WORK EXPERIENCE
2021 – present: Product Manager at PT Teknologi Maju
- Led development of new features yang increased user engagement by 25%
- Collaborated with engineering dan design teams to deliver quarterly roadmap on time
- Managed backlog dan performed prioritization based on user research

2019 – 2021: Associate PM at Fintech Startup
- Assisted senior PM dalam managing product lifecycle from ideation to launch
- Conducted user interviews dan analyzed data to inform product decisions

EDUCATION
B.Sc. Business Management – Gadjah Mada University (2019), GPA 3.6/4.0

SKILLS
Product roadmap, Agile/Scrum, SQL, Figma, user research, A/B testing, JIRA`;

  // CV 5 – Too Short
  CVID[5] = `BUDI SANTOSO
Jakarta | budi@gmail.com | 081234567890

Pernah kerja di perusahaan selama 3 tahun sebagai staf.
Bisa komputer dan Microsoft Office.
Mau bekerja keras dan belajar.
Siap ditempatkan di mana saja.`;

  CVEN[5] = `BUDI SANTOSO
Jakarta | budi@gmail.com | 081234567890

Worked at a company for 3 years as a staff member.
Can use computers and Microsoft Office.
Willing to work hard and learn new things.
Available for any placement.`;

  // CV 6 – Irrelevant Experience (Chef → Product Manager)
  CVID[6] = `RINI ANGGRAENI
Bandung | rini@email.com | 082198765432

RINGKASAN
Kepala koki berpengalaman dengan 8 tahun di industri kuliner. Spesialisasi masakan fusion Asia-Eropa dan manajemen dapur komersial skala besar.

PENGALAMAN KERJA
2018 – sekarang: Head Chef – Hotel Bintang Lima Grand Savoy Bandung
- Memimpin tim 25 koki dan staf dapur
- Merancang menu musiman untuk 3 restoran hotel (200+ item)
- Mengelola anggaran bahan baku Rp 800 juta per tahun
- Mempertahankan standar kebersihan pangan (ISO 22000)

2015 – 2018: Sous Chef – Restoran Le Jardin, Jakarta
- Mengkoordinasi persiapan 400+ cover per malam
- Melatih 10 koki junior dalam teknik memasak Perancis

2013 – 2015: Line Cook – Fine dining Jakarta

PENDIDIKAN
D3 Tata Boga – Sekolah Tinggi Pariwisata Bandung (2013)
Sertifikat Culinary Arts – Le Cordon Bleu Online (2016)

KEAHLIAN
Masakan French/Italian/Asian Fusion, manajemen dapur, food costing, HACCP, food safety, inventory`;

  CVEN[6] = `RINI ANGGRAENI
Bandung | rini@email.com | 082198765432

SUMMARY
Experienced head chef with 8 years in the culinary industry. Specializing in Asian-European fusion cuisine and large-scale commercial kitchen management.

WORK EXPERIENCE
2018 – present: Head Chef – Five-Star Hotel Grand Savoy Bandung
- Led team of 25 chefs and kitchen staff
- Designed seasonal menus for 3 hotel restaurants (200+ items)
- Managed Rp 800M annual ingredient budget
- Maintained food safety standards (ISO 22000)

2015 – 2018: Sous Chef – Le Jardin Restaurant, Jakarta
- Coordinated preparation for 400+ covers per night
- Trained 10 junior chefs in French cooking techniques

2013 – 2015: Line Cook – Fine dining, Jakarta

EDUCATION
D3 Culinary Arts – Bandung School of Tourism (2013)
Culinary Arts Certificate – Le Cordon Bleu Online (2016)

SKILLS
French/Italian/Asian Fusion cooking, kitchen management, food costing, HACCP, food safety, inventory`;

  // CV 7 – Formatting Breaker
  CVID[7] = `|||||  C  V  ——  D I A N   P E R M A T A  |||||
============================================
*** KONTAK: dian@email.com   ||   083187654321 ***
============================================

>>>>>>>>>> PENGALAMAN KERJA <<<<<<<<<<
[2020 – SEKARANG]   :::   PT   DIGITAL   INOVASI
Jabatan   :   :   :   Senior   Product   Manager

•••  Memimpin    pengembangan    fitur    aplikasi    mobile    (50K    DAU)
•••  Koordinasi    tim    engineering    [6]    +    design    [3]
•••  Meningkatkan    konversi    checkout    18%    dalam    2    sprint
•••  Roadmap    Q1✓    Q2✓    Q3⟳    Q4—

//// [2018 – 2020] //// Startup FinPay ////
>>> Associate Product Manager <<<
- - - Riset pengguna 40+ wawancara --- PRD 12 fitur --- on time ---

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
>>>>>>>>>> PENDIDIKAN <<<<<<<<<<
S1   Sistem   Informasi   ——   Universitas   Bina   Nusantara   ——   IPK   3.75

***  KEAHLIAN  ***
Product Management /// Agile /// SQL /// Figma /// Analytics /// JIRA
===========================================`;

  CVEN[7] = `|||||  C  V  ——  D I A N   P E R M A T A  |||||
============================================
*** CONTACT: dian@email.com   ||   083187654321 ***
============================================

>>>>>>>>>> WORK EXPERIENCE <<<<<<<<<<
[2020 – PRESENT]   :::   PT   DIGITAL   INOVASI
Title   :   :   :   Senior   Product   Manager

•••  Led    mobile    app    feature    development    (50K    DAU)
•••  Coordinated    engineering    [6]    +    design    [3]
•••  Improved    checkout    conversion    18%    in    2    sprints
•••  Roadmap    Q1✓    Q2✓    Q3⟳    Q4—

//// [2018 – 2020] //// FinPay Startup ////
>>> Associate Product Manager <<<
- - - User research 40+ interviews --- PRD 12 features --- on time ---

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
>>>>>>>>>> EDUCATION <<<<<<<<<<
B.Sc.   Information   Systems   ——   Bina   Nusantara   University   ——   GPA   3.75

***  SKILLS  ***
Product Management /// Agile /// SQL /// Figma /// Analytics /// JIRA
===========================================`;

  // CV 8 – Trick CV (looks good but vague/weak)
  CVID[8] = `HENDRA KUSUMA
Jakarta | hendra@email.com | 081456789012 | linkedin.com/in/hendrakusuma

RINGKASAN PROFESIONAL
Product Manager berpengalaman dengan rekam jejak kuat dalam manajemen produk. Bersemangat tentang inovasi dan pengembangan produk yang berdampak. Terbiasa bekerja dalam lingkungan yang dinamis dan bergerak cepat.

PENGALAMAN KERJA

2022 – sekarang: Product Manager – PT Maju Digital, Jakarta
- Bertanggung jawab atas pengembangan fitur-fitur produk
- Berkolaborasi dengan tim engineering dan design untuk mengeksekusi roadmap
- Membantu dalam proses perencanaan dan prioritisasi produk
- Terlibat dalam riset pengguna dan pengumpulan feedback
- Berpartisipasi dalam sprint planning dan retrospective reguler

2020 – 2022: Junior Product Manager – StartupXYZ, Jakarta
- Membantu senior PM dalam mengelola backlog produk
- Terlibat dalam pembuatan dokumen spesifikasi produk
- Berkontribusi pada analisis kompetitor
- Membantu dalam koordinasi antar tim

2019 – 2020: Business Analyst – Konsultan ABC
- Menganalisis kebutuhan bisnis klien
- Membantu dalam pembuatan laporan dan presentasi

PENDIDIKAN
S1 Manajemen – Universitas Trisakti, Jakarta (2019) – IPK 3.2/4.0

KEAHLIAN
Microsoft Office, JIRA, Confluence, Trello, Figma (dasar), Google Analytics (dasar), komunikasi`;

  CVEN[8] = `HENDRA KUSUMA
Jakarta | hendra@email.com | 081456789012 | linkedin.com/in/hendrakusuma

PROFESSIONAL SUMMARY
Experienced Product Manager with a strong track record in product management. Passionate about innovation and developing impactful products. Accustomed to working in dynamic and fast-paced environments.

WORK EXPERIENCE

2022 – present: Product Manager – PT Maju Digital, Jakarta
- Responsible for product feature development
- Collaborated with engineering and design teams to execute roadmap
- Assisted in product planning and prioritization processes
- Involved in user research and feedback gathering
- Participated in regular sprint planning and retrospectives

2020 – 2022: Junior Product Manager – StartupXYZ, Jakarta
- Assisted senior PM in managing product backlog
- Involved in writing product specification documents
- Contributed to competitor analysis
- Helped with cross-team coordination

2019 – 2020: Business Analyst – Consulting ABC
- Analyzed client business requirements
- Assisted in report and presentation preparation

EDUCATION
B.Sc. Management – Trisakti University, Jakarta (2019) – GPA 3.2/4.0

SKILLS
Microsoft Office, JIRA, Confluence, Trello, Figma (basic), Google Analytics (basic), communication`;

  // ---- Panel metadata ----

  const CV_META = [
    { id: 1, emoji: '🖨️', label: 'Scanned / Unreadable',   desc: 'OCR garbage, <100 chars → server rejects',         jd: JD_PM  },
    { id: 2, emoji: '🔑', label: 'Keyword Stuffing',        desc: '60+ buzzwords, zero substance',                    jd: JD_SWE },
    { id: 3, emoji: '🦄', label: 'Overclaim / Unrealistic', desc: 'Age 22, 15yr exp, 3 unicorns, invented ML',        jd: JD_PM  },
    { id: 4, emoji: '🌐', label: 'Mixed Language',           desc: 'ID/EN alternating mid-sentence',                  jd: JD_PM  },
    { id: 5, emoji: '📄', label: 'Too Short',                desc: '5 lines, no real content',                        jd: JD_PM  },
    { id: 6, emoji: '👨‍🍳', label: 'Irrelevant Experience',   desc: 'Head chef applying for Product Manager',          jd: JD_PM  },
    { id: 7, emoji: '⚡', label: 'Formatting Breaker',       desc: 'Special chars, triple spaces, ASCII art',          jd: JD_PM  },
    { id: 8, emoji: '🎭', label: 'Trick CV (weak)',          desc: '"Responsible for…", no numbers, all vague',        jd: JD_PM  },
  ];

  // ---- Inject test CV into upload form ----

  window.loadTestCV = function (cvId, lang) {
    const meta = CV_META.find(m => m.id === cvId);
    const content = lang === 'id' ? CVID[cvId] : CVEN[cvId];
    if (!meta || !content) return;

    const filename = `TEST-CV${cvId}-${meta.label.replace(/[^a-zA-Z0-9]/g, '-')}-${lang.toUpperCase()}.txt`;

    // Create a real File object so the file input reflects the loaded CV
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], filename, { type: 'text/plain', lastModified: Date.now() });
    window.selectedFile = file;
    window.cvText = JSON.stringify({ type: 'txt', data: content });

    // Populate the actual <input id="cv-file"> so "Ganti file" & label show correctly
    try {
      const fileInput = document.getElementById('cv-file');
      if (fileInput && typeof DataTransfer !== 'undefined') {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
      }
    } catch (_) { /* DataTransfer not available in all test environments */ }

    if (typeof showFilePreview === 'function') {
      showFilePreview(window.selectedFile);
    }

    // Clear previous errors/warnings
    const fileErr = document.getElementById('file-error');
    if (fileErr) { fileErr.textContent = ''; fileErr.classList.add('hidden'); }
    const cvWarn = document.getElementById('cv-text-warning');
    if (cvWarn) cvWarn.classList.add('hidden');

    // Pre-fill job description
    const jdEl = document.getElementById('job-desc');
    if (jdEl) {
      jdEl.value = meta.jd;
      if (typeof updateCharCount === 'function') updateCharCount();
    }

    // Green flash on the card
    const card = document.getElementById(`stg-card-${cvId}`);
    if (card) {
      card.style.outline = '2px solid #10B981';
      setTimeout(() => { card.style.outline = ''; }, 1200);
    }

    // Scroll to JD
    if (jdEl) jdEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ---- Render panel ----

  function render() {
    const container = document.querySelector('.container');
    if (!container) return;

    const panel = document.createElement('div');
    panel.id = 'staging-panel';
    panel.style.cssText = [
      'max-width:880px', 'margin:0 auto 1rem', 'border-radius:20px',
      'background:#FFF7ED', 'border:1.5px solid #FB923C', 'overflow:hidden',
      "font-family:'Inter',sans-serif",
    ].join(';');

    panel.innerHTML = `
      <div id="stg-header"
        style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;cursor:pointer;user-select:none;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="background:#EA580C;color:white;font-size:0.7rem;font-weight:700;padding:0.15rem 0.5rem;border-radius:6px;">STAGING</span>
          <span style="font-size:0.9rem;font-weight:600;color:#9A3412;">🧪 Test CVs — 8 edge case templates</span>
        </div>
        <span id="stg-caret" style="font-size:0.8rem;color:#EA580C;">▼ expand</span>
      </div>
      <div id="stg-body" style="display:none;padding:0 1.25rem 1.25rem;">
        <p style="font-size:0.75rem;color:#92400E;margin:0 0 0.9rem;">
          Click <strong>Load ID</strong> or <strong>Load EN</strong> to auto-fill CV + JD.<br>
          CV1 is intentionally &lt;100 chars — triggers server-side scan rejection.
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.6rem;">
          ${CV_META.map(m => `
            <div id="stg-card-${m.id}" style="background:white;border:1px solid #FED7AA;border-radius:12px;padding:0.7rem 0.9rem;transition:outline 0.15s;">
              <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                <span style="font-size:1.2rem;line-height:1.2;">${m.emoji}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.82rem;font-weight:700;color:#111827;">CV${m.id} — ${m.label}</div>
                  <div style="font-size:0.72rem;color:#6B7280;margin-top:0.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${m.desc}">${m.desc}</div>
                </div>
              </div>
              <div style="display:flex;gap:0.4rem;margin-top:0.55rem;">
                <button onclick="loadTestCV(${m.id},'id')"
                  style="flex:1;background:#FFF7ED;border:1px solid #FB923C;color:#9A3412;border-radius:8px;padding:0.3rem 0;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit;">
                  Load ID
                </button>
                <button onclick="loadTestCV(${m.id},'en')"
                  style="flex:1;background:#FFF7ED;border:1px solid #FB923C;color:#9A3412;border-radius:8px;padding:0.3rem 0;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit;">
                  Load EN
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;

    panel.querySelector('#stg-header').addEventListener('click', () => {
      const body = document.getElementById('stg-body');
      const caret = document.getElementById('stg-caret');
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      caret.textContent = open ? '▲ collapse' : '▼ expand';
    });

    container.insertBefore(panel, container.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
