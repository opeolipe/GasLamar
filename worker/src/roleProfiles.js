/**
 * Role profiles: keyword maps, dimension weight biases, and action verb/strength clusters.
 *
 * Used by roleInference.js (Stage 2.5) and generate.js (tailoring mode switch).
 * All scores are pure-JS — no LLM involvement here.
 */

/** Keyword sets used to classify the candidate's primary role from CV text. */
export const ROLE_KEYWORDS = {
  teknik: [
    'teknik', 'mechanical', 'civil', 'electrical', 'chemical', 'industrial',
    'manufaktur', 'manufacturing', 'produksi', 'production', 'maintenance',
    'quality control', 'quality assurance', 'plant', 'process', 'welding',
    'fabrication', 'structural', 'geodesi', 'k3', 'safety engineer',
  ],
  creative: [
    'design', 'desain', 'designer', 'graphic', 'ui', 'ux', 'creative',
    'visual', 'fotografer', 'photographer', 'videografer', 'videographer',
    'animator', 'illustrator', 'content creator', 'branding', 'adobe',
    'figma', 'sketch', 'motion graphic', 'art director',
  ],
  kesehatan: [
    'dokter', 'perawat', 'nurse', 'apoteker', 'farmasi', 'fisioterapi',
    'bidan', 'radiologi', 'medical', 'healthcare', 'klinik', 'rumah sakit',
    'hospital', 'laboratorium', 'tenaga medis', 'kesehatan', 'analis kesehatan',
  ],
  pendidikan: [
    'guru', 'teacher', 'dosen', 'trainer', 'instruktur', 'tutor', 'pengajar',
    'pendidik', 'fasilitator', 'kurikulum', 'curriculum', 'teaching',
    'learning', 'training', 'education', 'sekolah', 'universitas',
  ],
  hospitality: [
    'hotel', 'restoran', 'restaurant', 'chef', 'barista', 'waiter', 'waitress',
    'bartender', 'housekeeping', 'concierge', 'catering', 'food', 'beverage',
    'front office', 'guest', 'hospitality', 'kitchen', 'kuliner', 'sommelier',
  ],
  customer_service: [
    'customer', 'service', 'passenger', 'client', 'hospitality', 'attendant',
    'pelayanan', 'pelanggan', 'complaint', 'helpdesk', 'support', 'call center',
  ],
  data: [
    'data', 'analyst', 'sql', 'python', 'tableau', 'statistics', 'statistik',
    'reporting', 'dashboard', 'bi', 'analytics', 'insight', 'excel analyst',
  ],
  marketing: [
    'marketing', 'social media', 'campaign', 'brand', 'content', 'konten',
    'pemasaran', 'seo', 'ads', 'digital marketing', 'copywriting', 'influencer',
  ],
  operations: [
    'operations', 'logistik', 'supply chain', 'inventory', 'distribution',
    'operasional', 'gudang', 'warehouse', 'procurement', 'purchasing', 'ekspedisi',
  ],
  finance: [
    'finance', 'accounting', 'audit', 'tax', 'banking', 'keuangan', 'akuntan',
    'pajak', 'controller', 'treasury', 'budgeting', 'laporan keuangan',
  ],
  engineering: [
    'software', 'engineer', 'developer', 'system', 'infrastructure', 'programmer',
    'frontend', 'backend', 'fullstack', 'devops', 'mobile', 'javascript', 'java',
  ],
  sales: [
    'sales', 'account', 'business development', 'negotiation', 'revenue',
    'penjualan', 'target', 'closing', 'prospek', 'upsell', 'cross-sell',
  ],
  hr: [
    'hrd', 'human resource', 'rekrut', 'talent', 'people', 'sdm', 'recruitment',
    'payroll', 'employee', 'training', 'onboarding', 'hrga',
  ],
  admin: [
    'admin', 'administrasi', 'general affair', 'office', 'sekretaris', 'filing',
    'dokumentasi', 'kesekretariatan', 'korespondensi', 'surat-menyurat',
  ],
};

