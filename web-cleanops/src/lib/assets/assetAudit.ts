/**
 * Asset Center — audit/activity helpers (Phase 1 foundation).
 *
 * Thin, typed convenience wrappers over
 * {@link recordAssetActivityEvent} so callers log lifecycle events with intent
 * (e.g. {@link logAssetUploaded}) instead of assembling raw event payloads. The
 * underlying insert + RLS live in the repository / migration 0055.
 *
 * Audit logging must never break a user flow: {@link safeRecordAssetActivity}
 * swallows + logs errors so a failed audit write cannot abort the calling
 * operation. Callers that need the result can use the repository directly.
 */
import {
  recordAssetActivityEvent,
  type RecordActivityInput,
} from "./assetRepository";
import type { AssetActivityEvent, AssetActivityEventType } from "./assetTypes";

/** All Asset Center activity event types, for menus/filters. */
export const ASSET_ACTIVITY_EVENT_TYPES: readonly AssetActivityEventType[] = [
  "asset_uploaded",
  "asset_updated",
  "asset_archived",
  "asset_restored",
  "asset_deleted",
  "asset_copied_from_global",
  "asset_linked",
  "asset_unlinked",
  "asset_replaced",
  "asset_visibility_changed",
  "public_website_asset_changed",
  "login_page_video_changed",
  "customer_file_uploaded",
  "customer_file_visibility_changed",
];

/**
 * Records an activity event, swallowing (and logging) any failure so audit
 * logging can never abort the calling operation. Returns the event on success,
 * or null when Supabase is unconfigured / the write failed.
 */
export async function safeRecordAssetActivity(
  input: RecordActivityInput,
): Promise<AssetActivityEvent | null> {
  try {
    return await recordAssetActivityEvent(input);
  } catch (err) {
    console.error(`[assetAudit] failed to record ${input.eventType}`, err);
    return null;
  }
}

/** Logs that an asset was uploaded. */
export function logAssetUploaded(
  input: Omit<RecordActivityInput, "eventType">,
): Promise<AssetActivityEvent | null> {
  return safeRecordAssetActivity({ ...input, eventType: "asset_uploaded" });
}

/** Logs that an asset was archived. */
export function logAssetArchived(
  input: Omit<RecordActivityInput, "eventType">,
): Promise<AssetActivityEvent | null> {
  return safeRecordAssetActivity({ ...input, eventType: "asset_archived" });
}

/** Logs that an asset was copied from a global original into a company library. */
export function logAssetCopiedFromGlobal(
  input: Omit<RecordActivityInput, "eventType">,
): Promise<AssetActivityEvent | null> {
  return safeRecordAssetActivity({ ...input, eventType: "asset_copied_from_global" });
}

/** Logs that an asset was placed (linked) onto an entity. */
export function logAssetLinked(
  input: Omit<RecordActivityInput, "eventType">,
): Promise<AssetActivityEvent | null> {
  return safeRecordAssetActivity({ ...input, eventType: "asset_linked" });
}

/** Logs that an asset's visibility changed. */
export function logAssetVisibilityChanged(
  input: Omit<RecordActivityInput, "eventType">,
): Promise<AssetActivityEvent | null> {
  return safeRecordAssetActivity({ ...input, eventType: "asset_visibility_changed" });
}
