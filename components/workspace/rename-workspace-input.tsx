"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RenameWorkspaceInputProps {
  workspaceId: string;
  initialName: string;
  className?: string;
}

export function RenameWorkspaceInput({
  workspaceId,
  initialName,
  className,
}: RenameWorkspaceInputProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEdit() {
    setDraft(name);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(name);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Rename failed");
      }

      setName(trimmed);
      setEditing(false);
      toast.success("Workspace renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancelEdit();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          maxLength={100}
          className={cn(
            "h-7 rounded-md border border-primary/50 bg-background px-2 text-base font-semibold text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-primary/60",
            "disabled:opacity-60",
            className
          )}
          style={{ width: `${Math.max(draft.length, 8)}ch` }}
        />
        <button
          onClick={save}
          disabled={saving || !draft.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
          title="Save"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={cancelEdit}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5">
      <h1 className={cn("text-base font-semibold text-foreground", className)}>
        {name}
      </h1>
      <button
        onClick={startEdit}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-muted-foreground transition-all"
        title="Rename workspace"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
