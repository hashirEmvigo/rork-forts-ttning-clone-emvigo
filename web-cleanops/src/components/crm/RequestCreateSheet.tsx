/**
 * REQUEST CRM — local-only create request foundation (WAVE-003L-R).
 *
 * This sheet captures a frontend-only draft preview for Company Admins inside the
 * existing Admin Requests operational shell. It never writes to Supabase, never
 * mutates the mock request list, never calls fetch, and does not create a real
 * request. Assignment, status, automation and linked-object runtime are clearly
 * marked as later-slice placeholders.
 */
import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Link2,
  Lock,
  UserPlus,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { REQUEST_CRM_CATEGORIES, REQUEST_CRM_REQUEST_TYPES } from "@/lib/requestCrm/mockData";
import {
  REQUEST_PRIORITY_OPTIONS,
  REQUEST_SOURCE_OPTIONS,
} from "@/lib/requestCrm/requestListFilters";
import type { RequestPriority, RequestSource } from "@/lib/requestCrm/types";

interface RequestCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LocalDraftState {
  title: string;
  categoryId: string;
  requestTypeKey: string;
  source: RequestSource;
  priority: RequestPriority;
  customerReference: string;
  description: string;
  linkedObjectReference: string;
}

const DEFAULT_DRAFT: LocalDraftState = {
  title: "",
  categoryId: REQUEST_CRM_CATEGORIES[0]?.id ?? "cat-customer-service",
  requestTypeKey: REQUEST_CRM_REQUEST_TYPES[0]?.key ?? "general_message",
  source: "internal",
  priority: "normal",
  customerReference: "",
  description: "",
  linkedObjectReference: "",
};

const FUTURE_SECTIONS = [
  {
    key: "assignment",
    title: "Assignment",
    description: "Owner, team queue and handoff rules arrive in a later backend slice.",
    icon: UserPlus,
  },
  {
    key: "status",
    title: "Status workflow",
    description: "Status transitions stay disabled until real request persistence exists.",
    icon: ClipboardList,
  },
  {
    key: "automation",
    title: "Automation & AI",
    description: "No automation or AI execution runs from this local draft foundation.",
    icon: Bot,
  },
];

function categoryLabel(categoryId: string): string {
  return REQUEST_CRM_CATEGORIES.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function requestTypeLabel(requestTypeKey: string): string {
  return REQUEST_CRM_REQUEST_TYPES.find((type) => type.key === requestTypeKey)?.label ?? requestTypeKey;
}

/** Controlled side-sheet for capturing a local, non-persistent request draft. */
export function RequestCreateSheet({ open, onOpenChange }: RequestCreateSheetProps) {
  const [draft, setDraft] = useState<LocalDraftState>(DEFAULT_DRAFT);
  const [submittedDraft, setSubmittedDraft] = useState<LocalDraftState | null>(null);

  const updateDraft = <Key extends keyof LocalDraftState>(key: Key, value: LocalDraftState[Key]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    if (submittedDraft !== null) setSubmittedDraft(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedDraft(draft);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        data-testid="crm-request-create-sheet"
      >
        <SheetHeader className="space-y-3 border-b border-border px-5 py-4 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-medium text-sky-700">
              Local-only
            </Badge>
            <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">
              Foundation
            </Badge>
          </div>
          <SheetTitle className="text-lg leading-snug">Create request</SheetTitle>
          <SheetDescription>
            Capture a frontend-only draft preview for Admin Requests. Persistence,
            assignment and automation arrive in later slices.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Alert data-testid="crm-request-create-local-note" className="border-dashed bg-muted/40">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Frontend foundation only</AlertTitle>
              <AlertDescription>
                This form does not create a real request, write to Supabase, call a
                backend, assign owners, notify users, or run automation.
              </AlertDescription>
            </Alert>

            <section className="space-y-3" data-testid="crm-request-create-fields">
              <div className="space-y-1.5">
                <Label htmlFor="crm-create-title">Request title</Label>
                <Input
                  id="crm-create-title"
                  value={draft.title}
                  onChange={(event) => updateDraft("title", event.target.value)}
                  placeholder="Short internal title, e.g. Customer asks to reschedule"
                  data-testid="crm-request-create-title"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Request category</Label>
                  <Select value={draft.categoryId} onValueChange={(value) => updateDraft("categoryId", value)}>
                    <SelectTrigger data-testid="crm-request-create-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_CRM_CATEGORIES.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Request type</Label>
                  <Select
                    value={draft.requestTypeKey}
                    onValueChange={(value) => updateDraft("requestTypeKey", value)}
                  >
                    <SelectTrigger data-testid="crm-request-create-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_CRM_REQUEST_TYPES.map((type) => (
                        <SelectItem key={type.key} value={type.key}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <Select
                    value={draft.source}
                    onValueChange={(value) => updateDraft("source", value as RequestSource)}
                  >
                    <SelectTrigger data-testid="crm-request-create-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(value) => updateDraft("priority", value as RequestPriority)}
                  >
                    <SelectTrigger data-testid="crm-request-create-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_PRIORITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crm-create-customer">Customer / reference placeholder</Label>
                <Input
                  id="crm-create-customer"
                  value={draft.customerReference}
                  onChange={(event) => updateDraft("customerReference", event.target.value)}
                  placeholder="Customer name, email, invoice number or internal reference"
                  data-testid="crm-request-create-customer"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crm-create-description">Description / internal note placeholder</Label>
                <Textarea
                  id="crm-create-description"
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                  placeholder="Capture the initial admin note. This stays local in this slice."
                  data-testid="crm-request-create-description"
                  rows={4}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="crm-create-linked-object">Optional linked object placeholder</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="crm-create-linked-object"
                    value={draft.linkedObjectReference}
                    onChange={(event) => updateDraft("linkedObjectReference", event.target.value)}
                    placeholder="Work order, invoice, chat, employee or schedule reference"
                    className="pl-9"
                    data-testid="crm-request-create-linked-object"
                  />
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-2.5" data-testid="crm-request-create-future-sections">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Disabled future sections
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                {FUTURE_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <div
                      key={section.key}
                      aria-disabled="true"
                      className="rounded-xl border border-dashed border-border bg-muted/35 p-3 opacity-80"
                      data-testid={`crm-request-create-future-${section.key}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{section.title}</p>
                            <Badge variant="outline" className="border-border bg-background text-muted-foreground">
                              Later slice
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                        </div>
                        <Lock className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {submittedDraft ? (
              <Alert
                data-testid="crm-request-create-success"
                className="border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Draft request captured locally for UI preview only.</AlertTitle>
                <AlertDescription>
                  Persistence arrives in a later backend slice. Preview: {submittedDraft.title || "Untitled request"} · {categoryLabel(submittedDraft.categoryId)} · {requestTypeLabel(submittedDraft.requestTypeKey)}.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" data-testid="crm-request-create-submit">
              Capture local draft
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
