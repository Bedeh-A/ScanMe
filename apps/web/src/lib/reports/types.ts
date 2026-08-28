export const REPORT_NOTE_MAX_LENGTH = 500;

export interface ReportSubmissionMetadata {
  note?: string;
  detectedCount: number;
  detectedFormats: string[];
  source: "paste" | "upload" | "drop";
  appVersion: string;
}

export interface StoredReportMetadata extends ReportSubmissionMetadata {
  id: string;
  createdAt: string;
  imageBytes: number;
  storageKey: string;
}

export interface ReportListResponse {
  reports: StoredReportMetadata[];
  cursor?: string;
}

export interface ReportUploadResponse {
  reference: string;
}
