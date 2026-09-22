// Doble de Prisma EN MEMORIA para conducir el motor de importación de verdad
// (runImport + handlers) sin base. No es un stub que devuelve lo que se le pide:
// guarda filas, aplica los `where` de verdad y hace cumplir tres cosas que la
// base real hace cumplir, porque son justo las que una importación puede romper:
//
//  · Un `where` con una clave `undefined` REVIENTA. Prisma la ignoraría y
//    devolvería las filas de todas las clínicas (regla (c) del repo): aquí es un
//    error ruidoso, no un falso verde.
//  · Unicidad de (clinicId, folio) en quotes → P2002, y la FK quote_items →
//    quotes → P2003. Lo que prueba que la renumeración y la transacción sirven.
//  · `$transaction([...])` es atómica: si una operación falla, se deshacen las
//    anteriores (las operaciones son perezosas, como las de Prisma).
//
// Cuenta las llamadas por modelo/método: con eso se demuestra que una
// importación NO hace una consulta por fila.

type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

export interface Base {
  prisma: any;
  tablas: Record<string, Row[]>;
  llamadas: Record<string, number>;
  /**
   * Ganchos que corren JUSTO ANTES de una operación ("quote.createMany",
   * "$queryRaw.patientsUpdate"…): así se simula que otra pestaña se adelantó.
   */
  ganchos: Record<string, () => void>;
}

class PrismaError extends Error {
  code: string;
  meta?: Record<string, unknown>;
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.meta = meta;
  }
}

function comparable(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}

export function cumple(row: Row, where: Where): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) {
      throw new Error(`where.${k} es undefined: Prisma lo ignoraría y leería de TODAS las clínicas`);
    }
    if (k === "AND") {
      if (!(cond as Where[]).every((w) => cumple(row, w))) return false;
      continue;
    }
    if (k === "OR") {
      if (!(cond as Where[]).some((w) => cumple(row, w))) return false;
      continue;
    }
    const v = row[k];
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
      continue;
    }
    if (cond instanceof Date) {
      if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (typeof cond === "object" && !Array.isArray(cond)) {
      for (const [op, arg] of Object.entries(cond)) {
        if (arg === undefined) throw new Error(`where.${k}.${op} es undefined`);
        switch (op) {
          case "in":
            if (!(arg as any[]).some((a) => comparable(a) === comparable(v))) return false;
            break;
          case "gte":
            if (!(comparable(v) >= comparable(arg))) return false;
            break;
          case "lte":
            if (!(comparable(v) <= comparable(arg))) return false;
            break;
          case "gt":
            if (!(comparable(v) > comparable(arg))) return false;
            break;
          case "lt":
            if (!(comparable(v) < comparable(arg))) return false;
            break;
          case "not":
            if (comparable(v) === comparable(arg)) return false;
            break;
          default:
            throw new Error(`operador sin doble: ${op}`);
        }
      }
      continue;
    }
    if (comparable(v) !== comparable(cond)) return false;
  }
  return true;
}

/** Una operación perezosa: no corre hasta que alguien la espera (como un PrismaPromise). */
function perezosa<T>(fn: () => T): PromiseLike<T> & { correr: () => Promise<T> } {
  let p: Promise<T> | null = null;
  const correr = () => (p ??= Promise.resolve().then(fn));
  return {
    correr,
    then: (ok, ko) => correr().then(ok, ko),
  };
}

function ordenar(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const reglas = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [campo, dir] of reglas) {
      const x = comparable(a[campo]);
      const y = comparable(b[campo]);
      if (x === y) continue;
      const r = x < y ? -1 : 1;
      return dir === "desc" ? -r : r;
    }
    return 0;
  });
}

let secuencia = 0;

