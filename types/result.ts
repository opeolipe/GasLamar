export interface RewritePreviewData {
  before: string;
  after:  string;
  note?:  string | null;
}

export interface ResultData {
  scores:         Record<string, number>;
  primaryIssue:   string | null;
  sampleLine:     string | null;
  rewritePreview: RewritePreviewData | null;
  fullRewrite:    unknown;
}

export interface BuildResultInput {
  skor6d:       Record<string, number>;
  cvText?:      string;
  fullRewrite?: unknown;
}
