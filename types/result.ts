export interface RewritePreviewData {
  before:        string;
  after:         string;
  note?:         string | null;
  personalized?: boolean;
}

export interface ResultData {
  scores:         Record<string, number>;
  primaryIssue:   string | null;
  sampleLine:     string | null;
  rewritePreview: RewritePreviewData | null;
  fullRewrite:    unknown;
  entitasKlaim:   string[] | null;
}

export interface BuildResultInput {
  skor6d:        Record<string, number>;
  cvText?:       string;
  fullRewrite?:  unknown;
  entitasKlaim?: string[] | null;
}
