/**
 * Series del Dashboard de /admin — módulo PURO. Recibe cobros y altas ya
 * cargados y los reparte en los tramos de Semana / Mes / Año del CALENDARIO
 * de MÉRIDA (@/lib/admin/zona-horaria): la semana en curso de lunes a
 * domingo, el mes en curso entero y el año en curso de enero a diciembre.
 * Con el día del servidor (UTC), lo cobrado por la tarde caía en el día
 * siguiente.
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
/** Lo que abarca cada rango, para la leyenda. */
export const TRAMO_RANGO: Record<Rango, string> = {
  semana: "semana en curso, lunes a domingo",
  mes: "mes en curso completo",
  anio: "año en curso, enero a diciembre",
};

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

/** Partes Y-M-D del día de Mérida en que cae un instante. */
function partesAdmin(fecha: Date): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = diaAdmin(fecha).split("-").map(Number);
  return { anio, mes, dia };
}

/** Clave "YYYY-MM-DD" a partir de partes. */
const claveDia = (anio: number, mes: number, dia: number) =>
  `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

/**
 * Un instante que cae en ese día de Mérida a cualquier hora: mediodía UTC
 * (06:00 / 07:00 en Mérida). Sirve para las etiquetas y para el día de la
 * semana, sin que ningún desfase de zona lo mueva de día.
 */
const anclaDia = (anio: number, mes: number, dia: number) => new Date(Date.UTC(anio, mes - 1, dia, 12));

/**
 * La semana EN CURSO (lunes a domingo) del calendario de Mérida, día por día.
 * Los días que aún no llegan salen con 0: la semana se ve entera.
 */
export function semanaEnCurso(ahora: Date): { clave: string; label: string }[] {
  const { anio, mes, dia } = partesAdmin(ahora);
  const fmtDia = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, weekday: "short" });
  const hoy = anclaDia(anio, mes, dia);
  // getUTCDay: 0 = domingo. Con lunes como primer día, el lunes queda a (día + 6) % 7 días atrás.
  const desdeLunes = (hoy.getUTCDay() + 6) % 7;
  const out: { clave: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(hoy.getTime() + (i - desdeLunes) * DIA_MS);
    out.push({
      clave: claveDia(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      label: `${fmtDia.format(d).replace(".", "")} ${d.getUTCDate()}`,
    });
  }
  return out;
}

/** El mes EN CURSO de Mérida, del 1 al último día. */
export function mesEnCurso(ahora: Date): { clave: string; label: string }[] {
  const { anio, mes } = partesAdmin(ahora);
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const out: { clave: string; label: string }[] = [];
  for (let d = 1; d <= dias; d++) out.push({ clave: claveDia(anio, mes, d), label: String(d) });
  return out;
}

/** El año EN CURSO de Mérida, de enero a diciembre, un tramo por mes. */
export function anioEnCurso(ahora: Date): { clave: string; label: string }[] {
  const { anio } = partesAdmin(ahora);
  const fmt = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, month: "short" });
  const out: { clave: string; label: string }[] = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ clave: `${anio}-${String(m).padStart(2, "0")}`, label: fmt.format(anclaDia(anio, m, 15)).replace(".", "") });
  }
  return out;
}

/** Los últimos `n` meses de Mérida, del más viejo al de hoy (sparklines). */
export function ultimosMesesAdmin(ahora: Date, n: number): { clave: string; label: string }[] {
  const { anio, mes } = partesAdmin(ahora);
  const fmt = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, month: "short" });
  const out: { clave: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anio, mes - 1 - i, 15, 12));
    out.push({
      clave: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: fmt.format(d).replace(".", ""),
    });
  }
  return out;
}

/**
 * La serie del rango pedido, en CALENDARIO de Mérida (ajuste 1 de Rafael):
 *  · semana = lunes a domingo de la semana en curso, por día;
 *  · mes    = el mes en curso completo, por día;
 *  · año    = enero a diciembre del año en curso, por mes.
 * Los tramos sin nada (y los que aún no llegan) valen 0, no desaparecen.
 */
export function serieNegocio(cobros: CobroCrudo[], altas: Date[], ahora: Date, rango: Rango): PuntoNegocio[] {
  const porMeses = rango === "anio";
  const tramos = porMeses ? anioEnCurso(ahora) : rango === "semana" ? semanaEnCurso(ahora) : mesEnCurso(ahora);
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
