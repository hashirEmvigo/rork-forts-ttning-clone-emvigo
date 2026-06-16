import { Link } from "react-router-dom";
import { Newspaper } from "lucide-react";

interface CompanyNewsWidgetProps {
  /** Whether the News module is enabled for this customer. */
  enabled: boolean;
  companyName: string;
}

/**
 * Company news area. Only renders when the News module is enabled for the
 * customer — a concrete example of the portal adapting to Module Management.
 */
export function CompanyNewsWidget({ enabled, companyName }: CompanyNewsWidgetProps) {
  if (!enabled) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Company news</h2>
          <p className="text-xs text-muted-foreground">Updates from {companyName}.</p>
        </div>
        <Link
          to="/modules/news"
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground">
        <Newspaper className="h-7 w-7 opacity-40" />
        <p className="text-sm">No announcements yet. New posts will appear here.</p>
      </div>
    </section>
  );
}
