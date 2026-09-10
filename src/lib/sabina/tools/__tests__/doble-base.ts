/**
 * DOBLE DE BASE con DOS CLÍNICAS — el instrumento con el que se demuestra que
 * ninguna herramienta cruza el tenant.
 *
 * No es un stub que devuelve lo que le pidan: es un pequeño evaluador de `where`
 * sobre filas en memoria. Eso es justo lo que le da valor a las pruebas de fuga.
 * Si una herramienta se dejara el `clinicId` —o lo pasara como `undefined`, que
 * es el fallo que persigue la regla (c) de CLAUDE.md— este doble se comporta
 * EXACTAMENTE como Prisma: descarta la clave y devuelve las filas de las dos
 * clínicas. La prueba falla, y falla por el motivo correcto.
 *
 * Cubre solo lo que las diez herramientas usan de verdad: findMany, count,
 * aggregate, groupBy, distinct, orderBy, take, select con relaciones anidadas, y
 * los filtros AND/OR/NOT, in/notIn/not, gt/gte/lt/lte, contains, isEmpty, has,
 * some/is. `$queryRaw` LANZA a propósito (ver abajo).
 */

import type { SabinaDb } from "../../tipos";

export type Fila = Record<string, any>;

export interface Datos {
  clinics?: Fila[];
  clinicSchedules?: Fila[];
  resources?: Fila[];
  users?: Fila[];
  patients?: Fila[];
  appointments?: Fila[];
  invoices?: Fila[];
  payments?: Fila[];
  records?: Fila[];
}

interface Relacion {
  modelo: string;
  via: (fila: Fila, otra: Fila) => boolean;
  lista: boolean;
}

/** Relaciones que el doble sabe resolver, por modelo. */
const RELACIONES: Record<string, Record<string, Relacion>> = {
  appointment: {
    patient: { modelo: "patients", via: (a, p) => a.patientId === p.id, lista: false },
    doctor: { modelo: "users", via: (a, u) => a.doctorId === u.id, lista: false },
  },
  patient: {
    appointments: { modelo: "appointments", via: (p, a) => a.patientId === p.id, lista: true },
    invoices: { modelo: "invoices", via: (p, i) => i.patientId === p.id, lista: true },
    records: { modelo: "records", via: (p, r) => r.patientId === p.id, lista: true },
  },
  invoice: {
    patient: { modelo: "patients", via: (i, p) => i.patientId === p.id, lista: false },
    payments: { modelo: "payments", via: (i, g) => g.invoiceId === i.id, lista: true },
  },
  payment: {
    invoice: { modelo: "invoices", via: (g, i) => g.invoiceId === i.id, lista: false },
  },
};

const MODELO_DE: Record<string, string> = {
  appointment: "appointments",
  patient: "patients",
  invoice: "invoices",
  payment: "payments",
  clinic: "clinics",
  resource: "resources",
  clinicSchedule: "clinicSchedules",
  user: "users",
  record: "records",
};

/** Cuántas consultas se han hecho, por modelo y operación. Para vigilar el pooler. */
export interface Contador {
  llamadas: Array<{ modelo: string; op: string }>;
}

export type BaseDoble = SabinaDb & { contador: Contador };

