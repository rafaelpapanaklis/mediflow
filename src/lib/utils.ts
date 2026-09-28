import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** Fecha de calendario sin hora: «2026-09-28». Nada más casa. */
const FECHA_SIN_HORA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(date: Date | string) {
  // Una fecha SIN hora es un día del calendario, no un instante. `new Date("2026-09-28")`
  // la lee como medianoche UTC y en México (UTC−6) se pintaba «27 sep»: un día antes.
  // Se arma con sus partes y se formatea en UTC para que salga el mismo día que se guardó.
  // Los strings con hora y los objetos Date siguen como siempre (zona del navegador/servidor).
  if (typeof date === "string") {
    const partes = FECHA_SIN_HORA.exec(date);
    if (partes) {
      const calendario = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
      return calendario.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
  }
  return new Date(date).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
}

const AVATAR_COLORS = ["bg-violet-500","bg-blue-600","bg-emerald-600","bg-pink-500","bg-cyan-600","bg-amber-500","bg-rose-500","bg-indigo-500"];
export function avatarColor(id: string) {
  return AVATAR_COLORS[(id?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}
