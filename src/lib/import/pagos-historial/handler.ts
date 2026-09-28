// HISTORIAL DE PAGOS MIGRADO (ws1-t6, sep-2026): Dentalink "Pagos pacientes" y
// equivalentes de Excel/otros sistemas. Cada fila es un pago que YA ocurrió en
// el sistema anterior — pura historia:
//   · NUNCA cambia el saldo del paciente (ese viene del archivo de saldos,
//     balancesHandler en entities.ts). Nada se cuenta dos veces.
//   · NUNCA toca `invoices`/`payments`: por eso Caja, cortes de caja, CFDI y
//     WhatsApp la ignoran SIN código nuevo — ninguno lee `migrated_payments`.
//   · Se ve, de solo lectura, en la ficha del paciente ("Pagos anteriores
//     (migrados)" — ver leer.ts + la tarjeta de la ficha).
//
// Construido en un archivo NUEVO (no en entities.ts) porque ws1-t12 está
// cambiando el motor/detección/UI del asistente en paralelo. Este handler es
// EntityHandler-compatible (mismo shape que engine.ts espera) y se invoca
// directo con `runImport(paymentHistoryHandler, opts)` desde su propia ruta
// (src/app/api/import/payment-history/route.ts) — NO pasa por el registro de
// entities.ts todavía. `entity`/`Entity` de types.ts no declara este tipo
// ("paymentHistory"): se castea vía `unknown` a propósito para no tocar ese
// archivo compartido; el registro real (entities.ts + detección + el wizard)
// es el último paso de esta tarea, cuando ws1-t12 esté commiteado.
//
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa).

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
import { loadPatientIndex, resolvePaymentPatient } from "./paciente";

/** Fuente fija de las llaves en import_external_ids (idempotencia, ver llaveDePago). */
const FUENTE_PAGOS = "pagos-historial";

/** ¿El error es "la tabla migrated_payments no existe todavía"? (SQL pendiente, sql/pagos-historial-migrados.sql) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

/**
 * Llave estable de un pago: la misma fila da la misma llave en cualquier
 * reintento. Con ID del sistema de origen, es ese ID. Sin él: paciente + día +
 * monto + concepto (mismo criterio que llaveDeSaldo en entities.ts) — así si
 * el archivo trae el mismo pago dos veces con columnas distintas, sigue
 * siendo el mismo movimiento.
 */
function llaveDePago(o: { patientId: string; fecha: Date; monto: number; concepto: string; externalId: string; origen: string }): string {
  if (o.externalId) return `id:${o.origen}:${o.externalId}`;
  return `h:${o.patientId}|${dayKey(calendarNoonUtc(o.fecha))}|${o.monto.toFixed(2)}|${norm(o.concepto)}`;
}

/** Mensaje en español para un error de DB al insertar una fila concreta. */
function rowDbErrorMessage(e: any): string {
  if (e?.code === "P2003") return "No se pudo guardar: el paciente ya no existe";
  return "No se pudo guardar la fila (error de base de datos)";
}

