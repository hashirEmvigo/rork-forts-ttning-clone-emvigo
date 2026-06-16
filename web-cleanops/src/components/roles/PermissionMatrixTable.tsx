import { Fragment, useMemo, useState } from "react";
import { Check, Minus, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApp } from "@/context/AppContext";
import { PERMISSION_MODULES } from "@/lib/permissions";
import { BASE_ROLE_ORDER, permissionsForBaseRole } from "@/lib/rolesOverview";
import { ROLE_LABELS } from "@/types";

/**
 * A complete permission × role grid. Lets a Super Admin audit and compare what
 * every base role can do at a glance, instead of opening each role separately.
 */
export function PermissionMatrixTable() {
  const { roles } = useApp();
  const [query, setQuery] = useState<string>("");

  const grants = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const baseRole of BASE_ROLE_ORDER) {
      map.set(baseRole, new Set(permissionsForBaseRole(roles, baseRole)));
    }
    return map;
  }, [roles]);

  const modules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PERMISSION_MODULES;
    return PERMISSION_MODULES.map((m) => ({
      ...m,
      permissions: m.permissions.filter(
        (p) => p.label.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
      ),
    })).filter((m) => m.permissions.length > 0);
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search permissions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="min-w-[220px]">Permission</TableHead>
              {BASE_ROLE_ORDER.map((role) => (
                <TableHead key={role} className="text-center">
                  {ROLE_LABELS[role]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No permissions match “{query}”.
                </TableCell>
              </TableRow>
            ) : (
              modules.map((module) => (
                <Fragment key={module.id}>
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell
                      colSpan={5}
                      className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {module.label}
                      {module.comingSoon ? (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                          Soon
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {module.permissions.map((p) => (
                    <TableRow key={p.key}>
                      <TableCell className="text-sm">{p.label}</TableCell>
                      {BASE_ROLE_ORDER.map((role) => {
                        const has = grants.get(role)?.has(p.key) ?? false;
                        return (
                          <TableCell key={role} className="text-center">
                            {has ? (
                              <Check
                                className="mx-auto h-4 w-4 text-success"
                                aria-label={`${ROLE_LABELS[role]} can ${p.label}`}
                              />
                            ) : (
                              <Minus
                                className="mx-auto h-4 w-4 text-muted-foreground/30"
                                aria-label={`${ROLE_LABELS[role]} cannot ${p.label}`}
                              />
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
