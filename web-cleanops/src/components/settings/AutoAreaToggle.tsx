import { Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";

interface AutoAreaToggleProps {
  /** Render the section heading + description above the toggle card. */
  showHeading?: boolean;
}

/**
 * Company-level "Automatically assign Area from Postal City" toggle.
 *
 * Extracted so it can live either inside the Postal Cities panel (full Settings)
 * or be grouped with the other feature controls in the compact Customer page
 * Area setup dialog — without duplicating the toggle logic.
 */
export function AutoAreaToggle({ showHeading = true }: AutoAreaToggleProps) {
  const { autoAreaFromPostalCityEnabled, setAutoAreaFromPostalCityEnabled } = useApp();
  const { toast } = useToast();

  return (
    <div>
      {showHeading ? (
        <>
          <div className="mb-1 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              Automatically assign Area from Postal City
            </h3>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            When active, selecting a Postal City on a customer automatically sets
            their Area. When inactive, the Postal City only suggests an Area that
            the admin can apply manually.
          </p>
        </>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            Auto Area from Postal City: {autoAreaFromPostalCityEnabled ? "Active" : "Inactive"}
          </p>
          <p className="text-sm text-muted-foreground">
            {autoAreaFromPostalCityEnabled
              ? "Area is set automatically from the selected Postal City."
              : "Postal City only suggests an Area."}
          </p>
        </div>
        <Button
          variant={autoAreaFromPostalCityEnabled ? "outline" : "default"}
          onClick={() => {
            const next = !autoAreaFromPostalCityEnabled;
            setAutoAreaFromPostalCityEnabled(next);
            toast({
              title: next
                ? "Automatic Area assignment enabled"
                : "Automatic Area assignment disabled",
            });
          }}
        >
          {autoAreaFromPostalCityEnabled ? "Disable" : "Enable"}
        </Button>
      </div>
    </div>
  );
}