export const paymentHistoryHandler: EntityHandler = {
  // Cast a propósito: "paymentHistory" no está (todavía) en el union Entity de
  // types.ts — ver nota de cabecera. El shape del objeto es el mismo que
  // exige EntityHandler; runImport nunca compara `entity` contra el union,
  // solo lo usa como etiqueta en las respuestas.
  entity: "paymentHistory" as unknown as Entity,
  auditEntityType: "invoice",
  sheetNames: ["pagos", "pago", "historialpagos", "pagospacientes", "payments"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    // ID del paciente en el sistema de origen (el mismo que trajo el archivo de pacientes).
    patientExternalId: ["idpaciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    // ID del PAGO (no del paciente) en el sistema de origen.
    externalId: ["idpago", "idmovimiento", "idrecibo", "idcobro", "idtransaccion", "idabono", "idpagoexterno"],
    amount: ["monto", "importe", "pago", "abono", "cantidad", "montopagado", "valor", "montodelpago"],
    method: ["metododepago", "metodo", "formadepago", "forma", "mediodepago", "tipodepago"],
    date: ["fecha", "fechadepago", "fechapago", "fechaabono", "fechamovimiento", "fechadelpago"],
    doctor: ["doctor", "doctora", "medico", "odontologo", "odontologa", "dentista", "profesional", "atiende"],
    description: ["concepto", "descripcion", "folio", "referencia", "detalle", "observaciones", "nota"],
  },

  validateMapping(campos) {
    if (!campos.has("amount")) return "Falta la columna del monto del pago";
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

    const lector = crearLectorMontos(
      rows.map((r) => r.mapped.amount),
      ctx.valueMapping[AMOUNT_FORMAT_FIELD]?.[AMOUNT_FORMAT_KEY],
    );

    // Lo ya importado: por llave (import_external_ids)…
    const externos = await cargarExternos(clinicId, FUENTE_PAGOS, "payment");
    // …y, como red, contra lo que ya quedó en migrated_payments (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedPayment.findMany({
        where: { clinicId },
        select: { patientId: true, amount: true, paidAt: true, concept: true },
      });
      for (const p of ya) {
        existentes.add(`h:${p.patientId}|${dayKey(calendarNoonUtc(p.paidAt))}|${round2(p.amount).toFixed(2)}|${norm(p.concept ?? "")}`);
      }
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const vecesEnArchivo = new Map<string, number>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const lectura = lector.leer(mapped.amount);
      if (lectura.vacio) pr.errors.push(`Monto inválido "${mapped.amount ?? ""}"`);
      else if (lectura.error) pr.errors.push(lectura.error);
      else if ((lectura.valor ?? 0) <= 0) pr.errors.push("El pago debe ser mayor que cero");
      else if (lectura.pendiente) {
        pr.errors.push(`Monto ambiguo «${lectura.pendiente}»: puede ser de miles o con decimales. Confirma cómo se leen en la vista previa`);
        pr.unresolved = [{ field: AMOUNT_FORMAT_FIELD, key: AMOUNT_FORMAT_KEY, value: lectura.pendiente }];
      }
      if (lectura.aviso) pr.warnings.push(lectura.aviso);
      const monto = lectura.valor ? Math.abs(lectura.valor) : null;

      const fecha = mapped.date ? parseDate(mapped.date) : null;
      if (!mapped.date || !cellText(mapped.date)) pr.errors.push("Falta la fecha del pago");
      else if (!fecha) pr.errors.push(`Fecha "${cellText(mapped.date)}" inválida`);

      const res = resolvePaymentPatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const concepto = mapped.description ? oneLine(mapped.description, 300) : "";
      const metodo = mapped.method ? oneLine(mapped.method, 60) : "";

      let doctorId: string | undefined;
      if (mapped.doctor && cellText(mapped.doctor)) {
        const key = norm(cellText(mapped.doctor));
        doctorId = byDoctor.get(key);
        if (!doctorId) pr.warnings.push(`Doctor "${cellText(mapped.doctor)}" no encontrado en la clínica: se guarda sin doctor`);
      }

      const externalId = ctx.originId ? limpiarId(mapped.externalId) : "";
      const llave = llaveDePago({ patientId: res.id!, fecha: fecha!, monto: monto!, concepto, externalId, origen: ctx.originId });
      const n = (vecesEnArchivo.get(llave) ?? 0) + 1;
      vecesEnArchivo.set(llave, n);
      const llaveFinal = n > 1 ? `${llave}#${n}` : llave;

      pr.data = {
        patientId: res.id,
        name: res.fullName || (mapped.name ? String(mapped.name).trim() : undefined),
        amount: monto,
        method: metodo || null,
        concept: concepto || null,
        doctorId: doctorId ?? null,
        paidAt: fecha,
        origin: origen,
        key: llaveFinal,
      };

      const redKey = `h:${res.id}|${dayKey(calendarNoonUtc(fecha!))}|${monto!.toFixed(2)}|${norm(concepto)}`;
      if (externos.mapa.has(llaveFinal) || existentes.has(redKey)) {
        pr.status = "skipped";
        pr.warnings.push("Este pago ya se importó antes");
      } else if (n > 1) {
        pr.status = "duplicate";
        pr.warnings.push("Fila repetida en el archivo (mismo paciente, fecha, monto y concepto)");
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
      await prisma.migratedPayment.count({ where: { clinicId } });
    } catch (e) {
      if (faltaLaTabla(e)) {
        throw new ImportError(
          409,
          "Falta aplicar el SQL del historial de pagos (sql/pagos-historial-migrados.sql) antes de importar",
          undefined,
          "MIGRATED_PAYMENTS_TABLE_MISSING",
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
        amount: round2(r.data.amount as number),
        method: (r.data.method as string | null) ?? null,
        concept: (r.data.concept as string | null) ?? null,
        doctorId: (r.data.doctorId as string | null) ?? null,
        paidAt: r.data.paidAt as Date,
        origin: r.data.origin as string,
        createdById: ctx.userId,
      }));
      try {
        created += (await prisma.migratedPayment.createMany({ data: build(slice), skipDuplicates: true })).count;
      } catch {
        // Error de DB en el bloque (p. ej. FK si borraron al paciente entre dry-run y commit):
        // NO abortamos el lote, aislamos fila por fila.
        for (const r of slice) {
          try {
            created += (await prisma.migratedPayment.createMany({ data: build([r]), skipDuplicates: true })).count;
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
    if (pares.length > 0 && !(await guardarExternos(clinicId, FUENTE_PAGOS, "payment", pares))) {
      console.warn("[import/payment-history] import_external_ids no existe: la idempotencia usa solo la red de siempre (falta aplicar sql/import-ids-externos.sql)");
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
