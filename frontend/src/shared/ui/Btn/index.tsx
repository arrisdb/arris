import type { CSSProperties, MouseEvent, ReactNode } from "react";

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  style,
  title,
}: {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost" | "danger";
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`mdbc-btn ${variant === "primary" ? "primary" : variant === "ghost" ? "ghost" : variant === "danger" ? "danger" : ""}`}
      style={style}
    >
      {children}
    </button>
  );
}

export {
  Btn,
};
