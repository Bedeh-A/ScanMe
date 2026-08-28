import type { ImageDetails, ScanSource } from "./types";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;

export class ImageInputError extends Error {
  constructor(
    message: string,
    public readonly code: "unsupported" | "too-large" | "too-many-pixels" | "unreadable",
  ) {
    super(message);
    this.name = "ImageInputError";
  }
}

export async function prepareImage(file: File, source: ScanSource): Promise<ImageDetails> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    throw new ImageInputError(
      "Choose a PNG, JPEG, WebP, GIF, or BMP screenshot.",
      "unsupported",
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageInputError("That image is larger than the 25 MB limit.", "too-large");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageInputError("The browser could not read that image.", "unreadable");
  }

  const { width, height } = bitmap;
  bitmap.close();

  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageInputError(
      "That image is too large to process safely. Keep it under 50 megapixels.",
      "too-many-pixels",
    );
  }

  return {
    file,
    source,
    width,
    height,
    url: URL.createObjectURL(file),
  };
}

export function imageFromClipboard(items: DataTransferItemList): File | null {
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
