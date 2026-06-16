import type { MediaLayer } from "@/types";

/**
 * Client-side image processing for the Media Foundation.
 *
 * The pipeline is deliberately "speed and storage first, quality second":
 * a picked / captured image is decoded once and re-encoded into three small
 * WebP layers. The original is never persisted — only the derived layers leave
 * the device. This keeps uploads in the hundreds-of-KB range instead of MB.
 *
 * Pure helpers (dimension math, savings estimates, validation) live alongside
 * the browser-only encode step so the logic can be unit-tested without a real
 * canvas.
 */

/** Encoding spec for a single layer. */
export interface LayerSpec {
  layer: MediaLayer;
  /** Longest-edge target in pixels. The image is scaled to fit within this. */
  maxEdge: number;
  /** WebP quality 0–1. Low on purpose — speed/size over fidelity. */
  quality: number;
  /** Informational target byte range, used for reporting. */
  targetBytes: [number, number];
}

/**
 * The three layers, smallest first. Sizes follow the Media Foundation V1 spec:
 *  - micro:   ~50–80px,    5–15 KB  — lists & grids
 *  - hover:   ~300–500px,  20–80 KB — hover / popover previews
 *  - preview: ~1000–1400px,100–300 KB — image viewer
 */
export const MEDIA_LAYER_SPECS: Record<MediaLayer, LayerSpec> = {
  micro: { layer: "micro", maxEdge: 72, quality: 0.6, targetBytes: [5_120, 15_360] },
  hover: { layer: "hover", maxEdge: 400, quality: 0.7, targetBytes: [20_480, 81_920] },
  preview: { layer: "preview", maxEdge: 1280, quality: 0.72, targetBytes: [102_400, 307_200] },
};

/**
 * Accepted source image MIME types. Kept broad on purpose: anything the browser
 * labels as `image/*` is worth attempting to decode (the `<img>` decode step is
 * the real gate). Modern phone/screenshot formats like `avif` are included; the
 * `accept="image/*"` picker already filters non-images at the OS level.
 */
const ACCEPTED_MIME = /^image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif|avif|tiff?|x-[\w.-]+)$/i;

/** Hard cap on the source file we will attempt to decode (20 MB). */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Why a file was rejected before/at processing, for precise user messaging + logs. */
export type ImageRejectionReason = "empty" | "too_large" | "unsupported_type";

/**
 * Inspects a file and returns the specific reason it cannot be processed, or
 * `null` when it is acceptable. Callers should prefer this over the boolean
 * {@link isProcessableImage} so they can surface an accurate message instead of
 * a generic "too large" error.
 */
export function describeImageRejection(file: {
  type: string;
  size: number;
}): ImageRejectionReason | null {
  if (file.size <= 0) return "empty";
  if (file.size > MAX_SOURCE_BYTES) return "too_large";
  if (!ACCEPTED_MIME.test(file.type)) return "unsupported_type";
  return null;
}

export interface ProcessedLayer {
  layer: MediaLayer;
  /** WebP data URL for this layer. */
  url: string;
  width: number;
  height: number;
  /** Approximate encoded size in bytes. */
  bytes: number;
}

export interface ProcessedImage {
  micro: ProcessedLayer;
  hover: ProcessedLayer;
  preview: ProcessedLayer;
  /** Intrinsic source dimensions. */
  sourceWidth: number;
  sourceHeight: number;
  /** Combined encoded size of all three layers, in bytes. */
  totalBytes: number;
}

/** Whether a file looks like a processable image within the size cap. */
export function isProcessableImage(file: { type: string; size: number }): boolean {
  return describeImageRejection(file) === null;
}

/**
 * Scales source dimensions so the longest edge fits within `maxEdge`, never
 * upscaling. Returns integer pixel dimensions (min 1px each).
 */
export function computeScaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(sourceWidth));
  const h = Math.max(1, Math.floor(sourceHeight));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Rough byte size of a base64 data URL payload. */
export function dataUrlByteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (base64.length === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Formats a byte count into a compact human-readable string (e.g. "42 KB",
 * "1.3 MB"). Used by usage / billing-preparation reporting surfaces.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const rounded = value >= 100 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}

export interface StorageSavingsEstimate {
  originalBytes: number;
  storedBytes: number;
  savedBytes: number;
  /** 0–1 fraction of the original avoided. */
  savedFraction: number;
}

/**
 * Estimates the storage / bandwidth saved versus persisting the original,
 * given the source file size and the total stored (processed) size.
 */
export function estimateStorageSavings(
  originalBytes: number,
  storedBytes: number,
): StorageSavingsEstimate {
  const saved = Math.max(0, originalBytes - storedBytes);
  return {
    originalBytes,
    storedBytes,
    savedBytes: saved,
    savedFraction: originalBytes > 0 ? saved / originalBytes : 0,
  };
}

/** Decodes a File / Blob into an HTMLImageElement via an object URL. */
function decodeImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image."));
    };
    img.src = objectUrl;
  });
}

/** Encodes an image element into one WebP layer using a canvas. */
function encodeLayer(img: HTMLImageElement, spec: LayerSpec): ProcessedLayer {
  const { width, height } = computeScaledDimensions(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    spec.maxEdge,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(img, 0, 0, width, height);
  const url = canvas.toDataURL("image/webp", spec.quality);
  return { layer: spec.layer, url, width, height, bytes: dataUrlByteLength(url) };
}

/**
 * Processes a source image File into the three WebP layers. The decoded source
 * is released immediately after encoding — it is never returned or stored.
 *
 * @throws if the file is not a processable image or decoding fails.
 */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  if (!isProcessableImage(file)) {
    throw new Error("Unsupported or oversized image file.");
  }
  const img = await decodeImage(file);
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;

  const micro = encodeLayer(img, MEDIA_LAYER_SPECS.micro);
  const hover = encodeLayer(img, MEDIA_LAYER_SPECS.hover);
  const preview = encodeLayer(img, MEDIA_LAYER_SPECS.preview);

  return {
    micro,
    hover,
    preview,
    sourceWidth,
    sourceHeight,
    totalBytes: micro.bytes + hover.bytes + preview.bytes,
  };
}
