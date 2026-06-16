import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ExternalLink, MoreHorizontal, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { useAssignedUsers } from "@/hooks/use-assigned-users";
import { companiesFromAssignedUserRoster } from "@/lib/assignedUsersRoster";
import { tallyCompanyRoles } from "@/lib/rolesOverview";

interface CompanyAssignmentsTableProps {
  /** Jumps to the Assigned Users tab filtered to a company. */
  onViewCompanyUsers: (companyId: string) => void;
}

function CountCell({ value }: { value: number }) {
  return (
    <TableCell className="text-center tabular-nums">
      {value > 0 ? (
        <span className="font-medium">{value}</span>
      ) : (
        <span className="text-muted-foreground/50">0</span>
      )}
    </TableCell>
  );
}

/**
 * A scalable, company-centric view of how roles are distributed. Replaces the
 * per-company card stacks so the page stays readable with hundreds of companies.
 */
export function CompanyAssignmentsTable({ onViewCompanyUsers }: CompanyAssignmentsTableProps) {
  const { roster } = useAssignedUsers();
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companiesFromAssignedUserRoster(roster)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({ company: c, tally: tallyCompanyRoles(roster, c.id) }))
      .sort((a, b) => a.company.name.localeCompare(b.company.name));
  }, [roster, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search companies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Company</TableHead>
              <TableHead className="text-center">Admins</TableHead>
              <TableHead className="text-center">Employees</TableHead>
              <TableHead className="text-center">Customers</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No companies match “{query}”.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ company, tally }) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 leading-tight">
                        <p className="truncate text-sm font-medium">{company.name}</p>
                        <div className="mt-0.5">
                          <StatusBadge status={company.status} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <CountCell value={tally.admins} />
                  <CountCell value={tally.employees} />
                  <CountCell value={tally.customers} />
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onViewCompanyUsers(company.id)}>
                          <Users className="h-4 w-4" /> View users
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate("/companies")}>
                          <ExternalLink className="h-4 w-4" /> Open in Companies
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
