import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { mediaViewReadFileBase64IPC, mediaViewOpenInDefaultAppIPC } from "./ipc";
import { extensionOf, imageDataUrl, isImageFileName } from "./utils";
import type { ImageDimensions, MediaViewProps } from "./types";
import "./index.css";

function MediaView({ activeTab }: MediaViewProps) {
  const path = activeTab.filePath ?? null;
  const name = activeTab.title;
  const previewable = isImageFileName(name);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);

  useEffect(() => {
    if (!previewable) return;
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    setDimensions(null);
    if (!path) {
      setError("No file path for this image.");
      return;
    }
    mediaViewReadFileBase64IPC(path)
      .then((base64) => {
        if (!cancelled) setDataUrl(imageDataUrl(name, base64));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [previewable, path, name]);

  const onClickOpenInDefaultApp = () => {
    if (path) mediaViewOpenInDefaultAppIPC(path).catch((err) => console.error("Failed to open file", err));
  };

  const onLoadImage = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  const ext = extensionOf(name);

  const fallback = (message: string) => (
    <div className="mdbc-media-fallback" data-testid="media-fallback">
      <p className="mdbc-media-message">{message}</p>
      <button className="mdbc-btn primary" onClick={onClickOpenInDefaultApp} data-testid="media-open-default">
        Open with default app
      </button>
    </div>
  );

  return (
    <div className="mdbc-media-view" data-testid="media-view">
      {previewable && dimensions && (
        <div className="mdbc-media-infobar" data-testid="media-infobar">
          <span className="mdbc-media-dimensions">
            {dimensions.width} × {dimensions.height} px
          </span>
        </div>
      )}
      <div className="mdbc-media-body">
        {!previewable
          ? fallback(`Preview isn't supported for ${ext ? `.${ext}` : "this"} files.`)
          : error
            ? fallback(error)
            : dataUrl
              ? (
                <img
                  className="mdbc-media-image"
                  src={dataUrl}
                  alt={name}
                  data-testid="media-image"
                  onLoad={onLoadImage}
                />
              )
              : <div className="mdbc-media-loading">Loading…</div>}
      </div>
    </div>
  );
}

export { MediaView };