/** Fallback weights used when no role profile is matched (all 1.0 = no bias). */
export const DEFAULT_WEIGHTS = {
  north_star:       1.0,
  recruiter_signal: 1.0,
  effort:           1.0,
  opportunity_cost: 1.0,
  risk:             1.0,
  portfolio:        1.0,
};

/**
 * Per-role profiles consumed by two subsystems:
 *   1. weightBias — multiplied onto the raw 6D scores (replaces unweighted totals)
 *   2. Tailoring prompts (keyStrengths, actionVerbs, commonResponsibilities)
 *      injected when JD quality is 'low' (inferred mode)
 */
export const ROLE_PROFILES = {
  customer_service: {
    label:                   'Customer Service',
    keyStrengths:            ['customer handling', 'complaint resolution', 'service delivery'],
    commonResponsibilities:  ['manage customer interactions', 'resolve issues promptly', 'maintain service standards'],
    actionVerbs:             ['Assisted', 'Resolved', 'Managed', 'Handled', 'Coordinated', 'Membantu', 'Menangani', 'Menyelesaikan'],
    skillCluster:            ['Communication', 'Problem Solving', 'CRM Tools', 'Komunikasi', 'Pelayanan Pelanggan'],
    weightBias: {
      north_star: 1.1, recruiter_signal: 1.0, effort: 0.9,
      opportunity_cost: 0.8, risk: 0.9, portfolio: 1.2,
    },
  },
  data: {
    label:                   'Data & Analytics',
    keyStrengths:            ['data analysis', 'reporting', 'business insights'],
    commonResponsibilities:  ['analyze datasets', 'create dashboards', 'generate actionable reports'],
    actionVerbs:             ['Analyzed', 'Built', 'Developed', 'Designed', 'Extracted', 'Menganalisis', 'Membangun'],
    skillCluster:            ['SQL', 'Python', 'Excel', 'Tableau', 'Data Visualization'],
    weightBias: {
      north_star: 1.2, recruiter_signal: 1.0, effort: 1.0,
      opportunity_cost: 1.0, risk: 1.1, portfolio: 1.2,
    },
  },
  marketing: {
    label:                   'Marketing',
    keyStrengths:            ['campaign management', 'brand awareness', 'content strategy'],
    commonResponsibilities:  ['create and manage content', 'run ad campaigns', 'track and report on metrics'],
    actionVerbs:             ['Launched', 'Managed', 'Created', 'Grew', 'Drove', 'Meningkatkan', 'Mengelola', 'Meluncurkan'],
    skillCluster:            ['Social Media', 'SEO', 'Google Ads', 'Content Creation', 'Analytics'],
    weightBias: {
      north_star: 1.1, recruiter_signal: 1.1, effort: 0.9,
      opportunity_cost: 0.9, risk: 1.0, portfolio: 1.2,
    },
  },
  operations: {
    label:                   'Operasional/Logistik',
    keyStrengths:            ['process management', 'logistics coordination', 'efficiency improvement'],
    commonResponsibilities:  ['coordinate logistics', 'manage inventory', 'optimize operational processes'],
    actionVerbs:             ['Coordinated', 'Managed', 'Streamlined', 'Optimized', 'Mengkoordinasikan', 'Mengelola', 'Mengoptimalkan'],
    skillCluster:            ['Project Management', 'Supply Chain', 'Inventory', 'ERP', 'Logistik'],
    weightBias: {
      north_star: 1.0, recruiter_signal: 0.9, effort: 1.1,
      opportunity_cost: 1.0, risk: 1.0, portfolio: 1.0,
    },
  },
  finance: {
    label:                   'Finance/Akuntansi',
    keyStrengths:            ['financial analysis', 'reporting accuracy', 'compliance'],
    commonResponsibilities:  ['prepare financial reports', 'manage budgets', 'ensure regulatory compliance'],
    actionVerbs:             ['Prepared', 'Audited', 'Analyzed', 'Reconciled', 'Managed', 'Menyusun', 'Mengaudit', 'Menganalisis'],
    skillCluster:            ['Excel', 'SAP', 'Financial Reporting', 'Tax', 'Audit'],
    weightBias: {
      north_star: 1.1, recruiter_signal: 1.0, effort: 1.0,
      opportunity_cost: 1.0, risk: 1.1, portfolio: 0.9,
    },
  },
  engineering: {
    label:                   'IT/Software Engineering',
    keyStrengths:            ['technical proficiency', 'system design', 'problem solving'],
    commonResponsibilities:  ['develop and maintain systems', 'write and review code', 'deploy software'],
    actionVerbs:             ['Built', 'Developed', 'Designed', 'Implemented', 'Deployed', 'Membangun', 'Mengembangkan', 'Merancang'],
    skillCluster:            ['Programming', 'System Design', 'Git', 'API', 'Database'],
    weightBias: {
      north_star: 1.2, recruiter_signal: 0.9, effort: 1.1,
      opportunity_cost: 1.0, risk: 1.2, portfolio: 1.1,
    },
  },
  sales: {
    label:                   'Sales/Business Development',
    keyStrengths:            ['revenue generation', 'client acquisition', 'negotiation'],
    commonResponsibilities:  ['acquire and retain clients', 'hit and exceed revenue targets', 'manage key accounts'],
    actionVerbs:             ['Achieved', 'Grew', 'Exceeded', 'Acquired', 'Closed', 'Mencapai', 'Meningkatkan', 'Mengakuisisi'],
    skillCluster:            ['Negotiation', 'CRM', 'Sales Strategy', 'Presentation', 'Target Management'],
    weightBias: {
      north_star: 1.0, recruiter_signal: 1.1, effort: 1.0,
      opportunity_cost: 0.9, risk: 1.0, portfolio: 1.3,
    },
  },
  hr: {
    label:                   'HRD/People Operations',
    keyStrengths:            ['talent acquisition', 'employee relations', 'HR systems'],
    commonResponsibilities:  ['recruit and onboard talent', 'manage employee relations', 'administer HR programs'],
    actionVerbs:             ['Recruited', 'Managed', 'Coordinated', 'Developed', 'Handled', 'Merekrut', 'Mengelola', 'Mengembangkan'],
    skillCluster:            ['Recruitment', 'HRIS', 'Payroll', 'Training & Development', 'Employee Relations'],
    weightBias: {
      north_star: 1.0, recruiter_signal: 1.1, effort: 0.9,
      opportunity_cost: 1.0, risk: 0.9, portfolio: 1.0,
    },
  },
  admin: {
    label:                   'Administrasi/GA',
    keyStrengths:            ['administrative support', 'document management', 'office coordination'],
    commonResponsibilities:  ['manage and organize documents', 'coordinate office activities', 'support day-to-day operations'],
    actionVerbs:             ['Managed', 'Coordinated', 'Prepared', 'Organized', 'Supported', 'Mengelola', 'Menyusun', 'Mengkoordinasikan'],
    skillCluster:            ['MS Office', 'Filing', 'Correspondence', 'Scheduling', 'Office Administration'],
    weightBias: {
      north_star: 1.0, recruiter_signal: 1.0, effort: 1.0,
      opportunity_cost: 1.0, risk: 0.9, portfolio: 0.9,
    },
  },
  teknik: {
    label:                   'Teknik/Manufaktur',
    keyStrengths:            ['technical expertise', 'process optimization', 'quality management'],
    commonResponsibilities:  ['maintain equipment and production systems', 'ensure quality standards are met', 'optimize manufacturing processes'],
    actionVerbs:             ['Designed', 'Implemented', 'Optimized', 'Maintained', 'Inspected', 'Merancang', 'Mengoptimalkan', 'Memelihara'],
    skillCluster:            ['AutoCAD', 'SOP', 'Quality Control', 'K3', 'Lean Manufacturing'],
    weightBias: {
      // north_star heavily weighted — technical role fit is the primary signal
      north_star: 1.2, recruiter_signal: 0.9, effort: 1.1,
      opportunity_cost: 1.0, risk: 1.0, portfolio: 1.1,
    },
  },
  creative: {
    label:                   'Kreatif/Desain',
    keyStrengths:            ['visual communication', 'creative problem-solving', 'brand consistency'],
    commonResponsibilities:  ['create visual assets and design materials', 'design user-centric interfaces', 'maintain brand identity standards'],
    actionVerbs:             ['Designed', 'Created', 'Developed', 'Illustrated', 'Produced', 'Merancang', 'Menciptakan', 'Mengembangkan'],
    skillCluster:            ['Adobe Creative Suite', 'Figma', 'Typography', 'Branding', 'UI/UX'],
    weightBias: {
      // portfolio highest — work evidence is the primary hiring signal for creative roles
      north_star: 1.1, recruiter_signal: 1.2, effort: 0.9,
      opportunity_cost: 0.9, risk: 0.9, portfolio: 1.4,
    },
  },
  kesehatan: {
    label:                   'Kesehatan/Medis',
    keyStrengths:            ['clinical expertise', 'patient care', 'medical protocols'],
    commonResponsibilities:  ['provide patient care and assessment', 'follow clinical and safety protocols', 'maintain accurate medical records'],
    actionVerbs:             ['Treated', 'Assessed', 'Managed', 'Monitored', 'Administered', 'Menangani', 'Merawat', 'Mengelola'],
    skillCluster:            ['Patient Care', 'Medical Records', 'Clinical Skills', 'K3RS', 'SOP Medis'],
    weightBias: {
      // north_star highest — credentials and specialization matter most; portfolio lower (hard to quantify care)
      north_star: 1.3, recruiter_signal: 0.9, effort: 1.0,
      opportunity_cost: 1.0, risk: 1.1, portfolio: 0.8,
    },
  },
  pendidikan: {
    label:                   'Pendidikan/Pelatihan',
    keyStrengths:            ['curriculum development', 'knowledge transfer', 'learner engagement'],
    commonResponsibilities:  ['design and deliver training or lessons', 'evaluate and track learning outcomes', 'develop curriculum and instructional materials'],
    actionVerbs:             ['Taught', 'Trained', 'Developed', 'Facilitated', 'Mentored', 'Mengajar', 'Melatih', 'Mengembangkan'],
    skillCluster:            ['Curriculum Design', 'LMS', 'Facilitation', 'Assessment', 'Komunikasi'],
    weightBias: {
      north_star: 1.1, recruiter_signal: 1.0, effort: 0.9,
      opportunity_cost: 0.9, risk: 0.9, portfolio: 1.0,
    },
  },
  hospitality: {
    label:                   'Hospitality/F&B',
    keyStrengths:            ['guest experience', 'service excellence', 'operational standards'],
    commonResponsibilities:  ['deliver exceptional guest or customer service', 'maintain food & beverage operational standards', 'coordinate front-of-house or kitchen operations'],
    actionVerbs:             ['Served', 'Managed', 'Coordinated', 'Delivered', 'Maintained', 'Melayani', 'Mengelola', 'Mengkoordinasikan'],
    skillCluster:            ['Guest Service', 'F&B Operations', 'POS System', 'HACCP', 'Hospitality Standards'],
    weightBias: {
      // risk lower — hospitality roles face higher disruption from automation and economic shifts
      north_star: 1.1, recruiter_signal: 1.2, effort: 0.9,
      opportunity_cost: 0.9, risk: 0.8, portfolio: 1.0,
    },
  },
};

/** Returns the profile for a given role key, or null for unknown/missing roles. */
export function getRoleProfile(role) {
  return ROLE_PROFILES[role] ?? null;
}