export function crearBase(datos: Datos): BaseDoble {
  const tablas: Record<string, Fila[]> = {
    clinics: datos.clinics ?? [],
    clinicSchedules: datos.clinicSchedules ?? [],
    resources: datos.resources ?? [],
    users: datos.users ?? [],
    patients: datos.patients ?? [],
    appointments: datos.appointments ?? [],
    invoices: datos.invoices ?? [],
    payments: datos.payments ?? [],
    records: datos.records ?? [],
  };
  const contador: Contador = { llamadas: [] };

  function filtrar(entidad: string, where: any): Fila[] {
    const filas = tablas[MODELO_DE[entidad]] ?? [];
    return filas.filter((f) => coincide(entidad, f, where, tablas));
  }

  function delegado(entidad: string) {
    return {
      async findMany(args: any = {}): Promise<Fila[]> {
        contador.llamadas.push({ modelo: entidad, op: "findMany" });
        let out = filtrar(entidad, args.where);
        out = ordenar(out, args.orderBy);
        if (Array.isArray(args.distinct) && args.distinct.length > 0) {
          const vistos: Record<string, true> = {};
          out = out.filter((f) => {
            const k = args.distinct.map((c: string) => String(f[c])).join(" ");
            if (vistos[k]) return false;
            vistos[k] = true;
            return true;
          });
        }
        if (typeof args.skip === "number") out = out.slice(args.skip);
        if (typeof args.take === "number") out = out.slice(0, args.take);
        return out.map((f) => proyectar(entidad, f, args.select, tablas));
      },
      async count(args: any = {}): Promise<number> {
        contador.llamadas.push({ modelo: entidad, op: "count" });
        return filtrar(entidad, args.where).length;
      },
      async findFirst(args: any = {}): Promise<Fila | null> {
        contador.llamadas.push({ modelo: entidad, op: "findFirst" });
        const out = ordenar(filtrar(entidad, args.where), args.orderBy);
        return out.length ? proyectar(entidad, out[0], args.select, tablas) : null;
      },
      async aggregate(args: any = {}): Promise<Fila> {
        contador.llamadas.push({ modelo: entidad, op: "aggregate" });
        const filas = filtrar(entidad, args.where);
        return {
          _sum: sumar(filas, args._sum),
          _count: filas.length,
          _max: maximos(filas, args._max),
        };
      },
      async groupBy(args: any = {}): Promise<Fila[]> {
        contador.llamadas.push({ modelo: entidad, op: "groupBy" });
        const filas = filtrar(entidad, args.where);
        const by: string[] = args.by ?? [];
        const grupos: Record<string, Fila[]> = {};
        for (const f of filas) {
          const k = by.map((c) => String(f[c])).join(" ");
          if (!grupos[k]) grupos[k] = [];
          grupos[k].push(f);
        }
        let out = Object.keys(grupos).map((k) => {
          const g = grupos[k];
          const fila: Fila = {};
          for (const c of by) fila[c] = g[0][c];
          if (args._sum) fila._sum = sumar(g, args._sum);
          if (args._max) fila._max = maximos(g, args._max);
          if (args._count) fila._count = args._count._all ? { _all: g.length } : g.length;
          return fila;
        });
        out = ordenarGrupos(out, args.orderBy);
        if (typeof args.take === "number") out = out.slice(0, args.take);
        return out;
      },
    };
  }

  return {
    contador,
    appointment: delegado("appointment") as any,
    patient: delegado("patient") as any,
    invoice: delegado("invoice") as any,
    payment: delegado("payment") as any,
    clinic: delegado("clinic") as any,
    resource: delegado("resource") as any,
    clinicSchedule: delegado("clinicSchedule") as any,
    /**
     * A propósito LANZA. El doble no habla SQL, y eso ejercita el camino
     * DEGRADADO del buscador —el `contains` de siempre— que es el que el repo
     * documenta como la caída correcta cuando la consulta normalizada no se
     * puede hacer. El criterio de la consulta normalizada se prueba aparte,
     * contra `buildPatientSearchSql`, en buscar-paciente.test.ts.
     */
    async $queryRaw(): Promise<any[]> {
      throw new Error("el doble de base no ejecuta SQL crudo");
    },
  } as BaseDoble;
}

/* ── el evaluador de `where` ─────────────────────────────────────────── */

function coincide(entidad: string, fila: Fila, where: any, tablas: Record<string, Fila[]>): boolean {
  if (where === undefined || where === null) return true;
  for (const clave of Object.keys(where)) {
    const cond = where[clave];
    // 🔴 AQUÍ ESTÁ EL FALLO QUE SE PERSIGUE, REPRODUCIDO TAL CUAL.
    // Prisma DESCARTA la clave cuyo valor es `undefined`: `{ clinicId: undefined }`
    // no filtra nada y devuelve las filas de TODAS las clínicas (regla (c) de
    // CLAUDE.md). Si el doble lo tratara como «ninguna fila coincide», una
    // herramienta con el tenant a medias PASARÍA la prueba de fuga, que es
    // justo lo contrario de lo que hace falta.
    if (cond === undefined) continue;
    if (clave === "AND") {
      const lista = Array.isArray(cond) ? cond : [cond];
      if (!lista.every((c) => coincide(entidad, fila, c, tablas))) return false;
      continue;
    }
    if (clave === "OR") {
      const lista = Array.isArray(cond) ? cond : [cond];
      if (lista.length > 0 && !lista.some((c) => coincide(entidad, fila, c, tablas))) return false;
      continue;
    }
    if (clave === "NOT") {
      const lista = Array.isArray(cond) ? cond : [cond];
      if (lista.some((c) => coincide(entidad, fila, c, tablas))) return false;
      continue;
    }
    const rel = RELACIONES[entidad] ? RELACIONES[entidad][clave] : undefined;
    if (rel) {
      if (!coincideRelacion(rel, fila, cond, tablas)) return false;
      continue;
    }
    if (!coincideCampo(fila[clave], cond)) return false;
  }
  return true;
}

