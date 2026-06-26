/** Image extensions previewed inline in the media viewer, mapped to MIME type. */
const PREVIEWABLE_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

/**
 * Non-image media/binary extensions that open in a media tab but cannot be
 * previewed inline; the tab offers "Open with default app" instead.
 */
const NON_PREVIEWABLE_MEDIA_EXTENSIONS = new Set<string>([
  "mp3", "wav", "flac", "aac", "ogg", "m4a",
  "mp4", "mov", "avi", "mkv", "webm",
  "pdf",
]);

export { PREVIEWABLE_IMAGE_MIME, NON_PREVIEWABLE_MEDIA_EXTENSIONS };
