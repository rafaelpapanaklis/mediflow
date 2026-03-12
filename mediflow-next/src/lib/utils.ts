import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-brand-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-pink-500",
  "bg-cyan-600",
  "bg-amber-500",
  "bg-rose-500",
];

export function pickAvatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}