function entidadDeModelo(modelo: string): string {
  const claves = Object.keys(MODELO_DE);
  for (let i = 0; i < claves.length; i++) {
    if (MODELO_DE[claves[i]] === modelo) return claves[i];
  }
  return "";
}

function coincideRelacion(
  rel: Relacion,
  fila: Fila,
  cond: any,
  tablas: Record<string, Fila[]>,
): boolean {
  const entidadRel = entidadDeModelo(rel.modelo);
  const relacionadas = (tablas[rel.modelo] ?? []).filter((o) => rel.via(fila, o));
  if (rel.lista) {
    if (cond && cond.some !== undefined) {
      return relacionadas.some((o) => coincide(entidadRel, o, cond.some, tablas));
    }
    if (cond && cond.none !== undefined) {
      return !relacionadas.some((o) => coincide(entidadRel, o, cond.none, tablas));
    }
    if (cond && cond.every !== undefined) {
      return relacionadas.every((o) => coincide(entidadRel, o, cond.every, tablas));
    }
    return relacionadas.some((o) => coincide(entidadRel, o, cond, tablas));
  }
  // Relación a-uno: Prisma acepta `{ is: {...} }` y también el objeto pelado.
  const objetivo = cond && cond.is !== undefined ? cond.is : cond;
  if (objetivo === null) return relacionadas.length === 0;
  return relacionadas.some((o) => coincide(entidadRel, o, objetivo, tablas));
}

function coincideCampo(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) return cmp(valor, cond) === 0;
  if (typeof cond !== "object" || Array.isArray(cond)) return igual(valor, cond);

  for (const op of Object.keys(cond)) {
    const esperado = cond[op];
    switch (op) {
      case "equals":
        if (!igual(valor, esperado)) return false;
        break;
      case "not":
        if (esperado === null) {
          if (valor === null || valor === undefined) return false;
        } else if (
          typeof esperado === "object" &&
          !(esperado instanceof Date) &&
          !Array.isArray(esperado)
        ) {
          if (coincideCampo(valor, esperado)) return false;
        } else if (igual(valor, esperado)) return false;
        break;
      case "in":
        if (!Array.isArray(esperado) || !esperado.some((e) => igual(valor, e))) return false;
        break;
      case "notIn":
        if (Array.isArray(esperado) && esperado.some((e) => igual(valor, e))) return false;
        break;
      // Comparaciones con la lógica de TRES valores de SQL: contra NULL el
      // resultado no es «menor», es DESCONOCIDO, y la fila NO entra. Importa de
      // verdad: `overdueInvoiceWhere` filtra `dueDate < inicioDeHoy`, y una
      // factura sin fecha de vencimiento no vence jamás (lo dice el comentario
      // de @/lib/caja). Si el doble la dejara pasar, daría por bueno un total de
      // vencido inflado.
      case "gt":
        if (esNulo(valor) || !(cmp(valor, esperado) > 0)) return false;
        break;
      case "gte":
        if (esNulo(valor) || !(cmp(valor, esperado) >= 0)) return false;
        break;
      case "lt":
        if (esNulo(valor) || !(cmp(valor, esperado) < 0)) return false;
        break;
      case "lte":
        if (esNulo(valor) || !(cmp(valor, esperado) <= 0)) return false;
        break;
      case "contains": {
        const a = String(valor ?? "");
        const b = String(esperado ?? "");
        const insensible = cond.mode === "insensitive";
        if (!(insensible ? a.toLowerCase().indexOf(b.toLowerCase()) !== -1 : a.indexOf(b) !== -1)) {
          return false;
        }
        break;
      }
      case "mode":
        break; // lo consume `contains`
      case "isEmpty": {
        const vacio = ((valor as any[]) ?? []).length === 0;
        if (vacio !== !!esperado) return false;
        break;
      }
      case "has":
        if (((valor as any[]) ?? []).indexOf(esperado) === -1) return false;
        break;
      case "hasSome":
        if (!(esperado as any[]).some((e) => ((valor as any[]) ?? []).indexOf(e) !== -1)) {
          return false;
        }
        break;
      default:
        throw new Error(`el doble de base no conoce el operador "${op}"`);
    }
  }
  return true;
}

