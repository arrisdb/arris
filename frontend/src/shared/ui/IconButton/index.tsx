import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../Icon";

type IconButtonVariant = "default" | "primary" | "ghost" | "danger";

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: IconName;
  label: string;
  variant?: IconButtonVariant;
  size?: number;
  active?: boolean;
  loading?: boolean;
  loadingIcon?: IconName;
  iconClassName?: string;
}

function IconButton({
  icon,
  label,
  variant = "default",
  size = 14,
  active = false,
  loading = false,
  loadingIcon = "loader",
  iconClassName,
  className,
  title,
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const variantClass =
    variant === "default" ? "" : variant === "primary" ? "primary" : variant === "ghost" ? "ghost" : "danger";
  const buttonClassName = [
    "mdbc-btn",
    variantClass,
    "icon-only",
    active ? "active" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={buttonClassName}
    >
      <Icon
        name={loading ? loadingIcon : icon}
        size={size}
        className={[loading ? "mdbc-spin" : "", iconClassName ?? ""].filter(Boolean).join(" ") || undefined}
      />
    </button>
  );
}

export {
  IconButton,
};

export type {
  IconButtonProps,
};
