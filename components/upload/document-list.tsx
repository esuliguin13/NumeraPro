"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  FileText,
  FileSpreadsheet,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { formatBytes, getFileTypeLabel } from "@/lib/utils";
import type { DocumentRow } from "@/types";

interface DocumentListProps {
  documents: DocumentRow[];
  onDocumentDeleted: (documentId: string) => void;
  onReIngest: (documentId: string) => void;
}

function IngestionStatus({ status }: { status: DocumentRow["ingestion_status"] }) {
  if (status === "done") {
    return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
  }
  if (status === "processing") {
    return <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
  }
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

function FileIcon({ fileType }: { fileType: DocumentRow["file_type"] }) {
  if (fileType === "xlsx" || fileType === "csv") {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />;
  }
  if (fileType === "transcript") {
    return <FileText className="h-4 w-4 text-violet-400 shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-blue-400 shrink-0" />;
}

export function DocumentList({
  documents,
  onDocumentDeleted,
  onReIngest,
}: DocumentListProps) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [reIngestingIds, setReIngestingIds] = useState<Set<string>>(new Set());

  async function handleDelete(document: DocumentRow) {
    if (
      !confirm(
        `Delete "${document.name}"? This will remove all associated chunks, metrics, and answers.`
      )
    )
      return;

    setDeletingIds((prev) => new Set(prev).add(document.id));

    try {
      const res = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete failed");
      }

      onDocumentDeleted(document.id);
      toast.success(`"${document.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(document.id);
        return next;
      });
    }
  }

  async function handleReIngest(document: DocumentRow) {
    setReIngestingIds((prev) => new Set(prev).add(document.id));

    try {
      const res = await fetch("/api/ingestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: document.id,
          workspace_id: document.workspace_id,
          storage_path: document.storage_path,
          file_type: document.file_type,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Re-ingestion failed");
      }

      onReIngest(document.id);
      toast.success(`Re-ingestion started for "${document.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-ingestion failed");
    } finally {
      setReIngestingIds((prev) => {
        const next = new Set(prev);
        next.delete(document.id);
        return next;
      });
    }
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No documents yet</p>
        <p className="text-xs text-muted-foreground/60">
          Upload documents above to get started
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {documents.map((doc) => (
            <div
              key={doc.id}
              className="group rounded-lg px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              {/* Top row: icon + filename + status icon */}
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  <FileIcon fileType={doc.file_type} />
                </span>
                <p className="flex-1 text-sm font-medium text-foreground break-words min-w-0">
                  {doc.name}
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="mt-0.5 shrink-0">
                      <IngestionStatus status={doc.ingestion_status} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="capitalize">
                    {doc.ingestion_status}
                    {doc.ingestion_error ? `: ${doc.ingestion_error}` : ""}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Bottom row: metadata + action buttons */}
              <div className="mt-1 flex items-center justify-between gap-2 pl-6">
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span>{getFileTypeLabel(doc.file_type)}</span>
                  <span>·</span>
                  <span>{formatBytes(doc.file_size)}</span>
                  {doc.page_count && (
                    <>
                      <span>·</span>
                      <span>{doc.page_count} pages</span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {formatDistanceToNow(new Date(doc.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {(doc.ingestion_status === "error" || doc.ingestion_status === "pending") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-amber-400"
                      onClick={() => handleReIngest(doc)}
                      disabled={reIngestingIds.has(doc.id)}
                      title="Re-ingest document"
                    >
                      {reIngestingIds.has(doc.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-red-400"
                    onClick={() => handleDelete(doc)}
                    disabled={deletingIds.has(doc.id)}
                    title="Delete document"
                  >
                    {deletingIds.has(doc.id) ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
      </div>
    </TooltipProvider>
  );
}
