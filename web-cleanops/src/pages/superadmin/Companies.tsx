import { useMemo, useState } from "react";
import { Building2, MoreHorizontal, Pencil, Plus, Power, Search } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
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
import { CompanyDialog } from "@/components/companies/CompanyDialog";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import type { Company } from "@/types";

export default function Companies() {
  const { companies, users, updateCompany } = useApp();
  const { toast } = useToast();
  const [query, setQuery] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<Company | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [companies, query]);

  const userCount = (companyId: string): number =>
    users.filter((u) => u.companyId === companyId).length;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    setDialogOpen(true);
  };

  const toggleStatus = async (company: Company) => {
    const next = company.status === "active" ? "inactive" : "active";
    const result = await updateCompany(company.id, { status: next });
    if (result.ok === false) {
      toast({ title: "Could not update company", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: next === "active" ? "Company activated" : "Company deactivated",
      description: `${company.name} is now ${next}.`,
    });
  };

  return (
    <DashboardLayout wide>
      <PageHeader
        title="Companies"
        description="Every organisation on the CleanOps platform. Create, edit and manage their access."
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New company
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search companies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} of {companies.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Company</TableHead>
              <TableHead>Company ID</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Building2 className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No companies match your search.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <span className="font-medium">{company.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{company.id}</span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {userCount(company.id)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={company.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(company.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(company)}>
                          <Pencil className="h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleStatus(company)}
                          className={
                            company.status === "active" ? "text-destructive focus:text-destructive" : ""
                          }
                        >
                          <Power className="h-4 w-4" />
                          {company.status === "active" ? "Deactivate" : "Activate"}
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

      <CompanyDialog open={dialogOpen} onOpenChange={setDialogOpen} company={editing} />
    </DashboardLayout>
  );
}
