import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { WorkspaceCard } from "@/components/dashboard/workspace-card";
import { CreateWorkspaceDialog } from "@/components/dashboard/create-workspace-dialog";
import type { WorkspaceWithStats, UserRow } from "@/types";

// ─── Summary composition helpers ─────────────────────────────────────────────

const METRIC_LABEL: Record<string, string> = {
  revenue:    "Revenue",
  ebitda:     "EBITDA",
  net_income: "Net Income",
};
const METRIC_PRIORITY: Record<string, number> = {
  revenue: 3, ebitda: 2, net_income: 1,
};

/**
 * Format a raw numeric value + unit string into a concise display string.
 * Handles "USD millions", "USD billions", "USD thousands", and bare numbers.
 */
function formatFinancialValue(value: number, unit: string | null): string {
  const u = (unit ?? "").toLowerCase();

  if (u.includes("billion")) {
    return `$${value >= 10 ? value.toFixed(0) : value.toFixed(1)}B`;
  }
  if (u.includes("million")) {
    // Auto-promote to billions if >= 1 000M
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}B`;
    return `$${value >= 100 ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (u.includes("thousand")) {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}B`;
    if (value >= 1_000)     return `$${(value / 1_000).toFixed(1)}M`;
    return `$${value.toFixed(0)}K`;
  }

  // No recognised unit — auto-range by magnitude
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Try to pull a YoY growth figure from the raw extraction text.
 * Returns e.g. "+18% YoY" or null.
 */
function extractGrowthFromRawText(rawText: string): string | null {
  const patterns = [
    // "+18% YoY", "+18.5% year-over-year"
    /([+-]?\d+(?:\.\d+)?)\s*%\s*(?:YoY|year.over.year|y\/y)/i,
    // "grew 18%", "increased by 18.5%", "up 18%"
    /(?:grew|grown|growth|increased|rose|up)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i,
  ];
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      const pct = parseFloat(match[1]);
      const sign = pct >= 0 ? "+" : "";
      const display = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
      return `${sign}${display}% YoY`;
    }
  }
  return null;
}

type TopMetricRow = {
  metric_type: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
  raw_text: string;
};

/**
 * Build the one-line insight summary shown on the workspace card.
 *
 * Format: "Revenue: $128M (+18% YoY). Strong growth driven by enterprise demand."
 * Falls back to narrative only when no reliable metric exists.
 */
function composeInsightSummary(
  topMetrics: TopMetricRow[],
  rawNarrative: string | null,
): string | null {
  // Pick best metric: if confidence gap is > 15 pts, take the higher-confidence
  // one; within similar confidence, prefer Revenue > EBITDA > Net Income.
  const candidates = topMetrics.filter((m) => m.value != null);
  const best = candidates.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 15) return b.confidence - a.confidence;
    return (METRIC_PRIORITY[b.metric_type] ?? 0) - (METRIC_PRIORITY[a.metric_type] ?? 0);
  })[0];

  let metricPart: string | null = null;
  if (best?.value != null) {
    const label   = METRIC_LABEL[best.metric_type] ?? best.metric_type;
    const fmtVal  = formatFinancialValue(best.value, best.unit);
    const growth  = extractGrowthFromRawText(best.raw_text);
    const period  = best.period ? ` (${best.period})` : "";
    metricPart = growth
      ? `${label}: ${fmtVal} (${growth})`
      : `${label}: ${fmtVal}${period}`;
  }

  // Trim narrative to first sentence, 90 chars max
  const narrativePart = rawNarrative
    ? (rawNarrative.split(/\.\s+/)[0]?.trim()?.slice(0, 90) ?? null)
    : null;

  if (metricPart && narrativePart) return `${metricPart}. ${narrativePart}`;
  if (metricPart)                   return metricPart;
  return narrativePart ?? null;
}

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch workspaces
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  // Fetch aggregate stats for each workspace
  const workspacesWithStats: WorkspaceWithStats[] = await Promise.all(
    (workspaces ?? []).map(async (ws) => {
      const [docRes, qRes, aRes, conflictRes, metricRes, insightRes, topMetricsRes] =
        await Promise.all([
          supabase
            .from("documents")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id),
          supabase
            .from("matrix_questions")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id),
          supabase
            .from("matrix_answers")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id)
            .eq("status", "done"),
          // Answers whose intelligence metadata recorded at least one conflict
          supabase
            .from("matrix_answers")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id)
            .eq("status", "done")
            .filter("metadata->>conflict_count", "gt", "0"),
          // Total extracted metric count (drives "Derived metrics" indicator)
          supabase
            .from("extracted_financial_metrics")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id),
          // Best answer text for narrative portion of the insight summary
          supabase
            .from("matrix_answers")
            .select("answer_text")
            .eq("workspace_id", ws.id)
            .eq("status", "done")
            .not("answer_text", "is", null)
            .order("confidence_score", { ascending: false })
            .limit(1)
            .maybeSingle(),
          // Top financial metrics (Revenue / EBITDA / Net Income) for the
          // structured portion of the insight summary
          supabase
            .from("extracted_financial_metrics")
            .select("metric_type, value, unit, period, confidence, raw_text")
            .eq("workspace_id", ws.id)
            .in("metric_type", ["revenue", "ebitda", "net_income"])
            .not("value", "is", null)
            .order("confidence", { ascending: false })
            .limit(10),
        ]);

      const insight_summary = composeInsightSummary(
        (topMetricsRes.data ?? []) as TopMetricRow[],
        insightRes.data?.answer_text ?? null,
      );

      return {
        ...ws,
        document_count: docRes.count ?? 0,
        question_count: qRes.count ?? 0,
        answer_count: aRes.count ?? 0,
        conflict_count: conflictRes.count ?? 0,
        metric_count: metricRes.count ?? 0,
        insight_summary,
      };
    })
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar user={profile as UserRow | null} />

      <main className="flex flex-col flex-1 overflow-hidden">
        {/* Page header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {workspacesWithStats.length} workspace
              {workspacesWithStats.length !== 1 ? "s" : ""}
            </p>
          </div>
          <CreateWorkspaceDialog />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {workspacesWithStats.length === 0 ? (
            <EmptyDashboard />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {workspacesWithStats.map((ws) => (
                <WorkspaceCard key={ws.id} workspace={ws} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyDashboard() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <BarChart3 className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">
          Welcome to Numera
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Create your first workspace to start analyzing financial documents
          with the Matrix.
        </p>
      </div>
      <CreateWorkspaceDialog />
    </div>
  );
}
