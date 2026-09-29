// La importación en «Movimientos» de cada paciente (ws1-t10, 29-sep-2026).
//
// Después de que un archivo se importa, cada paciente afectado recibe UN movimiento resumido:
//   «Importado desde Dentalink (05_Citas.csv): 3 citas futuras»
//   «Importado desde Dentalink (06_Presupuestos.xlsx): 2 tratamientos (1 caso de ortodoncia, 6 controles), pagado migrado $4,800»
// Es el único enganche: lo llama `runImport` (engine.ts) con las filas que ya juntó el motor, así que NO vive dentro de
// ningún handler y sirve igual a los que se agreguen después.
//
// · Una inserción por archivo (registrarMovimientosEnBloque), nunca una por fila.
// · Nunca frena ni revienta la importación: cualquier fallo se anota y se sigue.
// · Reimportar sin cambios no repite nada: solo cuentan las filas que de verdad entraron (las «ya importadas» quedan
//   `skipped`/`duplicate`), y además cada movimiento lleva un identificador que sale del archivo, la entidad, el paciente y
//   el texto: si ya existe, no se escribe otra vez.
// · Multi-tenant: clinicId y userId de la sesión.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { registrarMovimientosEnBloque, type MovimientoEnBloque } from "@/lib/movimientos-paciente/bloque";
import type { CategoriaMovimiento } from "@/lib/movimientos-paciente/catalogo";
import type { PreviewRow } from "./types";
import { tipoDeRenglon } from "./dentalink/ortodoncia-caso";

/** entityType de estas filas de la bitácora. */
export const ENTIDAD_IMPORTACION = "import";

export interface ResumenDeImportacion {
  patientId: string;
  texto: string;
  categoria: CategoriaMovimiento;
}

export interface OpcionesDeResumen {
  entity: string;
  /** «Dentalink», «Excel»… (o «otro sistema»). */
  origen: string;
  fileName: string;
  skipDuplicates: boolean;
}

const uno = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

