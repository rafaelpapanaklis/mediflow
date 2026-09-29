// CATÁLOGO de la clínica a partir de las prestaciones de Dentalink (ws1-t8). Cada prestación distinta del export
// (nombre, código, categoría, «Precio Original» más frecuente) pasa a `procedure_catalog` si la clínica no la tiene,
// y cada renglón se liga a su procedimiento. Sirve a los renglones normales (handler de tratamientos) y a los de
// ortodoncia (ws1-t12: `asegurarCatalogoDentalink` devuelve también los ids de estos).
//
//  · Ortodoncia (categoría Ortodoncia o nombre de ortodoncia) → category «orthodontics» y «con costo aparte»
//    (orthoIncludedInTreatment = false, SQL crudo tolerante, igual que el resto del módulo).
//  · El CONTROL de ortodoncia (control / ajuste / activación mensual) NO se crea: se liga al ORTO_CONTROL de la
//    clínica, para no duplicar el que factura «Pago por control». Sin ese procedimiento queda sin ligar y se avisa.
//  · El código de Dentalink se guarda con prefijo «DL-»: `procedure_catalog.code` es también la llave interna del
//    odontograma (ODO_*) y del control (ORTO_CONTROL); el prefijo evita cualquier choque.
//  · Idempotente: se busca antes por código y por nombre; lo que ya existe se liga, lo que falta se crea, todo bajo un
//    candado de Postgres por clínica (mismo patrón que la siembra de ortodoncia) para que dos importaciones a la vez
//    no dupliquen. Aislado por clinicId en cada consulta.

import { prisma } from "@/lib/prisma";
import { newId } from "../migrado";
import { aplicarOrthoIncluido, elegirProcedimientoControl } from "@/lib/orthodontics/catalog-procedures";
import { ORTHO_CATALOG_CATEGORY } from "@/lib/orthodontics/catalog-procedures-constantes";
import { prestacionEsOrtodoncia, sinAcentos, campoDeRenglon, type RenglonDentalink } from "./es-ortodoncia";

export interface RenglonCatalogo {
  nombre: string;
  codigo?: string | null;
  categoria?: string | null;
  precioOriginal?: number | null;
}

export interface PrestacionPlaneada {
  clave: string;
  nombre: string;
  /** Con el prefijo «DL-», o null si el export no trae código. */
  codigo: string | null;
  categoria: string;
  precio: number;
  ortodoncia: boolean;
  control: boolean;
}

export const PREFIJO_CODIGO_DENTALINK = "DL-";
const NOMBRE_MAX = 120;
const CATEGORIA_MAX = 60;
const CATEGORIA_POR_DEFECTO = "general";

const limpiar = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Clave de comparación de una prestación: sin acentos, mayúsculas ni espacios de más. */
export function claveDePrestacion(nombre: unknown): string {
  return sinAcentos(nombre);
}

const ES_CONTROL = /\b(control(es)?|ajustes?|activacion(es)?)\b/;

/** ¿Es el control mensual de ortodoncia? (solo entre lo que ya es de ortodoncia). */
export function esControlDeOrtodoncia(nombre: unknown): boolean {
  return ES_CONTROL.test(sinAcentos(nombre));
}

/** Precio más frecuente; a igual frecuencia, el mayor. Sin precios: 0. */
function precioMasFrecuente(precios: number[]): number {
  const cuenta = new Map<number, number>();
  for (const p of precios) cuenta.set(p, (cuenta.get(p) ?? 0) + 1);
  let mejor = 0;
  let n = 0;
  for (const [p, c] of Array.from(cuenta.entries())) {
    if (c > n || (c === n && p > mejor)) { mejor = p; n = c; }
  }
  return mejor;
}

/** Renglones crudos del export (encabezados de Dentalink) → lo que necesita el catálogo. */
export function renglonesDeFilasCrudas(filas: RenglonDentalink[]): RenglonCatalogo[] {
  return filas.map((f) => {
    const precio = campoDeRenglon(f, ["preciooriginal"]);
    const n = precio === "" ? NaN : Number(precio.replace(",", "."));
    return {
      nombre: campoDeRenglon(f, ["nombreprestacion", "procedure", "procedimiento"]),
      codigo: campoDeRenglon(f, ["codigoprestacion", "codigodeprestacion"]) || null,
      categoria: campoDeRenglon(f, ["nombrecategoria", "categoria"]) || null,
      precioOriginal: Number.isFinite(n) ? n : null,
    };
  });
}

