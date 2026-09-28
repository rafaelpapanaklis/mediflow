// ARANCELES Y PRECIOS MIGRADOS (ws1-t6, sep-2026): Dentalink "12_Aranceles_
// Precios" y equivalentes. Es el catálogo de PROCEDIMIENTOS de la clínica
// (nombre, código, categoría, precio) — sin paciente, sin fecha: una fila es
// un procedimiento del tarifario, no un movimiento de dinero de alguien.
//
// Escribe DIRECTO en `procedure_catalog` (prisma.procedureCatalog): es el
// mismo catálogo que ya usan facturas, presupuestos y el odontograma — no se
// crea una tabla "migrada" aparte, porque aquí SÍ es el dato real y vivo que
// la clínica va a usar (a diferencia de un pago o una cuota, que son
// historia). Regla dura del repo (d): los precios NUNCA se hardcodean en la
// UI — esto solo alimenta la tabla que ya lee `src/lib/plan-shared.ts`-style
// (aquí, `procedure_catalog`, la fuente real de precios por procedimiento).
//
// CONFLICTO DE PRECIO: si el archivo trae un procedimiento que YA existe (por
// nombre o código) con un precio DISTINTO, la fila entra como "duplicate" con
// el conflicto explicado en la vista previa. El precio SOLO se actualiza si
// el usuario apaga «Omitir duplicados» en el paso 6 del asistente — esa
// casilla, que ya existe y que el usuario ya entiende, ES la confirmación
// explícita que pide la tarea. Sin apagarla, nada cambia (se deja como está).
//
// FUENTES DEL MAPEO (28-sep-2026) — ni la API pública de Dentalink
// (https://api.dentalink.healthatom.com/docs/) ni la ayuda de Reportes Excel
// (https://ayuda.softwaredentalink.com/es/articles/9493465-reportes-excel,
// que solo documenta "Citas pacientes", "Pacientes morosos" y "Pagos
// pacientes") listan un reporte de aranceles/precios. Los encabezados de
// abajo son una extrapolación del vocabulario chileno de esos otros reportes
// («Prestación», «Valor») — nunca se verificaron contra un export real: el
// perfil sigue `verified:false` y, si no casan, el paso de mapeo pide
// emparejar a mano.
//
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa). Sin
// paciente que resolver, este handler NO depende de ../pagos-historial/paciente.

import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/invoice-totals";
import {
  AMOUNT_FORMAT_FIELD,
  AMOUNT_FORMAT_KEY,
  type Entity,
  type PreviewRow,
} from "../types";
import {
  BATCH,
  norm,
  type EntityHandler,
  type MappedRow,
  type ImportContext,
} from "../engine";
import { crearLectorMontos } from "../valores";
import { oneLine, cellText } from "../migrado";

/** Categoría por omisión cuando el archivo no trae una: mismo default que el sembrado de /api/procedures. */
const DEFAULT_CATEGORY = "dental";

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

function rowDbErrorMessage(_e: any): string {
  return "No se pudo guardar la fila (error de base de datos)";
}

// "procedureCatalog" aún puede no estar en el union `Entity` de ../types.ts
// si ws1-t12 no ha llegado a registrar ESTE tipo todavía (el motor lo está
// tocando en paralelo ahora mismo). El cast evita bloquear el typecheck de
// este archivo mientras tanto — t12 lo puede quitar en cuanto lo registre
// (mismo patrón que installmentPlans en ../cuotas-plan/handler.ts).
const PROCEDURE_CATALOG_ENTITY = "procedureCatalog" as Entity;

