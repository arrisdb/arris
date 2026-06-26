import type { CSSProperties } from "react";

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="mdbc-spinner"
      style={{ "--mdbc-spinner-size": `${size}px` } as CSSProperties}
    />
  );
}

// Inject keyframes once.
if (typeof document !== "undefined" && !document.getElementById("arris-spin-style")) {
  const style = document.createElement("style");
  style.id = "arris-spin-style";
  style.textContent =
    "@keyframes arris-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}

export {
  Spinner,
};
