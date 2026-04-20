import type { ButtonHTMLAttributes, ReactNode } from "react";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
type BtnSize = "sm";

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function ButtonNew({
  variant = "secondary",
  size,
  icon,
  children,
  className,
  ...rest
}: BtnProps) {
  const cls = [
    "btn-new",
    `btn-new--${variant}`,
    size ? `btn-new--${size}` : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}
