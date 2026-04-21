import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  FileText,
  HelpCircle,
  CheckSquare,
  ArrowRight,
  GitMerge,
  AlertTriangle,
  Calculator,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceWithStats } from "@/types";

interface WorkspaceCardProps {
  workspace: WorkspaceWithStats;
}

// ── Status badge ──────────────────────────────────────────────────────────────

type StatusLevel = "high-confidence" | "partial" | "conflicting" | "empty";

function getStatus(ws: WorkspaceWithStats): StatusLevel {
  if (ws.answer_count === 0) return "empty";
  if (ws.conflict_count > 0) return "conflicting";
  const total = ws.document_count * ws.question_count;
  if (total > 0 && ws.answer_count >= total) return "high-confidence";
  return "partial";
}

const STATUS_CONFIG: Record<
  StatusLevel,
  { label: string; className: string } | null
> = {
  empty: null,
  "high-confidence": {
    label: "High Confidence",
    className:
      "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
  },
  partial: {
    label: "Partial Analysis",
    className: "bg-sky-500/10 text-sky-500 border border-sky-500/20",
  },
  conflicting: {
    label: "Conflicting Data",
    className: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
  },
};

function StatusBadge({ level }: { level: StatusLevel }) {
  const config = STATUS_CONFIG[level];
  if (!config) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}

// ── Intelligence indicators ───────────────────────────────────────────────────

function IntelIndicator({
  icon: Icon,
  label,
  active,
  activeClass,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  activeClass: string;
}) {
  if (!active) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border",
        activeClass
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function WorkspaceCard({ workspace: ws }: WorkspaceCardProps) {
  const status = getStatus(ws);
  const hasIndicators =
    ws.document_count >= 2 || ws.conflict_count > 0 || ws.metric_count > 0;

  return (
    <Card className="group hover:border-primary/30 transition-all hover:shadow-lg hover:shadow-primary/5 flex flex-col">
      <CardHeader className="pb-3">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-snug line-clamp-2 flex-1">
            {ws.name}
          </CardTitle>
          <StatusBadge level={status} />
        </div>

        {/* Insight summary — one-line preview of best answer */}
        {ws.insight_summary ? (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {ws.insight_summary}
          </p>
        ) : ws.description ? (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {ws.description}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="pb-4 flex-1 flex flex-col gap-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span className="text-xs">Documents</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {ws.document_count}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="text-xs">Questions</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {ws.question_count}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="text-xs">Answers</span>
            </div>
            <p className="text-lg font-bold text-foreground">
              {ws.answer_count}
            </p>
          </div>
        </div>

        {/* Intelligence indicators */}
        {hasIndicators && (
          <div className="flex flex-wrap gap-1.5">
            <IntelIndicator
              icon={GitMerge}
              label="Multi-source validated"
              active={ws.document_count >= 2}
              activeClass="bg-violet-500/10 text-violet-500 border-violet-500/20"
            />
            <IntelIndicator
              icon={AlertTriangle}
              label="Conflicts detected"
              active={ws.conflict_count > 0}
              activeClass="bg-amber-500/10 text-amber-500 border-amber-500/20"
            />
            <IntelIndicator
              icon={Calculator}
              label="Derived metrics"
              active={ws.metric_count > 0}
              activeClass="bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between pt-0">
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(ws.updated_at), { addSuffix: true })}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
          asChild
        >
          <Link href={`/workspace/${ws.id}`}>
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