function esNulo(v: any): boolean {
  return v === null || v === undefined;
}

function igual(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) return cmp(a, b) === 0;
  if (a === undefined && b === null) return true;
  return a === b;
}

function cmp(a: any, b: any): number {
  const va = a instanceof Date ? a.getTime() : a;
  const vb = b instanceof Date ? b.getTime() : b;
  if (va === vb) return 0;
  if (va === null || va === undefined) return -1;
  if (vb === null || vb === undefined) return 1;
  return va < vb ? -1 : 1;
}

/* ── orden, proyección y agregados ───────────────────────────────────── */

function ordenar(filas: Fila[], orderBy: any): Fila[] {
  if (!orderBy) return filas;
  const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...filas].sort((a, b) => {
    for (const c of criterios) {
      const campo = Object.keys(c)[0];
      const dir = c[campo] === "asc" ? 1 : -1;
      const r = cmp(a[campo], b[campo]);
      if (r !== 0) return r * dir;
    }
    return 0;
  });
}

function ordenarGrupos(grupos: Fila[], orderBy: any): Fila[] {
  if (!orderBy) return grupos;
  const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...grupos].sort((a, b) => {
    for (const c of criterios) {
      const agg = Object.keys(c)[0]; // "_sum" | "_count" | "_max" | un campo
      if (agg.charAt(0) === "_") {
        const campo = Object.keys(c[agg])[0];
        const dir = c[agg][campo] === "asc" ? 1 : -1;
        const r = cmp(a[agg] ? a[agg][campo] : null, b[agg] ? b[agg][campo] : null);
        if (r !== 0) return r * dir;
      } else {
        const dir = c[agg] === "asc" ? 1 : -1;
        const r = cmp(a[agg], b[agg]);
        if (r !== 0) return r * dir;
      }
    }
    return 0;
  });
}

function sumar(filas: Fila[], spec: any): Fila {
  const out: Fila = {};
  for (const campo of Object.keys(spec ?? {})) {
    if (!spec[campo]) continue;
    out[campo] = filas.reduce((s, f) => s + (Number(f[campo]) || 0), 0);
  }
  return out;
}

function maximos(filas: Fila[], spec: any): Fila {
  const out: Fila = {};
  for (const campo of Object.keys(spec ?? {})) {
    if (!spec[campo]) continue;
    let max: any = null;
    for (const f of filas) if (max === null || cmp(f[campo], max) > 0) max = f[campo];
    out[campo] = max;
  }
  return out;
}

/**
 * Proyecta el `select`. Las relaciones anidadas (`{ where, orderBy, take,
 * select }`) se resuelven igual que Prisma; los campos escalares se copian tal
 * cual. Si no hay `select`, se devuelve la fila entera.
 */
function proyectar(
  entidad: string,
  fila: Fila,
  select: any,
  tablas: Record<string, Fila[]>,
): Fila {
  if (!select) return { ...fila };
  const out: Fila = {};
  for (const clave of Object.keys(select)) {
    const spec = select[clave];
    if (!spec) continue;
    const rel = RELACIONES[entidad] ? RELACIONES[entidad][clave] : undefined;
    if (rel) {
      const entidadRel = entidadDeModelo(rel.modelo);
      let hijas = (tablas[rel.modelo] ?? []).filter((o) => rel.via(fila, o));
      if (spec !== true) {
        hijas = hijas.filter((o) => coincide(entidadRel, o, spec.where, tablas));
        hijas = ordenar(hijas, spec.orderBy);
        if (typeof spec.take === "number") hijas = hijas.slice(0, spec.take);
        hijas = hijas.map((o) => proyectar(entidadRel, o, spec.select, tablas));
      } else {
        hijas = hijas.map((o) => ({ ...o }));
      }
      out[clave] = rel.lista ? hijas : hijas.length ? hijas[0] : null;
      continue;
    }
    out[clave] = fila[clave] ?? null;
  }
  return out;
}
