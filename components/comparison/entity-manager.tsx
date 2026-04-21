"use client";

/**
 * Entity Manager
 *
 * Lets users create/rename/delete comparison entities (company groups)
 * and assign documents to them. Rendered as a collapsible panel above
 * the comparison grid.
 */

import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Building2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ComparisonEntityRow, DocumentRow } from "@/types";

// ─── Colour palette for entity badges ────────────────────────────────────────

const ENTITY_COLORS = [
  "#6366f1", // violet
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#06b6d4", // cyan
  "#f97316", // orange
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntityManagerProps {
  workspaceId: string;
  entities: ComparisonEntityRow[];
  documents: DocumentRow[];
  onEntitiesChanged: (entities: ComparisonEntityRow[]) => void;
  onDocumentsChanged: (documents: DocumentRow[]) => void;
}

// ─── Entity dot badge ─────────────────────────────────────────────────────────

export function EntityDot({ color, size = "sm" }: { color: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "rounded-full shrink-0",
        size === "sm" ? "h-2 w-2" : "h-3 w-3"
      )}
      style={{ backgroundColor: color }}
    />
  );
}

export function EntityBadge({
  entity,
  className,
}: {
  entity: Pick<ComparisonEntityRow, "label" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        className
      )}
      style={{
        borderColor: entity.color + "40",
        backgroundColor: entity.color + "15",
        color: entity.color,
      }}
    >
      <EntityDot color={entity.color} />
      {entity.label}
    </span>
  );
}

// ─── Single entity row ────────────────────────────────────────────────────────

interface EntityRowProps {
  entity: ComparisonEntityRow;
  docCount: number;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}

function EntityRow({ entity, docCount, onRename, onDelete }: EntityRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity.label);

  const save = () => {
    if (draft.trim() && draft.trim() !== entity.label) {
      onRename(entity.id, draft.trim());
    }
    setEditing(false);
  };

  return (
    <div className="group/er flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/30 transition-colors">
      <EntityDot color={entity.color} size="md" />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { setDraft(entity.label); setEditing(false); }
          }}
          className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none border-b border-primary"
        />
      ) : (
        <span className="flex-1 text-sm font-medium text-foreground truncate">
          {entity.label}
        </span>
      )}

      <span className="text-[10px] text-muted-foreground/60 shrink-0">
        {docCount} doc{docCount !== 1 ? "s" : ""}
      </span>

      {editing ? (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={save}
            className="flex h-6 w-6 items-center justify-center rounded text-emerald-400 hover:bg-emerald-500/10"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setDraft(entity.label); setEditing(false); }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/er:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => onDelete(entity.id)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Document assignment row ──────────────────────────────────────────────────

interface DocAssignRowProps {
  doc: DocumentRow;
  entities: ComparisonEntityRow[];
  onAssign: (docId: string, entityId: string | null) => void;
}

function DocAssignRow({ doc, entities, onAssign }: DocAssignRowProps) {
  const assignedEntity = entities.find((e) => e.id === doc.entity_id);

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/20 transition-colors">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      <span
        className="flex-1 text-xs text-muted-foreground truncate"
        title={doc.name}
      >
        {doc.name}
      </span>
      <span className="text-[9px] font-bold uppercase text-muted-foreground/40 shrink-0">
        {doc.file_type}
      </span>

      {/* Assignment selector */}
      <select
        value={doc.entity_id ?? ""}
        onChange={(e) => onAssign(doc.id, e.target.value || null)}
        className="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 shrink-0"
      >
        <option value="">— Unassigned —</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>

      {assignedEntity && (
        <EntityDot color={assignedEntity.color} />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EntityManager({
  workspaceId,
  entities,
  documents,
  onEntitiesChanged,
  onDocumentsChanged,
}: EntityManagerProps) {
  const [open, setOpen] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  // ── Create entity ──────────────────────────────────────────────────────────
  const createEntity = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    try {
      const res = await fetch("/api/comparison/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          label,
          color: ENTITY_COLORS[entities.length % ENTITY_COLORS.length],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onEntitiesChanged([...entities, data]);
      setNewLabel("");
      toast.success(`"${label}" added`);
    } catch (err) {
      toast.error("Failed to create group");
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  // ── Rename entity ──────────────────────────────────────────────────────────
  const renameEntity = async (id: string, label: string) => {
    try {
      const res = await fetch("/api/comparison/entities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onEntitiesChanged(entities.map((e) => (e.id === id ? data : e)));
    } catch {
      toast.error("Failed to rename");
    }
  };

  // ── Delete entity ──────────────────────────────────────────────────────────
  const deleteEntity = async (id: string) => {
    try {
      const res = await fetch(`/api/comparison/entities?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      onEntitiesChanged(entities.filter((e) => e.id !== id));
      // Unassign docs that were assigned to this entity
      onDocumentsChanged(
        documents.map((d) => (d.entity_id === id ? { ...d, entity_id: null } : d))
      );
      toast.success("Group removed");
    } catch {
      toast.error("Failed to delete group");
    }
  };

  // ── Assign document ────────────────────────────────────────────────────────
  const assignDocument = async (docId: string, entityId: string | null) => {
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: entityId }),
      });
      if (!res.ok) throw new Error("Failed");
      onDocumentsChanged(
        documents.map((d) => (d.id === docId ? { ...d, entity_id: entityId } : d))
      );
    } catch {
      toast.error("Failed to assign document");
    }
  };

  const docCountFor = (entityId: string) =>
    documents.filter((d) => d.entity_id === entityId).length;

  const unassigned = documents.filter((d) => !d.entity_id);
  const doneDocuments = documents.filter((d) => d.ingestion_status === "done");

  return (
    <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 overflow-hidden">
      {/* Header */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Building2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1 text-left">
          Company Groups
        </span>
        <span className="text-[11px] text-muted-foreground">
          {entities.length} group{entities.length !== 1 ? "s" : ""} · {documents.length} doc{documents.length !== 1 ? "s" : ""}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/60">
          <div className="grid grid-cols-2 divide-x divide-border/60">
            {/* ── Left: Entity list + create ── */}
            <div className="px-3 py-3">
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Groups
              </p>

              {entities.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground/50">
                  No groups yet. Create one to start comparing.
                </p>
              )}

              {entities.map((entity) => (
                <EntityRow
                  key={entity.id}
                  entity={entity}
                  docCount={docCountFor(entity.id)}
                  onRename={renameEntity}
                  onDelete={deleteEntity}
                />
              ))}

              {/* Add group input */}
              <div className="mt-2 flex items-center gap-1.5 px-3">
                <input
                  type="text"
                  placeholder="Add group (e.g. Singtel)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createEntity()}
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none border-b border-border focus:border-primary py-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={createEntity}
                  disabled={!newLabel.trim() || adding}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* ── Right: Document assignment ── */}
            <div className="px-3 py-3">
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Assign Documents
              </p>

              {doneDocuments.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground/50">
                  No ingested documents yet.
                </p>
              ) : (
                <div className="space-y-0.5 max-h-[160px] overflow-y-auto">
                  {doneDocuments.map((doc) => (
                    <DocAssignRow
                      key={doc.id}
                      doc={doc}
                      entities={entities}
                      onAssign={assignDocument}
                    />
                  ))}
                </div>
              )}

              {unassigned.length > 0 && entities.length > 0 && (
                <p className="mt-2 px-3 text-[10px] text-amber-400/70">
                  ⚠ {unassigned.filter(d => d.ingestion_status === "done").length} document{unassigned.length !== 1 ? "s" : ""} unassigned — they won&apos;t appear in the comparison.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
