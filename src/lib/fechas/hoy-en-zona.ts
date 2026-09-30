// El día de calendario ("YYYY-MM-DD") de un instante en una zona IANA. PURO y
// client-safe: sin Prisma ni nada de servidor.
//
// ws1-t4: vivía en src/lib/whatsapp/cobranza/sweep.ts (que importa Prisma). Al
// usarse desde `cobranza-caso.ts` → `cobranza-modulo.ts` → un componente de
// cliente, el build de producción arrastraba Prisma al navegador y fallaba
// («Can't resolve 'async_hooks'»). sweep.ts lo reexporta para los demás.
export function hoyEnZona(now: Date, timezone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return p; // en-CA da directamente "YYYY-MM-DD"
}
