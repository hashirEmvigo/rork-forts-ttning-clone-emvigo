import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import type { CustomerProtocol } from "@/types";

interface ProtocolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new protocol once created. */
  onCreated?: (protocol: CustomerProtocol) => void;
  /**
   * Preselect this customer when the dialog opens. Supplied by the Customers
   * workspace so the active customer carries into the New Protocol flow and the
   * user doesn't have to search/select the customer again.
   */
  initialCustomerId?: string;
}

/** Create a customer protocol by selecting a customer and a source template. */
export function ProtocolDialog({
  open,
  onOpenChange,
  onCreated,
  initialCustomerId,
}: ProtocolDialogProps) {
  const { currentUser, customers, getVisibleTemplates, createProtocol } = useApp();
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [error, setError] = useState<string>("");

  const companyCustomers = useMemo(
    () =>
      currentUser?.companyId
        ? customers.filter((c) => c.companyId === currentUser.companyId && c.status === "active")
        : [],
    [customers, currentUser?.companyId],
  );

  // Active, non-archived templates available to this company.
  const availableTemplates = useMemo(
    () =>
      (currentUser ? getVisibleTemplates(currentUser) : []).filter(
        (t) => t.status === "active" && !t.archived,
      ),
    [currentUser, getVisibleTemplates],
  );

  useEffect(() => {
    if (open) {
      // Preselect the active customer when one is provided, but only if it's an
      // active company customer the dialog can actually offer.
      const preset =
        initialCustomerId && companyCustomers.some((c) => c.id === initialCustomerId)
          ? initialCustomerId
          : "";
      setCustomerId(preset);
      setTemplateId("");
      setName("");
      setDescription("");
      setError("");
    }
  }, [open, initialCustomerId, companyCustomers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (!templateId) {
      setError("Select a template.");
      return;
    }
    const result = createProtocol({
      customerId,
      templateId,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
    });
    if (!result.ok || !result.protocol) {
      setError(result.error ?? "Unable to create protocol.");
      return;
    }
    toast({
      title: "Protocol created",
      description: `${result.protocol.name} is ready. Activate rooms to begin.`,
    });
    onOpenChange(false);
    onCreated?.(result.protocol);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>New customer protocol</DialogTitle>
            <DialogDescription>
              Copy a template's structure into an editable protocol for a customer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a customer" />
                </SelectTrigger>
                <SelectContent>
                  {companyCustomers.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No active customers yet.
                    </div>
                  ) : (
                    companyCustomers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Source template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplates.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No active templates available.
                    </div>
                  ) : (
                    availableTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.companyId === null ? " (Global)" : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prot-name">Protocol name (optional)</Label>
              <Input
                id="prot-name"
                placeholder="Defaults to customer + template name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prot-desc">Description (optional)</Label>
              <Textarea
                id="prot-desc"
                placeholder="Any context for this protocol"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create protocol</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
