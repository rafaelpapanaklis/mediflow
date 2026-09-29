// HISTORIAL DE GASTOS DE LABORATORIO MIGRADO (ws1-t2, sep-2026): Dentalink
// "Laboratorio → Acciones/Costos" (archivo 14_Laboratorio_Acciones_Costos) y
// equivalentes de Excel/otros sistemas. Cada fila es una acción de laboratorio
// que YA se pagó en el sistema anterior — pura historia:
//   · El panel NO tiene un módulo de costos de laboratorio: LabOrder/
//     LabPartner (prisma/schema.prisma) son el flujo CLÍNICO de órdenes
//     (spec/status/pdf por módulo), SIN campo de costo — no es el lugar para
//     este dato financiero. Ver la nota del modelo en schema.prisma.
//   · NUNCA toca `invoices`/`payments`/`patientCredit`: el saldo del paciente
//     no cambia. Caja, cortes de caja, CFDI y WhatsApp la ignoran SIN código
//     nuevo — ninguno lee `migrated_lab_expenses`.
//   · Se ve, de solo lectura, en la ficha del paciente ("Gastos de
//     laboratorio (migrados)" — ver leer.ts + la tarjeta de la ficha).
//
// Nombres de columna probables de Dentalink (NO tenemos el archivo real
// todavía — verified:false en cada header hasta que Rafael confirme con un
// archivo de BEVADENT): según la ayuda pública de Dentalink, una prestación
// de laboratorio se da de alta con "Nombre" (la acción), "Precio para el
// paciente" y "Costo para la clínica"
// (https://ayuda.softwaredentalink.com/es/articles/9493458-gestion-de-laboratorios),
// y los reportes de laboratorio incluyen "precio de las acciones de
// laboratorio vs costo de laboratorio". Los headerVariants de abajo cubren
// esas variantes probables; lo que no case, la vista previa lo deja para
// emparejar a mano (nunca se adivina en silencio).
//
// Construido en un archivo NUEVO (no en entities.ts) porque varias pantallas
// de esta ola tocan el motor/detección/UI del asistente en paralelo. Este
// handler es EntityHandler-compatible (mismo shape que engine.ts espera) y se
// invoca directo con `runImport(labExpenseHandler, opts)` desde su propia
// ruta (src/app/api/import/lab-expenses/route.ts). El registro final
// (types.ts, entities.ts, detección, UI del asistente) lo hace ws1-t12,
// dueño del motor — ver REPORTE-ws1-t2.md para lo que necesita registrar.
//
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa).

import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/invoice-totals";
import {
  AMOUNT_FORMAT_FIELD,
  AMOUNT_FORMAT_KEY,
  type PreviewRow,
} from "../types";
import {
  BATCH,
  ImportError,
  norm,
  parseDate,
  type EntityHandler,
  type MappedRow,
  type ImportContext,
} from "../engine";
import { crearLectorMontos } from "../valores";
import { cargarExternos, guardarExternos, limpiarId } from "../externos";
import { newId, cellText, oneLine, calendarNoonUtc, dayKey, nombreOrigen } from "../migrado";
import { loadPatientIndex, resolveLabExpensePatient } from "./paciente";

/** Fuente fija de las llaves en import_external_ids (idempotencia, ver llaveDeGasto). */
const FUENTE_LAB = "laboratorio-historial";

/** ¿El error es "la tabla migrated_lab_expenses no existe todavía"? (SQL pendiente, sql/laboratorio-historial-migrado.sql) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

/**
 * Llave estable de un gasto de laboratorio: la misma fila da la misma llave en
 * cualquier reintento. Con ID del sistema de origen, es ese ID. Sin él:
 * paciente + día + costo + acción (mismo criterio que llaveDePago en
 * pagos-historial/handler.ts) — así si el archivo trae la misma acción dos
 * veces con columnas distintas, sigue siendo el mismo movimiento.
 */
function llaveDeGasto(o: { patientId: string; fecha: Date; costo: number; accion: string; externalId: string; origen: string }): string {
  if (o.externalId) return `id:${o.origen}:${o.externalId}`;
  return `h:${o.patientId}|${dayKey(calendarNoonUtc(o.fecha))}|${o.costo.toFixed(2)}|${norm(o.accion)}`;
}

/** Mensaje en español para un error de DB al insertar una fila concreta. */
function rowDbErrorMessage(e: any): string {
  if (e?.code === "P2003") return "No se pudo guardar: el paciente ya no existe";
  return "No se pudo guardar la fila (error de base de datos)";
}

