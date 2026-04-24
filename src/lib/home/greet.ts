// src/lib/home/greet.ts

export function timeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function formatLongDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(now)
    .toLowerCase();
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  if (diffH < 24) return `hace ${diffH} h`;
  if (diffD === 1) return "ayer";
  if (diffD < 7) return `hace ${diffD} días`;
  const weeks = Math.floor(diffD / 7);
  if (diffD < 30) return `hace ${weeks} sem`;
  const months = Math.floor(diffD / 30);
  if (diffD < 365) return `hace ${months} mes${months === 1 ? "" : "es"}`;
  const years = Math.floor(diffD / 365);
  return `hace ${years} año${years === 1 ? "" : "s"}`;
}

export function formatTimeUntil(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "ya pasó";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `en ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  if (diffH < 6)
    return rem === 0 ? `en ${diffH} h` : `en ${diffH} h ${rem} min`;
  return `en ${diffH} h`;
}

export function formatShortTime(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
