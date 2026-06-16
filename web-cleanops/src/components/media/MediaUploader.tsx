import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useApp } from "@/context/AppContext";
import { authorize } from "@/lib/authz";
import {
  describeImageRejection,
  estimateStorageSavings,
  formatBytes,
  processImageFile,
  type ProcessedImage,
  type StorageSavingsEstimate,
} from "@/lib/mediaProcessing";
import { createMediaAsset, MEDIA_MANAGE_PERMISSION } from "@/lib/mediaStore";
import {
  describeEntitlementBlock,
  describePermissionBlock,
} from "@/lib/mediaUploadMessaging";
import type { MediaAsset, MediaCategory, MediaEntityType } from "@/types";

/**
 * Entity binding for the persisting mode. When supplied, processed images are
 * stored as company-scoped {@link MediaAsset}s via the media store.
 */
export interface MediaUploaderBinding {
  companyId: string;
  category: MediaCategory;
  entityType: MediaEntityType;
  entityId: string;
}

interface MediaUploaderProps {
  /**
   * Persisting mode: bind to an entity and the uploader stores a MediaAsset for
   * each processed image, calling {@link onUploaded} with the result.
   */
  binding?: MediaUploaderBinding;
  onUploaded?: (asset: MediaAsset) => void;
  /**
   * Processing-only mode: receive the compressed layers and handle persistence
   * yourself (e.g. checklist nodes that store layers inline). The original is
   * still discarded.
   */
  onProcessed?: (processed: ProcessedImage, savings: StorageSavingsEstimate) => void;
  /** Allow selecting more than one file at once. */
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/**
 * The single upload experience for the whole platform. It runs the
 * client-side pipeline ({@link processImageFile}) on every selected file and
 * then either persists a {@link MediaAsset} (entity-bound mode) or hands the
 * compressed layers back to the caller (processing-only mode).
 *
 * The source/original file is decoded once and never persisted — only the
 * three derived WebP layers leave this component.
 */
export function MediaUploader({
  binding,
  onUploaded,
  onProcessed,
  multiple = false,
  disabled = false,
  label = "Upload",
  variant = "outline",
  size = "sm",
  className,
}: MediaUploaderProps) {
  const { toast } = useToast();
  const { currentUser, getUserPermissions, evaluateMediaUploadGate } = useApp();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<boolean>(false);
  // When an admin is blocked by entitlement/trial, we offer activation here.
  const [activatePrompt, setActivatePrompt] = useState<
    { title: string; description: string } | null
  >(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // Upload gate order (entity-bound mode only — processing-only callers are
    // exempt): 1) permission → 2) service entitlement → 3) trial limit. Each
    // failure produces an accurate, role-aware message instead of reusing the
    // generic permission error.
    if (binding) {
      // 1) Permission: does the user actually hold the media.manage right for
      //    this company? A genuine permission failure keeps the security message.
      const hasUploadPermission =
        currentUser != null &&
        authorize({
          user: currentUser,
          permissions: getUserPermissions(currentUser),
          permission: MEDIA_MANAGE_PERMISSION,
          resourceCompanyId: binding.companyId,
        });
      if (!hasUploadPermission) {
        const msg = describePermissionBlock();
        toast({ title: msg.title, description: msg.description, variant: "destructive" });
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      // 2) + 3) Service entitlement / trial limit. The user has permission but
      //    the company's Media Uploads service may be disabled or its trial
      //    exhausted. Existing images are never affected — only new uploads.
      const gate = evaluateMediaUploadGate(binding.companyId);
      if (!gate.allowed) {
        const msg = describeEntitlementBlock(gate, currentUser!.role);
        if (inputRef.current) inputRef.current.value = "";
        if (msg.canActivate) {
          // Admins get an actionable prompt that routes to the Services dashboard.
          setActivatePrompt({ title: msg.title, description: msg.description });
        } else {
          toast({ title: msg.title, description: msg.description, variant: "destructive" });
        }
        return;
      }
    }

    setBusy(true);

    let stored = 0;
    let savedBytes = 0;
    let blockedByLimit = false;
    // Track distinct failure reasons so we can surface an accurate message
    // instead of a misleading catch-all (the 544 KB "20 MB" bug).
    const failureReasons: string[] = [];

    for (const file of files) {
      const rejection = describeImageRejection(file);
      if (rejection !== null) {
        const reason =
          rejection === "too_large"
            ? `Maximum file size is 20 MB (this file is ${formatBytes(file.size)}).`
            : rejection === "empty"
              ? "The file is empty."
              : `Unsupported image format${file.type ? ` (${file.type})` : ""}.`;
        console.warn("[MediaUploader] rejected before processing", {
          name: file.name,
          type: file.type || "(none)",
          size: file.size,
          reason: rejection,
        });
        failureReasons.push(reason);
        continue;
      }
      // Re-check within the batch so a trial limit is respected mid-upload.
      if (binding && !evaluateMediaUploadGate(binding.companyId).allowed) {
        blockedByLimit = true;
        break;
      }
      try {
        const processed = await processImageFile(file);
        const savings = estimateStorageSavings(file.size, processed.totalBytes);
        savedBytes += savings.savedBytes;

        if (binding) {
          if (!currentUser) {
            failureReasons.push("You must be signed in to upload images.");
            continue;
          }
          const asset = createMediaAsset(
            currentUser,
            getUserPermissions(currentUser),
            {
              companyId: binding.companyId,
              category: binding.category,
              entityType: binding.entityType,
              entityId: binding.entityId,
              processed,
            },
          );
          if (!asset) {
            console.warn("[MediaUploader] createMediaAsset denied", {
              name: file.name,
              companyId: binding.companyId,
              category: binding.category,
              entityType: binding.entityType,
            });
            failureReasons.push(describePermissionBlock().description);
            continue;
          }
          onUploaded?.(asset);
        } else {
          onProcessed?.(processed, savings);
        }
        stored += 1;
      } catch (err) {
        console.warn("[MediaUploader] processing failed", {
          name: file.name,
          type: file.type || "(none)",
          size: file.size,
          error: err instanceof Error ? err.message : String(err),
        });
        failureReasons.push(
          "Could not read this image — the format may be unsupported by your browser.",
        );
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";

    if (stored > 0) {
      toast({
        title: stored === 1 ? "Image uploaded" : `${stored} images uploaded`,
        description: `Compressed only — saved about ${formatBytes(savedBytes)} versus the originals.`,
      });
    }
    if (failureReasons.length > 0) {
      // Show the most common specific reason rather than a generic size error.
      const description = Array.from(new Set(failureReasons)).join(" ");
      toast({
        title: stored > 0 ? "Some images were skipped" : "Upload failed",
        description,
        variant: "destructive",
      });
    }
    if (blockedByLimit) {
      toast({
        title: "Trial limit reached",
        description:
          "Contact your administrator to enable Media Uploads to add more images.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <AlertDialog
        open={activatePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setActivatePrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{activatePrompt?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {activatePrompt?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setActivatePrompt(null);
                navigate("/services");
              }}
            >
              Activate Service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