export const labExpenseHandler: EntityHandler = {
  entity: "labExpenseHistory",
  auditEntityType: "invoice",
  sheetNames: ["laboratorio", "laboratorios", "accioneslaboratorio", "costoslaboratorio", "gastoslaboratorio", "labactionscosts"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    // ID del paciente en el sistema de origen (el mismo que trajo el archivo de pacientes).
    patientExternalId: ["idpaciente", "#paciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    // ID de la ACCIÓN de laboratorio (no del paciente) en el sistema de origen.
    externalId: ["idaccion", "idaccionlaboratorio", "idlaboratorio", "idsolicitud", "idorden", "idordenlaboratorio", "codigo"],
    labName: ["laboratorio", "nombrelaboratorio", "laboratorioexterno", "proveedorlaboratorio"],
    // La acción/prestación de laboratorio: "Corona zirconia", "Placa oclusal"…
    action: ["accion", "acciondelaboratorio", "prestacion", "prestaciondelaboratorio", "servicio", "servciodelaboratorio", "trabajolaboratorio", "nombreaccion", "descripcionaccion"],
    // Costo para la CLÍNICA (lo que se le paga al laboratorio) — el "gasto".
    cost: ["costo", "costolaboratorio", "costoclinica", "costoparalaclinica", "costodellaboratorio", "valorcosto", "preciolaboratorio"],
    // Precio cobrado al paciente por esa acción (informativo, no genera cobro).
    patientPrice: ["preciopaciente", "precioparaelpaciente", "preciocobrado", "preciodelpaciente"],
    date: ["fecha", "fechasolicitud", "fechaenvio", "fechalaboratorio", "fechaaccion", "fechadelaccion", "fechadesolicitud"],
    doctor: ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional", "atiende"],
    description: ["estado", "comentario", "comentarios", "detalle", "observaciones", "nota", "notas"],
  },

  validateMapping(campos) {
    if (!campos.has("cost")) return "Falta la columna del costo de laboratorio";
    if (!campos.has("action") && !campos.has("labName")) return "Falta una columna con la acción o el laboratorio";
    if (!campos.has("phone") && !campos.has("email") && !campos.has("name") && !campos.has("patientExternalId")) {
      return "Falta una columna para identificar al paciente (ID, teléfono, correo o nombre)";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const idx = await loadPatientIndex(clinicId, ctx);
    const origen = nombreOrigen(ctx.originName);

    // Doctor (opcional): cualquier usuario activo de la clínica, por nombre.
    const users = await prisma.user.findMany({ where: { clinicId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
    const byDoctor = new Map<string, string>();
    for (const u of users) {
      const key = norm(`${u.firstName} ${u.lastName}`);
      if (key && !byDoctor.has(key)) byDoctor.set(key, u.id);
    }

    const lectorCosto = crearLectorMontos(
      rows.map((r) => r.mapped.cost),
      ctx.valueMapping[AMOUNT_FORMAT_FIELD]?.[AMOUNT_FORMAT_KEY],
    );
    // Precio al paciente es solo informativo: si viene ambiguo, se guarda sin
    // resolver (null) en vez de bloquear la fila por un dato que no es el gasto.
    const lectorPrecio = crearLectorMontos(rows.map((r) => r.mapped.patientPrice), undefined);

    // Lo ya importado: por llave (import_external_ids)…
    const externos = await cargarExternos(clinicId, FUENTE_LAB, "labExpense");
    // …y, como red, contra lo que ya quedó en migrated_lab_expenses (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedLabExpense.findMany({
        where: { clinicId },
        select: { patientId: true, cost: true, incurredAt: true, action: true },
      });
      for (const g of ya) {
        existentes.add(`h:${g.patientId}|${dayKey(calendarNoonUtc(g.incurredAt))}|${round2(g.cost).toFixed(2)}|${norm(g.action ?? "")}`);
      }
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const vecesEnArchivo = new Map<string, number>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const lectura = lectorCosto.leer(mapped.cost);
      if (lectura.vacio) pr.errors.push(`Costo inválido "${mapped.cost ?? ""}"`);
      else if (lectura.error) pr.errors.push(lectura.error);
      else if ((lectura.valor ?? 0) <= 0) pr.errors.push("El costo debe ser mayor que cero");
      else if (lectura.pendiente) {
        pr.errors.push(`Costo ambiguo «${lectura.pendiente}»: puede ser de miles o con decimales. Confirma cómo se leen en la vista previa`);
        pr.unresolved = [{ field: AMOUNT_FORMAT_FIELD, key: AMOUNT_FORMAT_KEY, value: lectura.pendiente }];
      }
      if (lectura.aviso) pr.warnings.push(lectura.aviso);
      const costo = lectura.valor ? Math.abs(lectura.valor) : null;

      let precioPaciente: number | null = null;
      if (mapped.patientPrice && cellText(mapped.patientPrice)) {
        const lecturaPrecio = lectorPrecio.leer(mapped.patientPrice);
        if (!lecturaPrecio.vacio && !lecturaPrecio.error && !lecturaPrecio.pendiente && lecturaPrecio.valor != null) {
          precioPaciente = Math.abs(lecturaPrecio.valor);
        }
        // Ambiguo o inválido: se omite (es informativo) en vez de bloquear la fila.
      }

      const fecha = mapped.date ? parseDate(mapped.date) : null;
      if (!mapped.date || !cellText(mapped.date)) pr.errors.push("Falta la fecha de la acción de laboratorio");
      else if (!fecha) pr.errors.push(`Fecha "${cellText(mapped.date)}" inválida`);

      const nombreAccion = mapped.action ? oneLine(mapped.action, 200) : "";
      const nombreLab = mapped.labName ? oneLine(mapped.labName, 200) : "";
      if (!nombreAccion && !nombreLab) pr.errors.push("Falta la acción o el nombre del laboratorio");

      const res = resolveLabExpensePatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const accionFinal = nombreAccion || nombreLab;
      const detalle = mapped.description ? oneLine(mapped.description, 300) : "";

      let doctorId: string | undefined;
      if (mapped.doctor && cellText(mapped.doctor)) {
        const key = norm(cellText(mapped.doctor));
        doctorId = byDoctor.get(key);
        if (!doctorId) pr.warnings.push(`Doctor "${cellText(mapped.doctor)}" no encontrado en la clínica: se guarda sin doctor`);
      }

      const externalId = ctx.originId ? limpiarId(mapped.externalId) : "";
      const llave = llaveDeGasto({ patientId: res.id!, fecha: fecha!, costo: costo!, accion: accionFinal, externalId, origen: ctx.originId });
      const n = (vecesEnArchivo.get(llave) ?? 0) + 1;
      vecesEnArchivo.set(llave, n);
      const llaveFinal = n > 1 ? `${llave}#${n}` : llave;

      pr.data = {
        patientId: res.id,
        name: res.fullName || (mapped.name ? String(mapped.name).trim() : undefined),
        labName: nombreLab || null,
        action: accionFinal || detalle || "Acción de laboratorio",
        cost: costo,
        patientPrice: precioPaciente,
        doctorId: doctorId ?? null,
        incurredAt: fecha,
        origin: origen,
        key: llaveFinal,
      };

      const redKey = `h:${res.id}|${dayKey(calendarNoonUtc(fecha!))}|${costo!.toFixed(2)}|${norm(accionFinal)}`;
      if (externos.mapa.has(llaveFinal) || existentes.has(redKey)) {
        pr.status = "skipped";
        pr.warnings.push("Este gasto de laboratorio ya se importó antes");
      } else if (n > 1) {
        pr.status = "duplicate";
        pr.warnings.push("Fila repetida en el archivo (mismo paciente, fecha, costo y acción)");
      }
      out.push(pr);
    }
    return out;
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    // Preflight: si la tabla no existe todavía (SQL pendiente), un error claro
    // en vez de que cada lote falle uno por uno.
    try {
      await prisma.migratedLabExpense.count({ where: { clinicId } });
    } catch (e) {
      if (faltaLaTabla(e)) {
        throw new ImportError(
          409,
          "Falta aplicar el SQL del historial de gastos de laboratorio (sql/laboratorio-historial-migrado.sql) antes de importar",
          undefined,
          "MIGRATED_LAB_EXPENSES_TABLE_MISSING",
        );
      }
      throw e;
    }

    for (const r of toInsert) r.data.newId = newId();

    let created = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const build = (rs: PreviewRow[]) => rs.map((r) => ({
        id: r.data.newId as string,
        clinicId,
        patientId: r.data.patientId as string,
        labName: (r.data.labName as string | null) ?? null,
        action: r.data.action as string,
        cost: round2(r.data.cost as number),
        patientPrice: r.data.patientPrice != null ? round2(r.data.patientPrice as number) : null,
        doctorId: (r.data.doctorId as string | null) ?? null,
        incurredAt: r.data.incurredAt as Date,
        origin: r.data.origin as string,
        createdById: ctx.userId,
      }));
      try {
        created += (await prisma.migratedLabExpense.createMany({ data: build(slice), skipDuplicates: true })).count;
      } catch {
        // Error de DB en el bloque (p. ej. FK si borraron al paciente entre dry-run y commit):
        // NO abortamos el lote, aislamos fila por fila.
        for (const r of slice) {
          try {
            created += (await prisma.migratedLabExpense.createMany({ data: build([r]), skipDuplicates: true })).count;
          } catch (e2: any) {
            r.status = "error";
            r.errors.push(rowDbErrorMessage(e2));
          }
        }
      }
    }

    // Recuerda la llave de lo que SÍ quedó creado: el reintento lo reconoce.
    const pares = toInsert
      .filter((r) => r.status !== "error")
      .map((r) => ({ externalId: r.data.key as string, localId: r.data.newId as string }));
    if (pares.length > 0 && !(await guardarExternos(clinicId, FUENTE_LAB, "labExpense", pares))) {
      console.warn("[import/lab-expenses] import_external_ids no existe: la idempotencia usa solo la red de siempre (falta aplicar sql/import-ids-externos.sql)");
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
