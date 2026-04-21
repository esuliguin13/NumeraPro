"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileUploadZone } from "./file-upload-zone";
import { DocumentList } from "./document-list";
import type { DocumentRow } from "@/types";

// How often to poll Supabase for status updates while any doc is still ingesting.
const POLL_INTERVAL_MS = 2500;

interface UploadZoneClientProps {
  workspaceId: string;
  initialDocuments: DocumentRow[];
  /** Optional: called after a document is added so a parent can sync its own state. */
  onDocumentAdded?: (doc: DocumentRow) => void;
  /** Optional: called after a document is updated (e.g. ingestion_status change) so a parent can sync its own state. */
  onDocumentUpdated?: (doc: DocumentRow) => void;
  /** Optional: called after a document is deleted so a parent can sync its own state. */
  onDocumentDeleted?: (id: string) => void;
}

export function UploadZoneClient({
  workspaceId,
  initialDocuments,
  onDocumentAdded,
  onDocumentUpdated,
  onDocumentDeleted,
}: UploadZoneClientProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);

  // Stable refs so polling callbacks always read the latest values without
  // needing to be recreated (avoids interval churn on every state update).
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  const onDocumentUpdatedRef = useRef(onDocumentUpdated);
  onDocumentUpdatedRef.current = onDocumentUpdated;

  // ── Active polling ────────────────────────────────────────────────────────
  // Poll every POLL_INTERVAL_MS while any document is still pending/processing.
  // This is the primary mechanism — Supabase postgres_changes Realtime requires
  // table replication to be explicitly enabled in the project dashboard, so it
  // cannot be relied on as the sole update path.
  useEffect(() => {
    const supabase = createClient();

    const poll = async () => {
      const inProgress = documentsRef.current.filter(
        (d) => d.ingestion_status === "pending" || d.ingestion_status === "processing"
      );
      if (inProgress.length === 0) return;

      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .in("id", inProgress.map((d) => d.id));

      if (error || !data || data.length === 0) return;

      // Determine which docs actually changed status
      const changed = (data as DocumentRow[]).filter((fresh) => {
        const existing = documentsRef.current.find((d) => d.id === fresh.id);
        return existing && existing.ingestion_status !== fresh.ingestion_status;
      });

      if (changed.length === 0) return;

      setDocuments((prev) =>
        prev.map((doc) => {
          const fresh = changed.find((u) => u.id === doc.id);
          return fresh ? { ...doc, ...fresh } : doc;
        })
      );

      // Notify parent so matrix grid / exec summary update in sync
      changed.forEach((fresh) => onDocumentUpdatedRef.current?.(fresh));
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [workspaceId]); // stable — only recreated if workspace changes

  // ── Supabase Realtime (fast-path, best-effort) ────────────────────────────
  // When postgres_changes replication IS enabled this fires immediately on any
  // INSERT / UPDATE / DELETE, giving sub-second feedback without waiting for
  // the next poll tick.
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`documents:workspace:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const inserted = payload.new as DocumentRow;
          setDocuments((prev) => {
            if (prev.some((d) => d.id === inserted.id)) return prev;
            return [inserted, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const updated = payload.new as DocumentRow;
          setDocuments((prev) =>
            prev.map((doc) =>
              doc.id === updated.id ? { ...doc, ...updated } : doc
            )
          );
          onDocumentUpdatedRef.current?.(updated);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          setDocuments((prev) => prev.filter((doc) => doc.id !== deleted.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  function handleDocumentUploaded(doc: DocumentRow) {
    setDocuments((prev) => {
      // Guard against Realtime INSERT arriving before this callback fires
      if (prev.some((d) => d.id === doc.id)) return prev;
      return [doc, ...prev];
    });
    // Always notify the parent — MatrixPageClient.handleDocumentAdded has its own dedup
    onDocumentAdded?.(doc);
  }

  function handleDocumentDeleted(documentId: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    onDocumentDeleted?.(documentId);
  }

  function handleReIngest(documentId: string) {
    setDocuments((prev) =>
      prev.map((d) =>
        d.id === documentId ? { ...d, ingestion_status: "processing" } : d
      )
    );
  }

  return (
    <>
      <FileUploadZone
        workspaceId={workspaceId}
        onDocumentUploaded={handleDocumentUploaded}
      />
      <DocumentList
        documents={documents}
        onDocumentDeleted={handleDocumentDeleted}
        onReIngest={handleReIngest}
      />
    </>
  );
}
