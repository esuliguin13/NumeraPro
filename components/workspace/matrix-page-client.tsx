"use client";

import { useState, useCallback, useMemo } from "react";
import { FileText, BarChart3, Table2 } from "lucide-react";
import { UploadZoneClient } from "@/components/upload/upload-zone-client";
import { MatrixGrid } from "@/components/matrix/matrix-grid";
import { ExecutiveSummary } from "@/components/matrix/executive-summary";
import { SuggestedQuestionsPanel } from "@/components/matrix/suggested-questions-panel";
import { ExportModal } from "@/components/export/export-modal";
import { RenameWorkspaceInput } from "@/components/workspace/rename-workspace-input";
import { DeleteWorkspaceButton } from "@/components/workspace/delete-workspace-button";
import { EntityManager } from "@/components/comparison/entity-manager";
import { ComparisonSnapshot } from "@/components/comparison/comparison-snapshot";
import { ComparisonGrid } from "@/components/comparison/comparison-grid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeExecutiveSummary } from "@/lib/intelligence/executive-summary";
import type {
  DocumentRow,
  MatrixQuestionRow,
  MatrixAnswerWithCitations,
  ExtractedMetricRow,
  ComparisonEntityRow,
} from "@/types";

interface MatrixPageClientProps {
  workspaceId: string;
  workspaceName: string;
  workspaceDescription?: string | null;
  initialDocuments: DocumentRow[];
  initialQuestions: MatrixQuestionRow[];
  initialAnswers: Record<string, MatrixAnswerWithCitations>;
  metrics: ExtractedMetricRow[];
  initialEntities: ComparisonEntityRow[];
}

/**
 * Client boundary for the matrix / comparison tab.
 *
 * Owns shared documents, answers, questions, and entity state.
 * Switches between Standard Mode (single-company matrix) and
 * Comparison Mode (multi-company comparison grid).
 */
export function MatrixPageClient({
  workspaceId,
  workspaceName,
  workspaceDescription,
  initialDocuments,
  initialQuestions,
  initialAnswers,
  metrics,
  initialEntities,
}: MatrixPageClientProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>(initialDocuments);
  const [entities, setEntities] = useState<ComparisonEntityRow[]>(initialEntities);
  const [showExport, setShowExport] = useState(false);

  // Comparison mode — auto-enable when 2+ entities already exist
  const [comparisonMode, setComparisonMode] = useState(initialEntities.length >= 2);

  // Live answers map — updated whenever a cell finishes
  const [answersMap, setAnswersMap] = useState<Record<string, MatrixAnswerWithCitations>>(initialAnswers);

  // Questions for both modes
  const [suggestedAddedQuestions, setSuggestedAddedQuestions] = useState<MatrixQuestionRow[]>([]);
  const [allKnownQuestions, setAllKnownQuestions] = useState<MatrixQuestionRow[]>(initialQuestions);

  const execSummary = computeExecutiveSummary(metrics, allKnownQuestions, answersMap);

  const handleAnswerUpdated = useCallback((key: string, answer: MatrixAnswerWithCitations) => {
    setAnswersMap((prev) => ({ ...prev, [key]: answer }));
  }, []);

  const handleQuestionsAdded = useCallback((questions: MatrixQuestionRow[]) => {
    setSuggestedAddedQuestions((prev) => {
      const deduped = questions.filter((q) => !prev.some((p) => p.id === q.id));
      return [...prev, ...deduped];
    });
    setAllKnownQuestions((prev) => {
      const deduped = questions.filter((q) => !prev.some((p) => p.id === q.id));
      return [...prev, ...deduped];
    });
  }, []);

  const handleQuestionsChanged = useCallback((questions: MatrixQuestionRow[]) => {
    setAllKnownQuestions(questions);
  }, []);

  const existingQuestionTexts = useMemo(
    () => new Set(allKnownQuestions.map((q) => q.question_text)),
    [allKnownQuestions]
  );

  function handleDocumentAdded(doc: DocumentRow) {
    setDocuments((prev) => {
      if (prev.some((d) => d.id === doc.id)) return prev;
      return [doc, ...prev];
    });
  }

  function handleDocumentUpdated(doc: DocumentRow) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, ...doc } : d))
    );
  }

  function handleDocumentDeleted(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <>
      <div className="flex flex-1 overflow-hidden">
        {/* ── Document sidebar ── */}
        <aside className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="px-4 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Documents</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {documents.length} uploaded
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <UploadZoneClient
              workspaceId={workspaceId}
              initialDocuments={initialDocuments}
              onDocumentAdded={handleDocumentAdded}
              onDocumentUpdated={handleDocumentUpdated}
              onDocumentDeleted={handleDocumentDeleted}
            />
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border shrink-0">
            <div>
              <RenameWorkspaceInput
                workspaceId={workspaceId}
                initialName={workspaceName}
              />
              {workspaceDescription && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {workspaceDescription}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Mode toggle */}
              <div className="flex items-center rounded-lg border border-border bg-muted/20 p-0.5 gap-0.5">
                <button
                  onClick={() => setComparisonMode(false)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    !comparisonMode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Standard
                </button>
                <button
                  onClick={() => setComparisonMode(true)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    comparisonMode
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Compare
                </button>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setShowExport(true)}
              >
                <FileText className="h-3.5 w-3.5" />
                Export Analysis
              </Button>
              <DeleteWorkspaceButton
                workspaceId={workspaceId}
                workspaceName={workspaceName}
              />
            </div>
          </div>

          {/* ── Standard mode ── */}
          {!comparisonMode && (
            <>
              <ExecutiveSummary data={execSummary} />

              <SuggestedQuestionsPanel
                workspaceId={workspaceId}
                onQuestionsAdded={handleQuestionsAdded}
                existingQuestionTexts={existingQuestionTexts}
              />

              <MatrixGrid
                workspaceId={workspaceId}
                documents={documents}
                initialQuestions={allKnownQuestions}
                initialAnswers={initialAnswers}
                metrics={metrics}
                onAnswerUpdated={handleAnswerUpdated}
                extraQuestions={suggestedAddedQuestions}
                onQuestionsChanged={handleQuestionsChanged}
              />
            </>
          )}

          {/* ── Comparison mode ── */}
          {comparisonMode && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Scrollable setup + snapshot area */}
              <div className="shrink-0 overflow-y-auto max-h-64 border-b border-border">
                <div className="py-3 space-y-0">
                  <EntityManager
                    workspaceId={workspaceId}
                    entities={entities}
                    documents={documents}
                    onEntitiesChanged={setEntities}
                    onDocumentsChanged={setDocuments}
                  />
                  <ComparisonSnapshot
                    entities={entities}
                    documents={documents}
                    questions={allKnownQuestions}
                    answersMap={answersMap}
                  />
                </div>
              </div>

              {/* Comparison grid */}
              <ComparisonGrid
                workspaceId={workspaceId}
                entities={entities}
                documents={documents}
                questions={allKnownQuestions}
                answersMap={answersMap}
                metrics={metrics}
                onAnswerUpdated={handleAnswerUpdated}
                onQuestionsChanged={handleQuestionsChanged}
              />
            </div>
          )}
        </div>
      </div>

      {showExport && (
        <ExportModal
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onClose={() => setShowExport(false)}
        />
      )}
    </>
  );
}
