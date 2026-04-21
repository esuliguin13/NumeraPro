import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploadZoneClient } from "@/components/upload/upload-zone-client";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DeleteWorkspaceButton } from "@/components/workspace/delete-workspace-button";
import { RenameWorkspaceInput } from "@/components/workspace/rename-workspace-input";
import { MatrixPageClient } from "@/components/workspace/matrix-page-client";
import type {
  MatrixAnswerWithCitations,
  ExtractedMetricRow,
  UserRow,
  ComparisonEntityRow,
} from "@/types";

interface WorkspacePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export async function generateMetadata({
  params,
}: WorkspacePageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", id)
    .single();

  return {
    title: data?.name ?? "Workspace",
  };
}

export default async function WorkspacePage({ params, searchParams }: WorkspacePageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === "documents" ? "documents" : "matrix";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch workspace
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (!workspace) notFound();

  // Fetch profile for sidebar
  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  // Parallel fetch of matrix data
  const [documentsRes, questionsRes, answersRes, metricsRes, entitiesRes] =
    await Promise.all([
      supabase
        .from("documents")
        .select("*")
        .eq("workspace_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("matrix_questions")
        .select("*")
        .eq("workspace_id", id)
        .order("column_index", { ascending: true }),
      supabase
        .from("matrix_answers")
        .select("*, citations(*)")
        .eq("workspace_id", id),
      supabase
        .from("extracted_financial_metrics")
        .select("*")
        .eq("workspace_id", id),
      supabase
        .from("comparison_entities")
        .select("*")
        .eq("workspace_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  const documents = documentsRes.data ?? [];
  const questions = questionsRes.data ?? [];
  const metrics = (metricsRes.data ?? []) as ExtractedMetricRow[];
  const entities = (entitiesRes.data ?? []) as ComparisonEntityRow[];

  // Build answers lookup map keyed by "documentId:questionId"
  const answersMap: Record<string, MatrixAnswerWithCitations> = {};
  for (const answer of answersRes.data ?? []) {
    const key = `${answer.document_id}:${answer.question_id}`;
    answersMap[key] = answer as MatrixAnswerWithCitations;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar with workspace context */}
      <AppSidebar
        user={profile as UserRow | null}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
      />

      {/* ── Documents tab: full-width document management ── */}
      {activeTab === "documents" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <div>
              <RenameWorkspaceInput
                workspaceId={workspace.id}
                initialName={workspace.name}
              />
              <p className="text-xs text-muted-foreground mt-0.5">
                {documents.length} document{documents.length !== 1 ? "s" : ""} uploaded
              </p>
            </div>
            <DeleteWorkspaceButton
              workspaceId={workspace.id}
              workspaceName={workspace.name}
            />
          </div>

          {/* Full-width document manager */}
          <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full">
            <UploadZoneClient
              workspaceId={workspace.id}
              initialDocuments={documents}
            />
          </div>
        </div>
      )}

      {/* ── Matrix tab: document sidebar + matrix grid ── */}
      {activeTab === "matrix" && (
        <MatrixPageClient
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          workspaceDescription={workspace.description}
          initialDocuments={documents}
          initialQuestions={questions}
          initialAnswers={answersMap}
          metrics={metrics}
          initialEntities={entities}
        />
      )}
    </div>
  );
}