/** PURO: las prestaciones DISTINTAS de un conjunto de renglones, con su precio, categoría y tipo. */
export function planearCatalogo(renglones: RenglonCatalogo[]): PrestacionPlaneada[] {
  const porClave = new Map<string, { r: RenglonCatalogo[]; }>();
  for (const r of renglones) {
    const nombre = limpiar(r.nombre, NOMBRE_MAX);
    if (!nombre) continue;
    const clave = claveDePrestacion(nombre);
    const e = porClave.get(clave);
    if (e) e.r.push(r); else porClave.set(clave, { r: [r] });
  }
  const out: PrestacionPlaneada[] = [];
  for (const [clave, { r }] of Array.from(porClave.entries())) {
    const nombre = limpiar(r[0].nombre, NOMBRE_MAX);
    const codigoCrudo = limpiar(r.find((x) => limpiar(x.codigo, 40))?.codigo, 40);
    const categoriaCruda = limpiar(r.find((x) => limpiar(x.categoria, CATEGORIA_MAX))?.categoria, CATEGORIA_MAX);
    const ortodoncia = sinAcentos(categoriaCruda) === "ortodoncia" || prestacionEsOrtodoncia(nombre);
    const precios = r.map((x) => x.precioOriginal).filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p >= 0);
    out.push({
      clave,
      nombre,
      codigo: codigoCrudo ? `${PREFIJO_CODIGO_DENTALINK}${codigoCrudo}` : null,
      categoria: ortodoncia ? ORTHO_CATALOG_CATEGORY : categoriaCruda || CATEGORIA_POR_DEFECTO,
      precio: precioMasFrecuente(precios),
      ortodoncia,
      control: ortodoncia && esControlDeOrtodoncia(nombre),
    });
  }
  return out;
}

export interface ResultadoCatalogo {
  /** clave (claveDePrestacion) → id del procedimiento del catálogo de la clínica. */
  ids: Map<string, string>;
  creadas: number;
  existentes: number;
  /** Prestaciones de control que no se pudieron ligar porque la clínica no tiene su ORTO_CONTROL. */
  controlSinCatalogo: string[];
}

interface FilaCatalogo { id: string; name: string; code: string | null; category: string; basePrice: number; isActive: boolean }
export interface TxCatalogo {
  $executeRaw(consulta: TemplateStringsArray, ...valores: unknown[]): Promise<unknown>;
  procedureCatalog: {
    findMany(args: any): Promise<FilaCatalogo[]>;
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
}
export interface DbCatalogo {
  $transaction<T>(fn: (tx: TxCatalogo) => Promise<T>): Promise<T>;
}

export const llaveDeCatalogoDentalink = (clinicId: string) => `dentalink:catalogo:${clinicId}`;

/**
 * Asegura en el catálogo de la clínica las prestaciones planeadas y devuelve el id de cada una. Idempotente.
 * `marcarFlag` pone «con costo aparte» a lo de ortodoncia recién creado (tolerante: sin la columna, no hace nada).
 */
export async function asegurarCatalogoDentalink(
  clinicId: string,
  plan: PrestacionPlaneada[],
  db: DbCatalogo = prisma as unknown as DbCatalogo,
  marcarFlag: (id: string, clinicId: string, valor: boolean | null) => Promise<void> = aplicarOrthoIncluido,
): Promise<ResultadoCatalogo> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("asegurarCatalogoDentalink: falta clinicId");
  const vacio: ResultadoCatalogo = { ids: new Map(), creadas: 0, existentes: 0, controlSinCatalogo: [] };
  if (plan.length === 0) return vacio;

  const { res, nuevasOrto } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${llaveDeCatalogoDentalink(clinicId)}))`;
    const filas = await tx.procedureCatalog.findMany({
      where: { clinicId },
      select: { id: true, name: true, code: true, category: true, basePrice: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    const porCodigo = new Map<string, FilaCatalogo>();
    const porNombre = new Map<string, FilaCatalogo>();
    for (const f of filas) {
      if (f.code && !porCodigo.has(f.code)) porCodigo.set(f.code, f);
      const k = claveDePrestacion(f.name);
      if (!porNombre.has(k)) porNombre.set(k, f);
    }
    const control = elegirProcedimientoControl(filas)?.fila ?? null;

    const r: ResultadoCatalogo = { ids: new Map(), creadas: 0, existentes: 0, controlSinCatalogo: [] };
    const crear: Array<Record<string, unknown>> = [];
    const orto: string[] = [];
    for (const p of plan) {
      if (p.control) {
        if (control) { r.ids.set(p.clave, control.id); r.existentes++; } else r.controlSinCatalogo.push(p.nombre);
        continue;
      }
      const hit = (p.codigo && porCodigo.get(p.codigo)) || porNombre.get(p.clave);
      if (hit) { r.ids.set(p.clave, hit.id); r.existentes++; continue; }
      const id = newId();
      r.ids.set(p.clave, id);
      crear.push({ id, clinicId, name: p.nombre, code: p.codigo, category: p.categoria, basePrice: p.precio, description: "Creado al importar desde Dentalink." });
      if (p.ortodoncia) orto.push(id);
    }
    if (crear.length > 0) {
      await tx.procedureCatalog.createMany({ data: crear });
      r.creadas = crear.length;
    }
    return { res: r, nuevasOrto: orto };
  });

  // Fuera de la transacción: un fallo aquí no debe deshacer el catálogo creado.
  for (const id of nuevasOrto) {
    try { await marcarFlag(id, clinicId, false); } catch (e) { console.warn("[importador:catalogo] no se pudo marcar «con costo aparte»:", e); }
  }
  return res;
}