export const procedureCatalogHandler: EntityHandler = {
  entity: PROCEDURE_CATALOG_ENTITY,
  auditEntityType: "procedure",
  sheetNames: ["aranceles", "arancel", "precios", "tarifario", "catalogo", "catalogoprocedimientos"],
  headerVariants: {
    externalId: ["idprocedimiento", "idprestacion", "idarancel", "codigointerno"],
    code: ["codigo", "codigoarancel", "codigoprestacion", "arancel", "codigofonasa"],
    name: ["nombre", "prestacion", "prestaciones", "procedimiento", "nombreprestacion", "descripcion", "nombredelprocedimiento"],
    category: ["categoria", "grupo", "especialidad", "tipo", "rubro"],
    price: ["precio", "valor", "valorprestacion", "preciolista", "tarifa", "montoarancel", "preciounitario"],
    description: ["detalle", "observaciones", "notas"],
  },

  validateMapping(campos) {
    if (!campos.has("name")) return "Falta la columna del nombre del procedimiento";
    if (!campos.has("price")) return "Falta la columna del precio";
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const catalogo = await prisma.procedureCatalog.findMany({
      where: { clinicId },
      select: { id: true, name: true, code: true, category: true, basePrice: true },
    });
    const byName = new Map(catalogo.map((c) => [norm(c.name), c] as const));
    const byCode = new Map(catalogo.filter((c) => c.code).map((c) => [norm(c.code as string), c] as const));

    const lector = crearLectorMontos(
      rows.map((r) => r.mapped.price),
      ctx.valueMapping[AMOUNT_FORMAT_FIELD]?.[AMOUNT_FORMAT_KEY],
    );

    // Dos filas del MISMO archivo con el mismo nombre normalizado: la primera
    // manda, la(s) siguiente(s) son duplicado DENTRO del archivo.
    const vecesEnArchivo = new Map<string, number>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const name = oneLine(mapped.name, 200);
      if (!name) pr.errors.push("Falta el nombre del procedimiento");

      const lectura = lector.leer(mapped.price);
      if (lectura.vacio) pr.errors.push(`Precio inválido "${mapped.price ?? ""}"`);
      else if (lectura.error) pr.errors.push(lectura.error);
      else if ((lectura.valor ?? -1) < 0) pr.errors.push("El precio no puede ser negativo");
      else if (lectura.pendiente) {
        pr.errors.push(`Monto ambiguo «${lectura.pendiente}»: puede ser de miles o con decimales. Confirma cómo se leen en la vista previa`);
        pr.unresolved = [{ field: AMOUNT_FORMAT_FIELD, key: AMOUNT_FORMAT_KEY, value: lectura.pendiente }];
      }
      if (lectura.aviso) pr.warnings.push(lectura.aviso);
      const price = lectura.valor !== null ? round2(Math.abs(lectura.valor)) : null;

      if (pr.errors.length > 0) { pr.status = "error"; pr.data = { name: name || undefined }; out.push(pr); continue; }

      const code = mapped.code ? oneLine(mapped.code, 40) : "";
      let category = mapped.category ? oneLine(mapped.category, 60) : "";
      if (!category) {
        category = DEFAULT_CATEGORY;
        pr.warnings.push(`Sin categoría en el archivo: se usa "${DEFAULT_CATEGORY}"`);
      }
      const description = mapped.description ? oneLine(mapped.description, 300) : null;

      // Repetido en el MISMO archivo: la primera fila con ese nombre manda.
      const key = norm(name);
      const n = (vecesEnArchivo.get(key) ?? 0) + 1;
      vecesEnArchivo.set(key, n);
      if (n > 1) {
        pr.status = "duplicate";
        pr.warnings.push(`"${name}" aparece más de una vez en el archivo: se usa la primera fila`);
        out.push(pr);
        continue;
      }

      // Coincide con el catálogo YA existente: por código (si el archivo lo
      // trae y hay un procedimiento con ese código) o, si no, por nombre.
      const existente = (code && byCode.get(norm(code))) || byName.get(key);

      if (!existente) {
        pr.data = { action: "create", name, code: code || null, category, price, description };
        out.push(pr);
        continue;
      }

      const mismoPrecio = round2(existente.basePrice) === price;
      const mismaCategoria = norm(existente.category) === norm(category);
      const mismoCodigo = norm(existente.code ?? "") === norm(code ?? "");
      if (mismoPrecio && mismaCategoria && mismoCodigo) {
        pr.status = "duplicate";
        pr.warnings.push(`"${name}" ya existe en tu catálogo, sin cambios`);
        pr.data = { action: "none", name, procedureId: existente.id };
        out.push(pr);
        continue;
      }

      pr.status = "duplicate";
      pr.warnings.push(
        `"${name}" ya existe con precio ${existente.basePrice.toFixed(2)}` +
        (existente.category !== category ? `, categoría "${existente.category}"` : "") +
        `. El archivo trae ${price!.toFixed(2)}${category !== existente.category ? ` en "${category}"` : ""}` +
        `. Con «Omitir duplicados» apagado se actualiza`,
      );
      pr.data = { action: "update", name, code: code || null, category, price, description, procedureId: existente.id };
      out.push(pr);
    }
    return out;
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, _ctx: ImportContext) {
    const candidatas = pickInsertable(rows, skipDuplicates);
    const crear = candidatas.filter((r) => r.data.action === "create");
    // Un "duplicate" con acción "update" SOLO se aplica cuando pickInsertable ya
    // lo dejó pasar (es decir, con «Omitir duplicados» apagado). Los "none"
    // (idénticos) y los duplicados dentro del archivo nunca hacen nada.
    const actualizar = candidatas.filter((r) => r.data.action === "update");

    let created = 0;
    for (let i = 0; i < crear.length; i += BATCH) {
      const slice = crear.slice(i, i + BATCH);
      try {
        created += (await prisma.procedureCatalog.createMany({
          data: slice.map((r) => ({
            clinicId,
            name: r.data.name as string,
            code: (r.data.code as string | null) ?? null,
            category: r.data.category as string,
            basePrice: r.data.price as number,
            description: (r.data.description as string | null) ?? null,
          })),
        })).count;
      } catch {
        for (const r of slice) {
          try {
            await prisma.procedureCatalog.create({
              data: {
                clinicId,
                name: r.data.name as string,
                code: (r.data.code as string | null) ?? null,
                category: r.data.category as string,
                basePrice: r.data.price as number,
                description: (r.data.description as string | null) ?? null,
              },
            });
            created++;
          } catch (e2: any) {
            r.status = "error";
            r.errors.push(rowDbErrorMessage(e2));
          }
        }
      }
    }

    // Menos de 7 consultas por Promise.all (regla del repo): en tandas de 5.
    let actualizados = 0;
    for (let i = 0; i < actualizar.length; i += 5) {
      const slice = actualizar.slice(i, i + 5);
      const resultados = await Promise.allSettled(
        slice.map((r) =>
          prisma.procedureCatalog.updateMany({
            where: { id: r.data.procedureId as string, clinicId },
            data: {
              basePrice: r.data.price as number,
              category: r.data.category as string,
              ...(r.data.code ? { code: r.data.code as string } : {}),
            },
          }),
        ),
      );
      resultados.forEach((res, j) => {
        if (res.status === "fulfilled" && res.value.count > 0) actualizados++;
        else if (res.status === "rejected") {
          slice[j].status = "error";
          slice[j].errors.push(rowDbErrorMessage(res.reason));
        }
      });
    }

    const erroredNow = candidatas.filter((r) => r.status === "error").length;
    return { created: created + actualizados, skipped: Math.max(0, candidatas.length - created - actualizados - erroredNow) };
  },
};
