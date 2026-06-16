import { useMemo, useState } from "react";
import {
  Check,
  Languages,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Star,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { EmployeeLanguage } from "@/types";

interface EmployeeLanguagesPanelProps {
  companyId: string;
}

/**
 * Settings → Employees & Customers → Employee Settings → Languages.
 *
 * Company Admins manage the controlled list of languages that employee-facing
 * fields (preferred language) and future multilingual features draw from. The
 * panel handles language CRUD (create/rename/native-name), activation, and
 * choosing the single company default. There is no free-text language input on
 * employees — only a structured selection from this list.
 */
export function EmployeeLanguagesPanel({ companyId }: EmployeeLanguagesPanelProps) {
  const {
    employeeLanguages,
    createEmployeeLanguage,
    updateEmployeeLanguage,
    archiveEmployeeLanguage,
    restoreEmployeeLanguage,
    setEmployeeLanguageDefault,
  } = useApp();
  const { toast } = useToast();

  const companyLanguages = useMemo(
    () =>
      employeeLanguages
        .filter((l) => l.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employeeLanguages, companyId],
  );
  const active = companyLanguages.filter((l) => l.isActive);
  const inactive = companyLanguages.filter((l) => !l.isActive);

  const [newName, setNewName] = useState<string>("");
  const [newNative, setNewNative] = useState<string>("");
  const [newCode, setNewCode] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editNative, setEditNative] = useState<string>("");
  const [editCode, setEditCode] = useState<string>("");

  const handleCreate = () => {
    if (!newName.trim()) {
      toast({ title: "Enter a language name", variant: "destructive" });
      return;
    }
    if (!newCode.trim()) {
      toast({ title: "Enter a language code", variant: "destructive" });
      return;
    }
    const res = createEmployeeLanguage({
      companyId,
      code: newCode,
      name: newName,
      nativeName: newNative,
    });
    if (!res.ok) {
      toast({ title: "Couldn't add language", description: res.error, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewNative("");
    setNewCode("");
    toast({ title: "Language added" });
  };

  const startEdit = (lang: EmployeeLanguage) => {
    setEditingId(lang.id);
    setEditName(lang.name);
    setEditNative(lang.nativeName);
    setEditCode(lang.code);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditNative("");
    setEditCode("");
  };

  const saveEdit = (id: string) => {
    const res = updateEmployeeLanguage(id, {
      code: editCode,
      name: editName,
      nativeName: editNative,
    });
    if (!res.ok) {
      toast({ title: "Couldn't save language", description: res.error, variant: "destructive" });
      return;
    }
    cancelEdit();
    toast({ title: "Language updated" });
  };

  const makeDefault = (id: string) => {
    const res = setEmployeeLanguageDefault(id);
    if (!res.ok) {
      toast({ title: "Couldn't set default", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Default language updated" });
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-1 flex items-center gap-2">
          <Languages className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Languages</h3>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          The controlled list of languages used across employee settings. Employees
          select a preferred language from active languages — never free text — so
          the data stays consistent for future multilingual features.
        </p>

        {/* Create */}
        <div className="mb-5 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="lang-name">Language</Label>
            <Input
              id="lang-name"
              placeholder="e.g. Norwegian"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="lang-native">Native name</Label>
            <Input
              id="lang-native"
              placeholder="e.g. Norsk"
              value={newNative}
              onChange={(e) => setNewNative(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <div className="space-y-1.5 sm:w-28">
            <Label htmlFor="lang-code">Code</Label>
            <Input
              id="lang-code"
              placeholder="e.g. no"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4" /> Add language
          </Button>
        </div>

        {/* Active languages */}
        {active.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No active languages yet. Add one above or reactivate one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((lang) => (
              <li key={lang.id} className="rounded-xl border border-border bg-card px-4 py-3">
                {editingId === lang.id ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="sm:max-w-[180px]"
                      placeholder="Language"
                    />
                    <Input
                      value={editNative}
                      onChange={(e) => setEditNative(e.target.value)}
                      className="flex-1"
                      placeholder="Native name"
                    />
                    <Input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      className="sm:max-w-[96px]"
                      placeholder="Code"
                    />
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" onClick={() => saveEdit(lang.id)}>
                        <Check className="h-4 w-4" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-foreground">{lang.name}</p>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {lang.code}
                        </span>
                        {lang.isDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            <Star className="h-3 w-3 fill-current" /> Default
                          </span>
                        ) : null}
                      </div>
                      {lang.nativeName && lang.nativeName !== lang.name ? (
                        <p className="truncate text-sm text-muted-foreground">{lang.nativeName}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!lang.isDefault ? (
                        <Button size="sm" variant="ghost" onClick={() => makeDefault(lang.id)}>
                          <Star className="h-4 w-4" /> Set default
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => startEdit(lang)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive focus:text-destructive disabled:opacity-40"
                        disabled={lang.isDefault}
                        title={lang.isDefault ? "Set another default first" : undefined}
                        onClick={() => {
                          archiveEmployeeLanguage(lang.id);
                          toast({ title: "Language deactivated" });
                        }}
                      >
                        <Power className="h-4 w-4" /> Deactivate
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Inactive languages */}
        {inactive.length > 0 ? (
          <div className="mt-6">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Inactive
            </h4>
            <ul className="space-y-2">
              {inactive.map((lang) => (
                <li
                  key={lang.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-muted-foreground">{lang.name}</p>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                        {lang.code}
                      </span>
                    </div>
                    {lang.nativeName && lang.nativeName !== lang.name ? (
                      <p className="truncate text-sm text-muted-foreground/70">{lang.nativeName}</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      restoreEmployeeLanguage(lang.id);
                      toast({ title: "Language reactivated" });
                    }}
                  >
                    <RotateCcw className="h-4 w-4" /> Reactivate
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
