"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { MatrixQuestionRow } from "@/types";

const QUESTION_PRESETS = [
  "What was the total revenue for the most recent period?",
  "What is the EBITDA and EBITDA margin?",
  "What are the key risks mentioned?",
  "What is management's guidance for the next period?",
  "What drove revenue growth or decline?",
  "What is the net income and net margin?",
  "How did the company perform vs. prior year?",
  "What are the key strategic initiatives?",
];

interface AddQuestionDialogProps {
  workspaceId: string;
  onQuestionAdded: (question: MatrixQuestionRow) => void;
  /** Optional custom trigger element. Defaults to the standard "+ Add Question" button. */
  children?: React.ReactNode;
}

export function AddQuestionDialog({
  workspaceId,
  onQuestionAdded,
  children,
}: AddQuestionDialogProps) {
  const [open, setOpen] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [questionType, setQuestionType] =
    useState<MatrixQuestionRow["question_type"]>("financial");
  const [loading, setLoading] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!questionText.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/matrix/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          question_text: questionText.trim(),
          question_type: questionType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to add question");
      }

      const question = await res.json();
      onQuestionAdded(question);
      toast.success("Question added to matrix");
      setOpen(false);
      setQuestionText("");
      setQuestionType("financial");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <button className="flex h-full w-40 flex-col items-center justify-center gap-1.5 border-r border-border text-muted-foreground/50 hover:bg-muted/20 hover:text-muted-foreground transition-colors">
            <Plus className="h-4 w-4" />
            <span className="text-xs font-medium">Add Question</span>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Matrix Question</DialogTitle>
          <DialogDescription>
            Add a question as a new column. Numera will answer it for every
            document in your workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAdd} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="q-type">Question Type</Label>
            <Select
              value={questionType}
              onValueChange={(v) =>
                setQuestionType(v as MatrixQuestionRow["question_type"])
              }
            >
              <SelectTrigger id="q-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="financial">Financial Metric</SelectItem>
                <SelectItem value="operational">Operational</SelectItem>
                <SelectItem value="risk">Risk / Compliance</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-text">Question</Label>
            <Textarea
              id="q-text"
              placeholder="e.g., What was total revenue for Q3 2024?"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              rows={3}
              required
              autoFocus
            />
          </div>

          {/* Presets */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Quick presets
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQuestionText(preset)}
                  className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary transition-colors"
                >
                  {preset.slice(0, 40)}…
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !questionText.trim()}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Question
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
