// Helpers de formato — usados por las pages refactorizadas al estilo Claude Design.

// Un monto negativo lleva el signo ANTES del $ («-$50.00», no «$-50.00»). Un
// negativo que redondea a cero se pinta sin signo («$0», nunca «-$0»).
function pesosConSigno(n: number, decimales: 0 | 2): string {
  const v = Number.isFinite(n) ? n : 0;
  const cuerpo = Math.abs(v).toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  const esCero = Number(Math.abs(v).toFixed(decimales)) === 0;
  return (v < 0 && !esCero ? "-" : "") + "$" + cuerpo;
}

export const fmtMXN = (n: number): string => pesosConSigno(n ?? 0, 0);

export const fmtMXNdec = (n: number): string => pesosConSigno(n ?? 0, 2);

export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 0)  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7)  return `Hace ${days}d`;
  if (days < 30) return `Hace ${Math.floor(days / 7)}sem`;
  if (days < 365) return `Hace ${Math.floor(days / 30)}m`;
  return d.toLocaleDateString("es-MX");
}

export function ageFromDob(dob: Date | string | null | undefined): number | null {
  if (!dob) return null;
  const d = typeof dob === "string" ? new Date(dob) : dob;
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
