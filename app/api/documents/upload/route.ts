import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ALLOWED_MIME_TYPES: Record<string, "pdf" | "xlsx" | "csv" | "txt" | "transcript"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
};

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const workspaceId = formData.get("workspace_id") as string | null;

  if (!file || !workspaceId) {
    return NextResponse.json(
      { error: "Missing required fields: file, workspace_id" },
      { status: 400 }
    );
  }

  // ── Validation ────────────────────────────────────────────────────────────
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 50 MB size limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
      { status: 413 }
    );
  }

  const fileType = ALLOWED_MIME_TYPES[file.type];
  if (!fileType) {
    return NextResponse.json(
      {
        error: `Unsupported file type "${file.type}". Accepted: PDF, Excel (.xlsx), CSV, plain text.`,
      },
      { status: 415 }
    );
  }

  // ── Verify workspace ownership ────────────────────────────────────────────
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .single();

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 }
    );
  }

  // ── Upload to Supabase Storage ─────────────────────────────────────────────
  // Path format: {userId}/{workspaceId}/{timestamp}_{sanitizedFilename}
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${user.id}/${workspaceId}/${Date.now()}_${sanitized}`;
  const fileBuffer = await file.arrayBuffer();

  // Use admin client for storage upload (bypasses storage RLS policies in dev)
  const { error: storageError } = await adminSupabase.storage
    .from("documents")
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (storageError) {
    console.error("[Upload] Storage error:", storageError);
    return NextResponse.json(
      {
        error: `Storage upload failed: ${storageError.message}. ` +
          `Ensure the "documents" bucket exists in your Supabase project.`,
      },
      { status: 500 }
    );
  }

  // ── Insert document record ────────────────────────────────────────────────
  const { data: document, error: dbError } = await supabase
    .from("documents")
    .insert({
      workspace_id: workspaceId,
      name: file.name,
      file_type: fileType,
      file_size: file.size,
      storage_path: storagePath,
      ingestion_status: "pending",
      uploaded_by: user.id,
      metadata: {
        originalName: file.name,
        mimeType: file.type,
        storagePath,
      },
    })
    .select()
    .single();

  if (dbError || !document) {
    // Clean up orphaned storage file
    await adminSupabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json(
      { error: dbError?.message ?? "Failed to create document record" },
      { status: 500 }
    );
  }

  // Trigger ingestion server-side after the response is sent.
  // Using next/server `after()` ensures this runs reliably in serverless
  // environments even after the HTTP response has been flushed — the browser
  // closing or navigating away cannot interrupt it.
  const ingestionUrl = new URL("/api/ingestion", request.url).toString();
  after(async () => {
    try {
      await fetch(ingestionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: document.id,
          workspace_id: workspaceId,
          storage_path: storagePath,
          file_type: fileType,
          file_name: file.name,
        }),
      });
    } catch (err) {
      console.error("[Upload] Server-side ingestion trigger failed:", err);
    }
  });

  return NextResponse.json(document, { status: 201 });
}
