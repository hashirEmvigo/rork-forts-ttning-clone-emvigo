import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { EntityStatus } from "@/types";

/** Minimal shape shared by customer-card notes and work-order notes. */
export interface NotesCardItem {
  id: string;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  status: EntityStatus;
}

type NotesCardActionResult = boolean | void | Promise<boolean | void>;

export interface NotesCardProps {
  title: string;
  icon: LucideIcon;
  /** Short purpose/visibility line under the title. */
  description?: string;
  /** All notes for this bucket (active + archived); the card filters them. */
  notes: NotesCardItem[];
  /** Placeholder shown when there are no active notes. */
  emptyHint?: string;
  /** Stronger framing for high-priority buckets (e.g. schedule). */
  emphasis?: boolean;
  /** Returns false on failure so the composer/editor stays open. */
  onAdd: (draft: { title: string; content: string }) => NotesCardActionResult;
  onUpdate: (id: string, draft: { title: string; content: string }) => NotesCardActionResult;
  onArchive: (id: string) => NotesCardActionResult;
  onRestore: (id: string) => NotesCardActionResult;
}

/**
 * A compact, self-contained notes editor card. Used side-by-side for the
 * Customer / Work Order / Economic note buckets on the Services workspace.
 * Editing here writes straight to the single source of truth via the supplied
 * handlers — no copies are kept.
 */
export function NotesCard({
  title,
  icon: Icon,
  description,
  notes,
  emptyHint = "No notes yet.",
  emphasis = false,
  onAdd,
  onUpdate,
  onArchive,
  onRestore,
}: NotesCardProps) {
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [composing, setComposing] = useState<boolean>(false);
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: "", content: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; content: string }>({ title: "", content: "" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const archivedCount = notes.filter((n) => n.status !== "active").length;
  const visible = notes
    .filter((n) => showArchived || n.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const runAction = async (actionId: string, action: () => NotesCardActionResult): Promise<boolean> => {
    setPendingAction(actionId);
    setError("");
    try {
      const result = await action();
      if (result === false) {
        setError("Unable to save note.");
        return false;
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save note.");
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const add = async () => {
    if (!draft.title.trim() && !draft.content.trim()) return;
    if (await runAction("add", () => onAdd(draft))) {
      setDraft({ title: "", content: "" });
      setComposing(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (await runAction(`edit:${id}`, () => onUpdate(id, editDraft))) setEditingId(null);
  };

  const archiveNote = async (id: string) => {
    await runAction(`archive:${id}`, () => onArchive(id));
  };

  const restoreNote = async (id: string) => {
    await runAction(`restore:${id}`, () => onRestore(id));
  };

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-5",
        emphasis ? "border-primary/40 ring-1 ring-primary/10" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
              emphasis ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {description ? (
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setError("");
            setComposing((v) => !v);
          }}
          disabled={pendingAction != null}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {composing ? (
        <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-3">
          <Input
            placeholder="Short title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Textarea
            placeholder="Write the note…"
            value={draft.content}
            rows={3}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setComposing(false)} disabled={pendingAction === "add"}>
              Cancel
            </Button>
            <Button size="sm" onClick={add} disabled={pendingAction === "add" || (!draft.title.trim() && !draft.content.trim())}>
              {pendingAction === "add" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex-1 space-y-2.5">
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyHint}
          </p>
        ) : (
          visible.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-background p-3">
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Input
                    value={editDraft.title}
                    onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                  />
                  <Textarea
                    value={editDraft.content}
                    rows={3}
                    onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={pendingAction === `edit:${n.id}`}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(n.id)} disabled={pendingAction === `edit:${n.id}`}>
                      {pendingAction === `edit:${n.id}` ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <span className="truncate">{n.title}</span>
                      {n.status !== "active" ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Archived
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Edit note"
                        onClick={() => {
                          setError("");
                          setEditingId(n.id);
                          setEditDraft({ title: n.title, content: n.content });
                        }}
                        disabled={pendingAction != null}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {n.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Archive note"
                          onClick={() => archiveNote(n.id)}
                          disabled={pendingAction === `archive:${n.id}`}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Restore note"
                          onClick={() => restoreNote(n.id)}
                          disabled={pendingAction === `restore:${n.id}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {n.content ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{n.content}</p>
                  ) : null}
                  <p className="mt-1.5 text-xs text-muted-foreground/70">
                    {n.authorName} · {formatDateTime(n.createdAt)}
                  </p>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {archivedCount > 0 ? (
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived ({archivedCount})
        </label>
      ) : null}
    </section>
  );
}
