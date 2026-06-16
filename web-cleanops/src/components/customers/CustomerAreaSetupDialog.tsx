import { MapPin } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CustomerAssignmentPanel } from "@/components/settings/CustomerAssignmentPanel";

interface CustomerAreaSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

/**
 * Focused "Area setup" assistant launched from the Customer page.
 *
 * Reuses the full {@link CustomerAssignmentPanel} (Readiness, Areas, Area
 * Scoped Access, Postal Cities and the auto-assign automation) so there is a
 * single source of truth — Settings → Customer / Employee Assignment stays the
 * full administrative home. The panel's review links close this dialog as they
 * deep-link into the filtered customer list.
 */
export function CustomerAreaSetupDialog({
  open,
  onOpenChange,
  companyId,
}: CustomerAreaSetupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" /> Area setup
          </DialogTitle>
          <DialogDescription>
            Configure Areas, Postal Cities and Area Scoped Access without leaving
            the Customer page. The full options also live in Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <CustomerAssignmentPanel
            companyId={companyId}
            onAfterNavigate={() => onOpenChange(false)}
            compact
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
