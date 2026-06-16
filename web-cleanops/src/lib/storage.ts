import type { StoredFile, User } from "@/types";
import { authorize } from "@/lib/authz";
import { makeId } from "@/lib/store";

/**
 * Secure file storage foundation. This is the abstraction future modules
 * (Expense Receipts, Key Management, Invoices, …) use to persist documents.
 *
 * Two guarantees are enforced here, not in the UI:
 *  1. Tenant isolation — every file belongs to a company and reads are filtered
 *     by the requester's company scope.
 *  2. Permission gating — each file declares the permission key required to read
 *     it, checked against the requester's effective permissions.
 *
 * The current implementation persists metadata to localStorage as a stand-in
 * for an object store + signed-URL backend; the API is deliberately backend
 * shaped so it can be swapped without touching callers.
 */

const FILES_KEY = "cleanops.files";

function readFiles(): StoredFile[] {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as StoredFile[]) : [];
  } catch {
    return [];
  }
}

function writeFiles(files: StoredFile[]): void {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch (err) {
    console.error("Failed to persist file metadata", err);
  }
}

export interface RecordFileInput {
  companyId: string;
  moduleId: string | null;
  name: string;
  mimeType: string;
  size: number;
  /** Permission key a reader must hold; defaults to general settings access. */
  requiredPermission?: string;
}

/** Registers a file's metadata against a company. Returns the stored record. */
export function recordFile(uploader: User, input: RecordFileInput): StoredFile {
  const file: StoredFile = {
    id: makeId("file"),
    companyId: input.companyId,
    moduleId: input.moduleId,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    requiredPermission: input.requiredPermission ?? "settings.manage",
    uploadedBy: uploader.id,
    uploadedAt: new Date().toISOString(),
  };
  writeFiles([file, ...readFiles()]);
  return file;
}

/** Whether a user may read a given file (company scope + permission). */
export function canReadFile(user: User, permissions: string[], file: StoredFile): boolean {
  return authorize({
    user,
    permissions,
    permission: file.requiredPermission,
    resourceCompanyId: file.companyId,
  });
}

/** Lists files the user is allowed to read, optionally filtered by module. */
export function listReadableFiles(
  user: User,
  permissions: string[],
  options?: { moduleId?: string | null },
): StoredFile[] {
  return readFiles().filter((file) => {
    if (options?.moduleId !== undefined && file.moduleId !== options.moduleId) {
      return false;
    }
    return canReadFile(user, permissions, file);
  });
}

/** Removes a file when the requester is authorised to read it. */
export function deleteFile(user: User, permissions: string[], fileId: string): boolean {
  const files = readFiles();
  const target = files.find((f) => f.id === fileId);
  if (!target || !canReadFile(user, permissions, target)) return false;
  writeFiles(files.filter((f) => f.id !== fileId));
  return true;
}
