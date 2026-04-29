/**
 * Role profiles: keyword maps, dimension weight biases, and action verb/strength clusters.
 *
 * Used by roleInference.js (Stage 2.5) and generate.js (tailoring mode switch).
 * All scores are pure-JS — no LLM involvement here.
 */

/** Keyword sets used to classify the candidate's primary role from CV text. */
export const ROLE_KEYWORDS = {
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
};

/** Returns the profile for a given role key, or null for unknown/missing roles. */
export function getRoleProfile(role) {
  return ROLE_PROFILES[role] ?? null;
}
