/**
 * Series del Dashboard de /admin — módulo PURO. Recibe cobros y altas ya
 * cargados y los reparte en los tramos de Semana / Mes / Año con los cortes
 * del calendario de MÉRIDA (@/lib/admin/zona-horaria), que es el criterio de
 * fecha de todo el panel: con el día del servidor (UTC), lo cobrado por la
 * tarde caía en el día siguiente.
 *
 *  · Ingresos = subscription_invoices con status `paid`, por `paidAt ?? createdAt`
 *    (el mismo criterio que «Cobrado este mes»).
 *  · Altas    = Clinic.createdAt.
 *  · Pagos    = cuántos cobros `paid` hubo en el tramo.
 *
 * Se prueba con `npm run test:admin-uso`.
 */
import { diaAdmin, LOCALE_ADMIN, ZONA_ADMIN } from "@/lib/admin/zona-horaria";

export type Rango = "semana" | "mes" | "anio";

export const ETIQUETA_RANGO: Record<Rango, string> = { semana: "Semana", mes: "Mes", anio: "Año" };

export interface CobroCrudo {
  monto: number;
  cuando: Date;
}

export interface PuntoNegocio {
  /** "YYYY-MM-DD" o "YYYY-MM": para React y para las pruebas. */
  clave: string;
  /** Lo que se lee en el eje. */
  label: string;
  ingresos: number;
  altas: number;
  pagos: number;
}

const DIA_MS = 86_400_000;

/** Clave "YYYY-MM" del mes de Mérida. */
function mesDe(fecha: Date): string {
  return diaAdmin(fecha).slice(0, 7);
}

/** Los últimos `n` días del calendario de Mérida, hoy incluido, del más viejo al de hoy. */
function ultimosDias(ahora: Date, n: number): { clave: string; label: string }[] {
  const fmt = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, day: "numeric", month: "short" });
  const fmtDia = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, weekday: "short" });
  const out: { clave: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ahora.getTime() - i * DIA_MS);
    out.push({
      clave: diaAdmin(d),
      label: n <= 7 ? `${fmtDia.format(d)} ${fmt.format(d).split(" ")[0]}` : fmt.format(d),
    });
  }
  return out;
}

/** Los últimos `n` meses de Mérida, del más viejo al de hoy. */
export function ultimosMesesAdmin(ahora: Date, n: number): { clave: string; label: string }[] {
  const [anio, mes] = mesDe(ahora).split("-").map(Number);
  const fmt = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, month: "short" });
  const out: { clave: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Día 15 a mediodía UTC: ningún desfase de zona lo saca de su mes.
    const d = new Date(Date.UTC(anio, mes - 1 - i, 15, 12));
    out.push({
      clave: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: fmt.format(d).replace(".", ""),
    });
  }
  return out;
}

export const DIAS_SEMANA = 7;
export const DIAS_MES = 30;
export const MESES_ANIO = 12;

/** La serie del rango pedido. Los tramos sin nada valen 0, no desaparecen. */
export function serieNegocio(cobros: CobroCrudo[], altas: Date[], ahora: Date, rango: Rango): PuntoNegocio[] {
  const porMeses = rango === "anio";
  const tramos = porMeses
    ? ultimosMesesAdmin(ahora, MESES_ANIO)
    : ultimosDias(ahora, rango === "semana" ? DIAS_SEMANA : DIAS_MES);
  const claveDe = (d: Date) => (porMeses ? mesDe(d) : diaAdmin(d));

  const mapa = new Map<string, PuntoNegocio>();
  for (const t of tramos) mapa.set(t.clave, { clave: t.clave, label: t.label, ingresos: 0, altas: 0, pagos: 0 });

  for (const c of cobros) {
    const p = mapa.get(claveDe(c.cuando));
    if (!p) continue;
    p.ingresos += c.monto || 0;
    p.pagos += 1;
  }
  for (const a of altas) {
    const p = mapa.get(claveDe(a));
    if (p) p.altas += 1;
  }
  return tramos.map((t) => mapa.get(t.clave)!);
}

/** Cuántas fechas caen en cada uno de los últimos `meses` meses (para un sparkline). */
export function conteoMensual(fechas: Date[], ahora: Date, meses: number): number[] {
  const tramos = ultimosMesesAdmin(ahora, meses);
  const idx = new Map(tramos.map((t, i) => [t.clave, i]));
  const out = new Array<number>(tramos.length).fill(0);
  for (const f of fechas) {
    const i = idx.get(mesDe(f));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}

/** Suma de `monto` por mes, mismos tramos que `conteoMensual`. */
export function sumaMensual(cobros: CobroCrudo[], ahora: Date, meses: number): number[] {
  const tramos = ultimosMesesAdmin(ahora, meses);
  const idx = new Map(tramos.map((t, i) => [t.clave, i]));
  const out = new Array<number>(tramos.length).fill(0);
  for (const c of cobros) {
    const i = idx.get(mesDe(c.cuando));
    if (i !== undefined) out[i] += c.monto || 0;
  }
  return out;
}

/** Suma por mes de valores ya agrupados por periodo "YYYY-MM" (p. ej. cfdi_usage.stamped). */
export function sumaPorPeriodo(filas: { period: string; valor: number }[], ahora: Date, meses: number): number[] {
  const tramos = ultimosMesesAdmin(ahora, meses);
  const idx = new Map(tramos.map((t, i) => [t.clave, i]));
  const out = new Array<number>(tramos.length).fill(0);
  for (const f of filas) {
    const i = idx.get(f.period);
    if (i !== undefined) out[i] += f.valor || 0;
  }
  return out;
}
