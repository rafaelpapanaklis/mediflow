// Atom: Botón con variants alineados al design system MediFlow violet.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "emerald"
  | "rose"
  | "violet-soft"
  | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-violet-600 hover:bg-violet-700 text-white border-violet-600 shadow-sm",
  secondary:
    "bg-white hover:bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700",
  ghost:
    "bg-transparent hover:bg-slate-100 text-slate-700 border-transparent dark:hover:bg-slate-800 dark:text-slate-300",
  emerald:
    "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 shadow-sm",
  rose: "bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-sm",
  "violet-soft":
    "bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:hover:bg-violet-900/50 dark:text-violet-200 dark:border-violet-800",
  danger:
    "bg-white hover:bg-rose-50 text-rose-600 border-rose-200 dark:bg-slate-900 dark:hover:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs gap-1.5",
  md: "px-3 py-1.5 text-sm gap-1.5",
  lg: "px-4 py-2 text-sm gap-2",
};

export interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Btn({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  type = "button",
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center border rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-violet-300 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
