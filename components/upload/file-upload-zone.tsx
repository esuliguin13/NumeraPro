"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Upload, X, Loader2, FileText, FileSpreadsheet } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import type { DocumentRow, UploadingFile } from "@/types";

const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "text/csv": [".csv"],
  "text/plain": [".txt"],
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface FileUploadZoneProps {
  workspaceId: string;
  onDocumentUploaded: (document: DocumentRow) => void;
}

export function FileUploadZone({ workspaceId, onDocumentUploaded }: FileUploadZoneProps) {
  const [uploading, setUploading] = useState<UploadingFile[]>([]);

  const uploadFile = useCallback(
    async (file: File, uploadId: string) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspace_id", workspaceId);

      // Simulate progress (real implementation would use XHR for progress events)
      const progressInterval = setInterval(() => {
        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId && u.progress < 85
              ? { ...u, progress: u.progress + 15 }
              : u
          )
        );
      }, 300);

      try {
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        clearInterval(progressInterval);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Upload failed");
        }

        const document: DocumentRow = await res.json();

        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, progress: 100, status: "processing" }
              : u
          )
        );

        // Ingestion is now triggered server-side via after() in the upload route.
        // Small delay to show 100% before removing the progress item.
        setTimeout(() => {
          setUploading((prev) => prev.filter((u) => u.id !== uploadId));
          onDocumentUploaded(document);
          toast.success(`"${file.name}" uploaded — processing started`);
        }, 800);
      } catch (err) {
        clearInterval(progressInterval);
        setUploading((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? {
                  ...u,
                  status: "error",
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : u
          )
        );
        toast.error(
          `Failed to upload "${file.name}": ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [workspaceId, onDocumentUploaded]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newUploads: UploadingFile[] = acceptedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: "uploading",
      }));

      setUploading((prev) => [...prev, ...newUploads]);

      await Promise.allSettled(
        newUploads.map((u) => uploadFile(u.file, u.id))
      );
    },
    [uploadFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejections) => {
      rejections.forEach(({ file, errors }) => {
        errors.forEach((e) => {
          if (e.code === "file-too-large") {
            toast.error(`"${file.name}" exceeds 50MB limit`);
          } else if (e.code === "file-invalid-type") {
            toast.error(`"${file.name}" is not a supported file type`);
          }
        });
      });
    },
  });

  function getFileIcon(fileName: string) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "csv") {
      return <FileSpreadsheet className="h-4 w-4 text-emerald-400" />;
    }
    return <FileText className="h-4 w-4 text-blue-400" />;
  }

  return (
    <div className="space-y-3">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`
          relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed 
          px-6 py-8 cursor-pointer transition-all
          ${
            isDragActive
              ? "border-primary bg-primary/5 scale-[0.99]"
              : "border-border hover:border-primary/40 hover:bg-muted/20"
          }
        `}
      >
        <input {...getInputProps()} />
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {isDragActive ? "Drop files here" : "Drop files or click to upload"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, Excel, CSV, or TXT · Max 50MB per file
          </p>
        </div>
      </div>

      {/* Upload progress items */}
      {uploading.length > 0 && (
        <div className="space-y-2">
          {uploading.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              {getFileIcon(upload.file.name)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {upload.file.name}
                  </p>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatBytes(upload.file.size)}
                  </span>
                </div>
                {upload.status === "error" ? (
                  <p className="text-xs text-red-400">{upload.error}</p>
                ) : upload.status === "processing" ? (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Ingesting document…
                  </div>
                ) : (
                  <Progress value={upload.progress} className="h-1" />
                )}
              </div>
              {upload.status === "error" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setUploading((prev) =>
                      prev.filter((u) => u.id !== upload.id)
                    )
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
