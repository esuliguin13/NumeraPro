export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          owner_id: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          owner_id: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          settings?: Json;
          updated_at?: string;
        };
      };
      documents: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          file_type: "pdf" | "xlsx" | "csv" | "txt" | "transcript";
          file_size: number;
          storage_path: string;
          page_count: number | null;
          ingestion_status: "pending" | "processing" | "done" | "error";
          ingestion_error: string | null;
          metadata: Json;
          uploaded_by: string;
          /** FK to comparison_entities.id — null means unassigned (standard workspace) */
          entity_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          file_type: "pdf" | "xlsx" | "csv" | "txt" | "transcript";
          file_size: number;
          storage_path: string;
          page_count?: number | null;
          ingestion_status?: "pending" | "processing" | "done" | "error";
          ingestion_error?: string | null;
          metadata?: Json;
          uploaded_by: string;
          entity_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          page_count?: number | null;
          ingestion_status?: "pending" | "processing" | "done" | "error";
          ingestion_error?: string | null;
          metadata?: Json;
          entity_id?: string | null;
          updated_at?: string;
        };
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          workspace_id: string;
          content: string;
          chunk_index: number;
          page_number: number | null;
          section_title: string | null;
          token_count: number;
          embedding: string | null; // vector stored as string in JSON type
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          workspace_id: string;
          content: string;
          chunk_index: number;
          page_number?: number | null;
          section_title?: string | null;
          token_count: number;
          embedding?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          embedding?: string | null;
          metadata?: Json;
        };
      };
      extracted_financial_metrics: {
        Row: {
          id: string;
          document_id: string;
          workspace_id: string;
          metric_type:
            | "revenue"
            | "ebitda"
            | "net_income"
            | "gross_profit"
            | "operating_income"
            | "margin"
            | "guidance"
            | "headcount"
            | "custom";
          metric_name: string;
          value: number | null;
          unit: string | null;
          period: string | null;
          period_type: "annual" | "quarterly" | "ttm" | "other" | null;
          raw_text: string;
          page_number: number | null;
          confidence: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          workspace_id: string;
          metric_type:
            | "revenue"
            | "ebitda"
            | "net_income"
            | "gross_profit"
            | "operating_income"
            | "margin"
            | "guidance"
            | "headcount"
            | "custom";
          metric_name: string;
          value?: number | null;
          unit?: string | null;
          period?: string | null;
          period_type?: "annual" | "quarterly" | "ttm" | "other" | null;
          raw_text: string;
          page_number?: number | null;
          confidence: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          value?: number | null;
          confidence?: number;
          metadata?: Json;
        };
      };
      matrix_questions: {
        Row: {
          id: string;
          workspace_id: string;
          question_text: string;
          column_index: number;
          question_type: "financial" | "operational" | "risk" | "general";
          extraction_hints: Json;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          question_text: string;
          column_index: number;
          question_type?: "financial" | "operational" | "risk" | "general";
          extraction_hints?: Json;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          question_text?: string;
          column_index?: number;
          question_type?: "financial" | "operational" | "risk" | "general";
          extraction_hints?: Json;
          updated_at?: string;
        };
      };
      matrix_answers: {
        Row: {
          id: string;
          workspace_id: string;
          document_id: string;
          question_id: string;
          status: "pending" | "running" | "done" | "error";
          answer_text: string | null;
          confidence_score: number | null;
          extraction_method: "structured" | "retrieval" | "hybrid" | null;
          processing_time_ms: number | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          document_id: string;
          question_id: string;
          status?: "pending" | "running" | "done" | "error";
          answer_text?: string | null;
          confidence_score?: number | null;
          extraction_method?: "structured" | "retrieval" | "hybrid" | null;
          processing_time_ms?: number | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "pending" | "running" | "done" | "error";
          answer_text?: string | null;
          confidence_score?: number | null;
          extraction_method?: "structured" | "retrieval" | "hybrid" | null;
          processing_time_ms?: number | null;
          error_message?: string | null;
          metadata?: Json;
          updated_at?: string;
        };
      };
      citations: {
        Row: {
          id: string;
          answer_id: string;
          document_id: string;
          chunk_id: string | null;
          citation_text: string;
          page_number: number | null;
          section_title: string | null;
          relevance_score: number;
          highlight_start: number | null;
          highlight_end: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          answer_id: string;
          document_id: string;
          chunk_id?: string | null;
          citation_text: string;
          page_number?: number | null;
          section_title?: string | null;
          relevance_score: number;
          highlight_start?: number | null;
          highlight_end?: number | null;
          created_at?: string;
        };
        Update: {
          relevance_score?: number;
        };
      };
      comparison_entities: {
        Row: {
          id: string;
          workspace_id: string;
          label: string;
          company_name: string | null;
          ticker: string | null;
          period_label: string | null;
          description: string | null;
          color: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          label: string;
          company_name?: string | null;
          ticker?: string | null;
          period_label?: string | null;
          description?: string | null;
          color?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          company_name?: string | null;
          ticker?: string | null;
          period_label?: string | null;
          description?: string | null;
          color?: string;
          sort_order?: number;
          updated_at?: string;
        };
      };
      suggested_questions: {
        Row: {
          id: string;
          workspace_id: string;
          /** Serialised SuggestedCategoryGroup[] */
          categories: Json;
          /** Hash of the done-document set at generation time */
          generated_from_hash: string | null;
          source_metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          categories: Json;
          generated_from_hash?: string | null;
          source_metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          categories?: Json;
          generated_from_hash?: string | null;
          source_metadata?: Json;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_document_chunks: {
        Args: {
          /** JSON array string of 1024-dim Voyage AI embedding, e.g. "[0.1, 0.2, ...]" */
          query_embedding: string;
          workspace_id: string;
          document_ids: string[];
          match_threshold: number;
          match_count: number;
        };
        Returns: {
          id: string;
          document_id: string;
          content: string;
          page_number: number | null;
          section_title: string | null;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}
