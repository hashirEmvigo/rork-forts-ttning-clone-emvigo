import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_BYTES,
  MEDIA_LAYER_SPECS,
  computeScaledDimensions,
  dataUrlByteLength,
  estimateStorageSavings,
  formatBytes,
  isProcessableImage,
  describeImageRejection,
} from "./mediaProcessing";

describe("MEDIA_LAYER_SPECS", () => {
  it("defines three layers smallest-first within target ranges", () => {
    expect(MEDIA_LAYER_SPECS.micro.maxEdge).toBeLessThan(MEDIA_LAYER_SPECS.hover.maxEdge);
    expect(MEDIA_LAYER_SPECS.hover.maxEdge).toBeLessThan(MEDIA_LAYER_SPECS.preview.maxEdge);
    expect(MEDIA_LAYER_SPECS.micro.maxEdge).toBeGreaterThanOrEqual(50);
    expect(MEDIA_LAYER_SPECS.micro.maxEdge).toBeLessThanOrEqual(80);
    expect(MEDIA_LAYER_SPECS.preview.maxEdge).toBeLessThanOrEqual(1400);
  });
});

describe("formatBytes", () => {
  it("returns 0 B for zero or invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(42 * 1024)).toBe("42 KB");
    expect(formatBytes(Math.round(1.3 * 1024 * 1024))).toBe("1.3 MB");
  });
});

describe("computeScaledDimensions", () => {
  it("never upscales when the source is already within the bound", () => {
    expect(computeScaledDimensions(40, 30, 72)).toEqual({ width: 40, height: 30 });
  });

  it("scales the longest edge down to maxEdge, preserving aspect ratio", () => {
    expect(computeScaledDimensions(2000, 1000, 1280)).toEqual({ width: 1280, height: 640 });
  });

  it("scales by height when portrait", () => {
    expect(computeScaledDimensions(1000, 2000, 400)).toEqual({ width: 200, height: 400 });
  });

  it("floors fractional source dimensions and clamps to >= 1px", () => {
    expect(computeScaledDimensions(0.4, 0.4, 72)).toEqual({ width: 1, height: 1 });
  });

  it("handles square images", () => {
    expect(computeScaledDimensions(900, 900, 72)).toEqual({ width: 72, height: 72 });
  });
});

describe("dataUrlByteLength", () => {
  it("returns 0 for an empty payload", () => {
    expect(dataUrlByteLength("data:image/webp;base64,")).toBe(0);
  });

  it("approximates the decoded byte size accounting for padding", () => {
    // "AAAA" => 3 bytes, "AAA=" => 2 bytes, "AA==" => 1 byte
    expect(dataUrlByteLength("data:image/webp;base64,AAAA")).toBe(3);
    expect(dataUrlByteLength("data:image/webp;base64,AAA=")).toBe(2);
    expect(dataUrlByteLength("data:image/webp;base64,AA==")).toBe(1);
  });

  it("works when there is no data URL prefix", () => {
    expect(dataUrlByteLength("AAAA")).toBe(3);
  });
});

describe("estimateStorageSavings", () => {
  it("reports savings when stored is smaller than original", () => {
    const result = estimateStorageSavings(5_000_000, 250_000);
    expect(result.savedBytes).toBe(4_750_000);
    expect(result.savedFraction).toBeCloseTo(0.95, 2);
  });

  it("never reports negative savings", () => {
    const result = estimateStorageSavings(100, 500);
    expect(result.savedBytes).toBe(0);
    expect(result.savedFraction).toBe(0);
  });

  it("avoids dividing by zero", () => {
    expect(estimateStorageSavings(0, 0).savedFraction).toBe(0);
  });
});

describe("isProcessableImage", () => {
  it("accepts common image types within the size cap", () => {
    expect(isProcessableImage({ type: "image/jpeg", size: 2_000_000 })).toBe(true);
    expect(isProcessableImage({ type: "image/png", size: 10 })).toBe(true);
    expect(isProcessableImage({ type: "image/heic", size: 4_000_000 })).toBe(true);
  });

  it("accepts modern phone/screenshot formats (avif, tiff, vendor x-* types)", () => {
    expect(isProcessableImage({ type: "image/avif", size: 557_056 })).toBe(true);
    expect(isProcessableImage({ type: "image/tiff", size: 1000 })).toBe(true);
    expect(isProcessableImage({ type: "image/x-adobe-dng", size: 1000 })).toBe(true);
  });

  it("accepts a typical ~544 KB image (regression for the false 20 MB rejection)", () => {
    expect(isProcessableImage({ type: "image/jpeg", size: 557_056 })).toBe(true);
  });

  it("rejects non-image types", () => {
    expect(isProcessableImage({ type: "application/pdf", size: 1000 })).toBe(false);
    expect(isProcessableImage({ type: "", size: 1000 })).toBe(false);
  });

  it("rejects empty or oversized files", () => {
    expect(isProcessableImage({ type: "image/jpeg", size: 0 })).toBe(false);
    expect(isProcessableImage({ type: "image/jpeg", size: MAX_SOURCE_BYTES + 1 })).toBe(false);
  });
});

describe("describeImageRejection", () => {
  it("returns null for an acceptable file", () => {
    expect(describeImageRejection({ type: "image/jpeg", size: 557_056 })).toBeNull();
  });

  it("distinguishes a too-large file from an unsupported type", () => {
    expect(describeImageRejection({ type: "image/jpeg", size: MAX_SOURCE_BYTES + 1 })).toBe(
      "too_large",
    );
    expect(describeImageRejection({ type: "application/pdf", size: 1000 })).toBe(
      "unsupported_type",
    );
  });

  it("reports an empty file distinctly (never mislabeled as too large)", () => {
    expect(describeImageRejection({ type: "image/jpeg", size: 0 })).toBe("empty");
  });

  it("does NOT flag a 544 KB image as too large", () => {
    expect(describeImageRejection({ type: "image/jpeg", size: 557_056 })).not.toBe("too_large");
  });
});
