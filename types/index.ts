import type { Database } from "./database.types";

// ─── Row types (from database) ──────────────────────────────────────────────

export type UserRow = Database["public"]["Tables"]["users"]["Row"];
export type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentChunkRow =
  Database["public"]["Tables"]["document_chunks"]["Row"];
export type ExtractedMetricRow =
  Database["public"]["Tables"]["extracted_financial_metrics"]["Row"];
export type MatrixQuestionRow =
  Database["public"]["Tables"]["matrix_questions"]["Row"];
export type MatrixAnswerRow =
  Database["public"]["Tables"]["matrix_answers"]["Row"];
export type CitationRow = Database["public"]["Tables"]["citations"]["Row"];
export type ComparisonEntityRow = Database["public"]["Tables"]["comparison_entities"]["Row"];

// ─── Insert types ────────────────────────────────────────────────────────────

export type WorkspaceInsert =
  Database["public"]["Tables"]["workspaces"]["Insert"];
export type DocumentInsert =
  Database["public"]["Tables"]["documents"]["Insert"];
export type MatrixQuestionInsert =
  Database["public"]["Tables"]["matrix_questions"]["Insert"];
export type MatrixAnswerInsert =
  Database["public"]["Tables"]["matrix_answers"]["Insert"];

// ─── Enriched / composite types ──────────────────────────────────────────────

export interface WorkspaceWithStats extends WorkspaceRow {
  document_count: number;
  question_count: number;
  answer_count: number;
  /** Number of done answers that have at least one conflicting signal */
  conflict_count: number;
  /** Number of extracted financial metrics in this workspace */
  metric_count: number;
  /** First sentence of the highest-confidence answer, for card preview */
  insight_summary: string | null;
}

export interface DocumentWithChunks extends DocumentRow {
  chunk_count: number;
  metrics: ExtractedMetricRow[];
}

export interface MatrixAnswerWithCitations extends MatrixAnswerRow {
  citations: CitationRow[];
}

export interface MatrixCell {
  document: DocumentRow;
  question: MatrixQuestionRow;
  answer: MatrixAnswerWithCitations | null;
}

export interface MatrixData {
  workspace: WorkspaceRow;
  documents: DocumentRow[];
  questions: MatrixQuestionRow[];
  answers: Record<string, MatrixAnswerWithCitations>; // key: `${documentId}:${questionId}`
}

// ─── API request / response types ───────────────────────────────────────────

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
}

export interface AddQuestionRequest {
  workspace_id: string;
  question_text: string;
  question_type: MatrixQuestionRow["question_type"];
}

export interface ExecuteMatrixCellRequest {
  workspace_id: string;
  document_id: string;
  question_id: string;
}

export interface ExecuteMatrixCellResponse {
  answer_id: string;
  answer_text: string;
  confidence_score: number;
  extraction_method: "structured" | "retrieval" | "hybrid";
  citations: CitationRow[];
  processing_time_ms: number;
}

export interface IngestionRequest {
  document_id: string;
  workspace_id: string;
  storage_path: string;
  file_type: DocumentRow["file_type"];
}

// ─── UI state types ──────────────────────────────────────────────────────────

export interface SelectedCell {
  documentId: string;
  questionId: string;
  answer: MatrixAnswerWithCitations | null;
  document: DocumentRow;
  question: MatrixQuestionRow;
}

export type CellPanelTab = "answer" | "sources" | "metrics" | "charts" | "details";

export interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

// ─── Financial metric display ────────────────────────────────────────────────

export interface MetricDisplay {
  label: string;
  value: string;
  unit: string;
  period: string;
  change?: number; // percentage change
  positive?: boolean;
}
