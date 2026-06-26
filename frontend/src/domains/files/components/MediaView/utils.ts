import { PREVIEWABLE_IMAGE_MIME, NON_PREVIEWABLE_MEDIA_EXTENSIONS } from "./constants";

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isImageFileName(name: string): boolean {
  return extensionOf(name) in PREVIEWABLE_IMAGE_MIME;
}

function isMediaFileName(name: string): boolean {
  const ext = extensionOf(name);
  return ext in PREVIEWABLE_IMAGE_MIME || NON_PREVIEWABLE_MEDIA_EXTENSIONS.has(ext);
}

function mimeForImageName(name: string): string {
  return PREVIEWABLE_IMAGE_MIME[extensionOf(name)] ?? "application/octet-stream";
}

function imageDataUrl(name: string, base64: string): string {
  return `data:${mimeForImageName(name)};base64,${base64}`;
}

export { extensionOf, isImageFileName, isMediaFileName, mimeForImageName, imageDataUrl };