function dinero(n: number): string {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return `$${r.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Filas que de verdad entraron con esta importación. */
function entradas(preview: PreviewRow[], skipDuplicates: boolean): PreviewRow[] {
  return preview.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));
}

function porPaciente(filas: PreviewRow[], quien: (r: PreviewRow) => string | undefined): Map<string, PreviewRow[]> {
  const m = new Map<string, PreviewRow[]>();
  for (const r of filas) {
    const id = quien(r);
    if (!id) continue;
    (m.get(id) ?? m.set(id, []).get(id)!).push(r);
  }
  return m;
}

function grupos(filas: PreviewRow[]): PreviewRow[][] {
  const m = new Map<string, PreviewRow[]>();
  for (const r of filas) {
    const k = String(r.data.groupKey ?? `fila:${r.row}`);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return Array.from(m.values());
}

/** Lo pagado de UN tratamiento: «Total Pagos Tratamiento» (igual en todos sus renglones) o, si no viene, la suma por renglón. */
function pagadoDelGrupo(g: PreviewRow[]): number {
  const total = g.find((r) => typeof r.data.abonado === "number")?.data.abonado;
  if (typeof total === "number") return total;
  return g.reduce((a, r) => a + num(r.data.abonadoLinea), 0);
}

type Frase = { texto: string; dinero?: boolean };

/** La frase de UN paciente para UN archivo, según qué entidad es. `null` = esta entidad no deja rastro por paciente. */
function frase(entity: string, filas: PreviewRow[]): Frase | null {
  switch (entity) {
    case "patients":
      return { texto: "ficha del paciente" };
    case "appointments":
      return { texto: uno(filas.length, "cita futura", "citas futuras") };
    case "appointmentHistory": {
      const controles = filas.filter((r) => r.data.comoControl).length;
      const base = uno(filas.length, "cita del historial", "citas del historial");
      return { texto: controles > 0 ? `${base} (${uno(controles, "como control de ortodoncia", "como controles de ortodoncia")})` : base };
    }
    case "balances": {
      const partes: string[] = [];
      const mora = filas.filter((r) => r.data.kind !== "credit" && !r.data.ligadoA);
      const ligadas = filas.filter((r) => r.data.ligadoA);
      const favor = filas.filter((r) => r.data.kind === "credit");
      if (mora.length) partes.push(`saldo de mora ${dinero(mora.reduce((a, r) => a + num(r.data.amount), 0))}`);
      if (ligadas.length) partes.push(`mora de ${dinero(ligadas.reduce((a, r) => a + num(r.data.amount), 0))} anotada en su tratamiento`);
      if (favor.length) partes.push(`saldo a favor ${dinero(favor.reduce((a, r) => a + num(r.data.amount), 0))}`);
      return partes.length ? { texto: partes.join(", "), dinero: true } : null;
    }
    case "treatmentPlans": {
      const gs = grupos(filas);
      const casos = gs.filter((g) => g.some((r) => r.data.ortoCaso === true));
      const controles = casos.reduce(
        (a, g) =>
          a +
          g.filter(
            (r) =>
              r.data.hecho === true &&
              r.data.fechaRealizado instanceof Date &&
              tipoDeRenglon(String(r.data.procedure ?? ""), String(r.data.categoria ?? "")) === "control",
          ).length,
        0,
      );
      const pagado = gs.reduce((a, g) => a + pagadoDelGrupo(g), 0);
      const detalle: string[] = [];
      if (casos.length) detalle.push(uno(casos.length, "caso de ortodoncia", "casos de ortodoncia"));
      if (controles) detalle.push(uno(controles, "control", "controles"));
      const texto =
        uno(gs.length, "tratamiento", "tratamientos") +
        (detalle.length ? ` (${detalle.join(", ")})` : "") +
        (pagado > 0 ? `, pagado migrado ${dinero(pagado)}` : "");
      return { texto, dinero: pagado > 0 };
    }
    case "quotes":
      return { texto: uno(grupos(filas).length, "presupuesto (historia)", "presupuestos (historia)") };
    case "clinicalNotes":
    case "treatmentNotes":
      return { texto: uno(filas.length, "nota de evolución", "notas de evolución") };
    case "medicalHistory":
      return { texto: "historia médica" };
    case "odontogram":
      return { texto: uno(filas.length, "hallazgo del odontograma", "hallazgos del odontograma") };
    case "paymentHistory": {
      const total = filas.reduce((a, r) => a + num(r.data.amount), 0);
      return { texto: `${uno(filas.length, "pago histórico", "pagos históricos")}${total > 0 ? ` por ${dinero(total)}` : ""}`, dinero: true };
    }
    case "labExpenseHistory":
      return { texto: uno(filas.length, "gasto de laboratorio", "gastos de laboratorio") };
    case "installmentPlans": {
      const total = filas.reduce((a, r) => a + num(r.data.amount), 0);
      return { texto: `${uno(filas.length, "cuota por vencer", "cuotas por vencer")}${total > 0 ? ` por ${dinero(total)}` : ""}`, dinero: true };
    }
    case "orthoCases":
      return { texto: uno(filas.length, "caso de ortodoncia anterior", "casos de ortodoncia anteriores") };
    default:
      // Doctores, bloqueos de agenda, catálogo de procedimientos: no son de un paciente.
      return null;
  }
}

/** PURA: un movimiento por paciente con lo que esta importación dejó en él. */
export function resumirImportacion(preview: PreviewRow[], o: OpcionesDeResumen): ResumenDeImportacion[] {
  const dentro = entradas(preview, o.skipDuplicates);
  if (dentro.length === 0) return [];
  // En pacientes, el paciente ES la fila que se creó.
  const quien = o.entity === "patients"
    ? (r: PreviewRow) => (typeof r.data.newId === "string" ? r.data.newId : undefined)
    : (r: PreviewRow) => (typeof r.data.patientId === "string" ? r.data.patientId : undefined);
  const out: ResumenDeImportacion[] = [];
  for (const [patientId, filas] of Array.from(porPaciente(dentro, quien).entries())) {
    const f = frase(o.entity, filas);
    if (!f) continue;
    const archivo = o.fileName.trim() ? ` (${o.fileName.trim().slice(0, 80)})` : "";
    out.push({
      patientId,
      texto: `Importado desde ${o.origen}${archivo}: ${f.texto}`,
      // «Archivos» (categoría de las importaciones); si el texto trae dinero, «dinero» para que quien no ve la facturación no lo lea.
      categoria: f.dinero ? "dinero" : "archivos",
    });
  }
  return out;
}

/** El identificador estable de un movimiento de importación: mismo archivo, entidad, paciente y texto → mismo id. */
export function idDeMovimientoDeImportacion(o: { origen: string; fileName: string; entity: string }, r: ResumenDeImportacion): string {
  const h = createHash("sha256").update([o.origen, o.fileName, o.entity, r.patientId, r.texto].join("|")).digest("hex");
  return `imp-${h.slice(0, 32)}`;
}

/**
 * Escribe los movimientos de una importación ya confirmada. NUNCA tira. Devuelve cuántos escribió.
 * `preview` son las filas tal como quedaron tras `commit` (las que fallaron ya están en `error`).
 */
export async function registrarImportacionEnMovimientos(args: {
  clinicId: string;
  userId: string;
  entity: string;
  origen: string;
  fileName: string;
  skipDuplicates: boolean;
  preview: PreviewRow[];
}): Promise<number> {
  try {
    if (!args.clinicId || !args.userId) return 0;
    const o = { entity: args.entity, origen: args.origen, fileName: args.fileName, skipDuplicates: args.skipDuplicates };
    const resumenes = resumirImportacion(args.preview, o);
    if (resumenes.length === 0) return 0;
    const ids = resumenes.map((r) => idDeMovimientoDeImportacion(o, r));

    // Ya escritos por una importación anterior del mismo archivo: no se repiten.
    const ya = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const f = await prisma.auditLog.findMany({
        where: { clinicId: args.clinicId, entityType: ENTIDAD_IMPORTACION, entityId: { in: ids.slice(i, i + 500) } },
        select: { entityId: true },
      });
      for (const x of f) ya.add(x.entityId);
    }
    const movimientos: MovimientoEnBloque[] = [];
    resumenes.forEach((r, i) => {
      if (ya.has(ids[i])) return;
      movimientos.push({ patientId: r.patientId, entityType: ENTIDAD_IMPORTACION, entityId: ids[i], action: "create", texto: r.texto, categoria: r.categoria });
    });
    return await registrarMovimientosEnBloque({ clinicId: args.clinicId, userId: args.userId, movimientos });
  } catch (e) {
    console.error("registrarImportacionEnMovimientos error:", e);
    return 0;
  }
}