export function crearBase(semilla: Record<string, Row[]>): Base {
  const tablas: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(semilla)) tablas[k] = v.map((r) => ({ ...r }));
  const llamadas: Record<string, number> = {};
  const ganchos: Record<string, () => void> = {};
  const contar = (k: string) => {
    llamadas[k] = (llamadas[k] ?? 0) + 1;
    ganchos[k]?.();
  };
  const tabla = (m: string) => (tablas[m] ??= []);

  function validarInsercion(modelo: string, fila: Row, lote: Row[]) {
    if (modelo === "quote") {
      const choca = (r: Row) => r.clinicId === fila.clinicId && r.folio === fila.folio;
      if (tabla("quote").some(choca) || lote.some(choca)) {
        throw new PrismaError("P2002", "Unique constraint failed", { target: ["clinicId", "folio"] });
      }
    }
    if (modelo === "quoteItem") {
      if (!tabla("quote").some((q) => q.id === fila.quoteId)) {
        throw new PrismaError("P2003", "Foreign key constraint failed on quoteId");
      }
    }
    if (fila.id && tabla(modelo).some((r) => r.id === fila.id)) {
      throw new PrismaError("P2002", "Unique constraint failed", { target: ["id"] });
    }
  }

  function modelo(nombre: string) {
    return {
      findMany: (args: Row = {}) =>
        perezosa(() => {
          contar(`${nombre}.findMany`);
          const out = ordenar(tabla(nombre).filter((r) => cumple(r, args.where)), args.orderBy);
          return (args.take ? out.slice(0, args.take) : out).map((r) => ({ ...r }));
        }),
      findFirst: (args: Row = {}) =>
        perezosa(() => {
          contar(`${nombre}.findFirst`);
          const hit = ordenar(tabla(nombre).filter((r) => cumple(r, args.where)), args.orderBy)[0];
          return hit ? { ...hit } : null;
        }),
      findUnique: (args: Row = {}) =>
        perezosa(() => {
          contar(`${nombre}.findUnique`);
          const hit = tabla(nombre).find((r) => cumple(r, args.where));
          return hit ? { ...hit } : null;
        }),
      count: (args: Row = {}) =>
        perezosa(() => {
          contar(`${nombre}.count`);
          return tabla(nombre).filter((r) => cumple(r, args.where)).length;
        }),
      create: (args: Row) =>
        perezosa(() => {
          contar(`${nombre}.create`);
          const fila = { id: `${nombre}_${++secuencia}`, createdAt: new Date(), updatedAt: new Date(), ...args.data };
          validarInsercion(nombre, fila, []);
          tabla(nombre).push(fila);
          return { ...fila };
        }),
      createMany: (args: Row) =>
        perezosa(() => {
          contar(`${nombre}.createMany`);
          const lote: Row[] = [];
          for (const d of args.data as Row[]) {
            const fila = { id: `${nombre}_${++secuencia}`, createdAt: new Date(), updatedAt: new Date(), ...d };
            validarInsercion(nombre, fila, lote);
            lote.push(fila);
          }
          tabla(nombre).push(...lote);
          return { count: lote.length };
        }),
      updateMany: (args: Row) =>
        perezosa(() => {
          contar(`${nombre}.updateMany`);
          let count = 0;
          for (const r of tabla(nombre)) {
            if (!cumple(r, args.where)) continue;
            Object.assign(r, args.data, { updatedAt: new Date() });
            count++;
          }
          return { count };
        }),
    };
  }

  const prisma: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return undefined; // `await prisma` no es una operación
        if (prop === "$transaction") {
          return async (ops: Array<{ correr: () => Promise<unknown> }>) => {
            contar("$transaction");
            const foto = structuredClone(tablas);
            try {
              const out = [];
              for (const op of ops) out.push(await op.correr());
              return out;
            } catch (e) {
              for (const k of Object.keys(tablas)) delete tablas[k];
              Object.assign(tablas, foto);
              throw e;
            }
          };
        }
        if (prop === "$queryRaw") {
          return (strings: TemplateStringsArray, ...values: any[]) =>
            perezosa(() => {
              const sql = strings.join("?");
              if (/UPDATE "patients"/.test(sql)) {
                contar("$queryRaw.patientsUpdate");
                const [nowIso, json, clinicId] = values;
                const hechos: Row[] = [];
                for (const d of JSON.parse(json) as Row[]) {
                  const p = tabla("patient").find(
                    (r) => r.id === d.id && r.clinicId === clinicId && r.updatedAt.toISOString() === d.updatedAt,
                  );
                  if (!p) continue;
                  p.allergies = d.allergies;
                  p.chronicConditions = d.chronicConditions;
                  p.currentMedications = d.currentMedications;
                  p.familyHistory = d.familyHistory ?? null;
                  p.personalNonPathologicalHistory = d.personalNonPathologicalHistory ?? null;
                  p.updatedAt = new Date(nowIso);
                  hechos.push({ id: p.id });
                }
                return hechos;
              }
              if (/FROM "quotes"/.test(sql)) {
                contar("$queryRaw.lastQuoteFolio");
                const [clinicId] = values;
                let max: number | null = null;
                for (const q of tabla("quote")) {
                  if (q.clinicId !== clinicId) continue;
                  const m = String(q.folio).match(/([0-9]+)[^0-9]*$/);
                  if (m && (max === null || Number(m[1]) > max)) max = Number(m[1]);
                }
                return [{ max }];
              }
              throw new Error(`$queryRaw sin doble: ${sql.slice(0, 80)}`);
            });
        }
        if (typeof prop === "string" && !prop.startsWith("$")) return modelo(prop);
        return undefined;
      },
    },
  );

  return { prisma, tablas, llamadas, ganchos };
}
