// MENSUALIDADES / CUOTAS POR VENCER MIGRADAS (ws1-t6, sep-2026): Dentalink
// "08c_Pagos_Por_Vencimiento" y equivalentes. Cada fila es una cuota FUTURA
// (o ya vencida) de un plan a plazos que el paciente traía del sistema
// anterior — el CALENDARIO de una deuda, no dinero nuevo:
//
//   · La deuda YA está contada en la factura "Saldo inicial migrado"
//     (balancesHandler, entities.ts) o en el `totalAmount` de un
//     MigratedOrthoCase (ws1-t1, importador de casos de ortodoncia). Esta
//     tabla SOLO reparte esa MISMA cantidad en fechas: si la suma de cuotas
//     de un paciente no cuadra con el ancla que se le encontró, se avisa en
//     la vista previa (no bloquea — el dato de origen manda, pero el sistema
//     no finge una certeza que no tiene).
//   · NUNCA toca `invoices`/`payments`: por eso Caja, cortes de caja, CFDI y
//     WhatsApp la ignoran SIN código nuevo (ninguno lee migrated_installments).
//   · Se ve, de solo lectura, en la ficha del paciente ("Plan de pagos a
//     plazos (migrado)" — ver leer.ts + la tarjeta de la ficha).
//
// Construido en un archivo NUEVO (no en entities.ts) porque ws1-t12 puede
// estar cambiando el motor/detección/UI del asistente en paralelo. Reusa
// `loadPatientIndex`/`resolvePaymentPatient` de ../pagos-historial/paciente
// (módulo ya estable y commiteado, NO entities.ts) para la resolución STRICT
// del paciente — es dinero, no se copia la lógica dos veces.
//
// FUENTES DEL MAPEO (28-sep-2026) — Dentalink NO documenta un reporte
// "Pagos por vencimiento" ni en su API pública (https://api.dentalink.
// healthatom.com/docs/) ni en la ayuda de Reportes Excel (https://ayuda.
// softwaredentalink.com/es/articles/9493465-reportes-excel, que solo lista
// "Citas pacientes", "Pacientes morosos" y "Pagos pacientes"). Los
// encabezados de abajo son una extrapolación del vocabulario chileno que SÍ
// usan esos reportes documentados («N° Presupuesto», «Paciente», «Celular») —
// nunca se verificaron contra un export real: por eso el perfil sigue
// `verified:false` y, si no casan, el paso de mapeo pide emparejar a mano.
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
import { loadPatientIndex, resolvePaymentPatient } from "../pagos-historial/paciente";

/** Fuente fija de las llaves en import_external_ids (idempotencia, ver llaveDeCuota). */
const FUENTE_CUOTAS = "cuotas-plan";

/**
 * Nota que marca la factura de apertura creada por balancesHandler
 * (entities.ts). DUPLICADO A PROPÓSITO: entities.ts no la exporta y este
 * archivo evita depender de él mientras ws1-t12 lo tiene en paralelo. Si el
 * texto de allá cambia, este ancla deja de encontrar la factura (se degrada a
 * "sin factura ligada", nunca revienta).
 */
const OPENING_BALANCE_NOTE = "Saldo inicial migrado";

/** ¿El error es "la tabla no existe todavía"? (SQL pendiente) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

/**
 * Llave estable de una cuota: la misma fila da la misma llave en cualquier
 * reintento. Con ID del sistema de origen, es ese ID. Sin él: paciente +
 * vencimiento + monto + folio del plan (mismo criterio que llaveDePago en
 * pagos-historial/handler.ts).
 */
function llaveDeCuota(o: { patientId: string; vencimiento: Date; monto: number; folio: string; externalId: string; origen: string }): string {
  if (o.externalId) return `id:${o.origen}:${o.externalId}`;
  return `c:${o.patientId}|${dayKey(calendarNoonUtc(o.vencimiento))}|${o.monto.toFixed(2)}|${norm(o.folio)}`;
}

/** Normaliza el estado tal como venía en el archivo a un bucket informativo. PENDING por omisión. */
function normalizarEstado(v: unknown): "PENDING" | "PAID" | "OVERDUE" {
  const n = norm(cellText(v));
  if (!n) return "PENDING";
  if (["pagada", "pagado", "paid", "cancelada", "cancelado", "cobrada"].includes(n)) return "PAID";
  if (["vencida", "vencido", "atrasada", "atrasado", "overdue", "morosa"].includes(n)) return "OVERDUE";
  return "PENDING";
}

function rowDbErrorMessage(e: any): string {
  if (e?.code === "P2003") return "No se pudo guardar: el paciente ya no existe";
  return "No se pudo guardar la fila (error de base de datos)";
}

const INSTALLMENT_PLANS_ENTITY: Entity = "installmentPlans";

export const installmentPlansHandler: EntityHandler = {
  entity: INSTALLMENT_PLANS_ENTITY,
  auditEntityType: "invoice",
  sheetNames: ["cuotas", "pagosporvencimiento", "mensualidades", "planesaplazos", "cuotasplan"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    // ID del paciente en el sistema de origen (el mismo que trajo el archivo de pacientes).
    patientExternalId: ["idpaciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    // ID de la CUOTA (no del paciente) en el sistema de origen.
    externalId: ["idcuota", "idpagovencimiento", "idmovimiento", "idplan", "idcuotaexterno"],
    // Folio del tratamiento/presupuesto/plan al que pertenece esta cuota (agrupa).
    folio: ["folio", "npresupuesto", "nopresupuesto", "ntratamiento", "notratamiento", "idplanpago", "plandepago"],
    installmentNumber: ["ncuota", "nocuota", "cuota", "numerocuota", "numerodecuota", "cuotan"],
    amount: ["montocuota", "monto", "importe", "valorcuota", "cuotamonto", "valor"],
    dueDate: ["fechavencimiento", "vencimiento", "fecha", "fechadevencimiento", "fechapago", "fechaporvencer"],
    status: ["estado", "estadocuota", "situacion", "status"],
    description: ["concepto", "descripcion", "detalle", "tratamiento", "observaciones"],
  },

  validateMapping(campos) {
    if (!campos.has("amount")) return "Falta la columna del monto de la cuota";
    if (!campos.has("dueDate")) return "Falta la columna de la fecha de vencimiento";
    if (!campos.has("phone") && !campos.has("email") && !campos.has("name") && !campos.has("patientExternalId")) {
      return "Falta una columna para identificar al paciente (ID, teléfono, correo o nombre)";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    const idx = await loadPatientIndex(clinicId, ctx);
    const origen = nombreOrigen(ctx.originName);

    // ── Anclas: a qué deuda YA migrada pertenece cada cuota (una consulta, no por fila) ──
    const openingInvoices = await prisma.invoice.findMany({
      where: { clinicId, notes: OPENING_BALANCE_NOTE },
      select: { id: true, patientId: true, balance: true },
    });
    const invoiceByPatient = new Map(openingInvoices.map((i) => [i.patientId, { id: i.id, balance: i.balance }]));

    const orthoCaseByPatient = new Map<string, { id: string; totalAmount: number | null }>();
    try {
      const casos: Array<{ id: string; patientId: string; totalAmount: number | null }> = await prisma.migratedOrthoCase.findMany({
        where: { clinicId },
        select: { id: true, patientId: true, totalAmount: true },
      });
      for (const c of casos) orthoCaseByPatient.set(c.patientId, { id: c.id, totalAmount: c.totalAmount });
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const lector = crearLectorMontos(
      rows.map((r) => r.mapped.amount),
      ctx.valueMapping[AMOUNT_FORMAT_FIELD]?.[AMOUNT_FORMAT_KEY],
    );

    // Lo ya importado: por llave (import_external_ids)…
    const externos = await cargarExternos(clinicId, FUENTE_CUOTAS, "installment");
    // …y, como red, contra lo que ya quedó en migrated_installments (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedInstallment.findMany({
        where: { clinicId },
        select: { patientId: true, amount: true, dueDate: true, planExternalId: true },
      });
      for (const c of ya) {
        existentes.add(`c:${c.patientId}|${dayKey(calendarNoonUtc(c.dueDate))}|${round2(c.amount).toFixed(2)}|${norm(c.planExternalId ?? "")}`);
      }
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    interface Fila {
      pr: PreviewRow;
      patientId: string;
      folio: string;
      installmentNumber: number | null;
      dueDate: Date;
    }
    const filas: Fila[] = [];
    const vecesEnArchivo = new Map<string, number>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const lectura = lector.leer(mapped.amount);
      if (lectura.vacio) pr.errors.push(`Monto inválido "${mapped.amount ?? ""}"`);
      else if (lectura.error) pr.errors.push(lectura.error);
      else if ((lectura.valor ?? 0) <= 0) pr.errors.push("La cuota debe ser mayor que cero");
      else if (lectura.pendiente) {
        pr.errors.push(`Monto ambiguo «${lectura.pendiente}»: puede ser de miles o con decimales. Confirma cómo se leen en la vista previa`);
        pr.unresolved = [{ field: AMOUNT_FORMAT_FIELD, key: AMOUNT_FORMAT_KEY, value: lectura.pendiente }];
      }
      if (lectura.aviso) pr.warnings.push(lectura.aviso);
      const monto = lectura.valor ? Math.abs(lectura.valor) : null;

      const dueDate = mapped.dueDate ? parseDate(mapped.dueDate) : null;
      if (!mapped.dueDate || !cellText(mapped.dueDate)) pr.errors.push("Falta la fecha de vencimiento");
      else if (!dueDate) pr.errors.push(`Fecha de vencimiento "${cellText(mapped.dueDate)}" inválida`);

      const res = resolvePaymentPatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      let installmentNumber: number | null = null;
      if (cellText(mapped.installmentNumber)) {
        const n = Number(String(mapped.installmentNumber).replace(",", "."));
        if (Number.isInteger(n) && n >= 1 && n <= 999) installmentNumber = n;
        else pr.warnings.push(`N° de cuota "${cellText(mapped.installmentNumber)}" inválido: se asigna por orden de vencimiento`);
      }

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const folio = oneLine(mapped.folio, 60);
      const concepto = mapped.description ? oneLine(mapped.description, 300) : "";
      const estado = normalizarEstado(mapped.status);
      const externalId = ctx.originId ? limpiarId(mapped.externalId) : "";

      const anchorOrtho = orthoCaseByPatient.get(res.id!);
      const anchorInvoice = invoiceByPatient.get(res.id!);
      const migratedOrthoCaseId = anchorOrtho?.id ?? null;
      // Prioridad: si el paciente tiene un caso de ortodoncia migrado, la cuota
      // se ancla a ese caso (su totalAmount es la deuda). Si no, a la factura de
      // apertura de saldos. Ninguno de los dos: sin ancla (se avisa más abajo).
      const invoiceId = !migratedOrthoCaseId ? (anchorInvoice?.id ?? null) : null;
      if (!migratedOrthoCaseId && !invoiceId) {
        pr.warnings.push("No se encontró una factura de saldo inicial ni un caso de ortodoncia migrado para este paciente: la cuota se guarda solo para consulta, sin ligar a una deuda");
      }

      const llave = llaveDeCuota({ patientId: res.id!, vencimiento: dueDate!, monto: monto!, folio, externalId, origen: ctx.originId });
      const n = (vecesEnArchivo.get(llave) ?? 0) + 1;
      vecesEnArchivo.set(llave, n);
      const llaveFinal = n > 1 ? `${llave}#${n}` : llave;

      pr.data = {
        patientId: res.id,
        name: res.fullName || (mapped.name ? String(mapped.name).trim() : undefined),
        amount: monto,
        dueDate,
        installmentNumber,
        folio: folio || null,
        status: estado,
        concept: concepto || null,
        invoiceId,
        migratedOrthoCaseId,
        origin: origen,
        key: llaveFinal,
        anchorTotal: migratedOrthoCaseId ? anchorOrtho?.totalAmount ?? null : anchorInvoice?.balance ?? null,
        anchorGroup: migratedOrthoCaseId ? `oc:${migratedOrthoCaseId}` : invoiceId ? `iv:${invoiceId}` : null,
      };

      const redKey = `c:${res.id}|${dayKey(calendarNoonUtc(dueDate!))}|${monto!.toFixed(2)}|${norm(folio)}`;
      if (externos.mapa.has(llaveFinal) || existentes.has(redKey)) {
        pr.status = "skipped";
        pr.warnings.push("Esta cuota ya se importó antes");
      } else if (n > 1) {
        pr.status = "duplicate";
        pr.warnings.push("Fila repetida en el archivo (mismo paciente, vencimiento, monto y folio)");
      }
      out.push(pr);
      filas.push({ pr, patientId: res.id!, folio, installmentNumber, dueDate: dueDate! });
    }

    // ── N° de cuota: si la fila no lo trae, se asigna por orden de vencimiento
    //    dentro de su grupo (mismo paciente + folio; sin folio, solo paciente) ──
    const grupos = new Map<string, Fila[]>();
    for (const f of filas) {
      if (f.pr.status === "error") continue;
      const k = `${f.patientId}|${norm(f.folio)}`;
      const g = grupos.get(k);
      if (g) g.push(f);
      else grupos.set(k, [f]);
    }
    for (const g of Array.from(grupos.values())) {
      const sinNumero = g.filter((f) => f.installmentNumber === null);
      if (sinNumero.length === 0) continue;
      const ordenado = [...g].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      let siguiente = (g.find((f) => f.installmentNumber !== null)?.installmentNumber ?? 0) + 1;
      const usados = new Set(g.filter((f) => f.installmentNumber !== null).map((f) => f.installmentNumber));
      for (const f of ordenado) {
        if (f.installmentNumber !== null) continue;
        while (usados.has(siguiente)) siguiente++;
        f.installmentNumber = siguiente;
        f.pr.data.installmentNumber = siguiente;
        usados.add(siguiente);
        siguiente++;
      }
    }

    // ── Cuadre: la suma de cuotas de un mismo ancla (factura o caso) contra su
    //    total conocido. Es un AVISO, no bloquea: el dato de origen manda. ──
    const porAncla = new Map<string, PreviewRow[]>();
    for (const r of out) {
      const grupo = r.data?.anchorGroup as string | null | undefined;
      if (!grupo || (r.status !== "ok" && r.status !== "duplicate")) continue;
      const g = porAncla.get(grupo);
      if (g) g.push(r);
      else porAncla.set(grupo, [r]);
    }
    for (const [, rowsDelAncla] of Array.from(porAncla.entries())) {
      const total = rowsDelAncla[0].data.anchorTotal as number | null;
      if (total === null || total === undefined) continue;
      const suma = rowsDelAncla.reduce((a, r) => a + (r.data.amount as number), 0);
      if (Math.abs(round2(suma) - round2(total)) > 0.01) {
        for (const r of rowsDelAncla) {
          r.warnings.push(`El total de las cuotas (${round2(suma).toFixed(2)}) no coincide con el saldo de la deuda ligada (${round2(total).toFixed(2)}): revisa el archivo de saldos o del caso`);
        }
      }
    }

    return out;
  },

  async commit(rows: PreviewRow[], clinicId: string, skipDuplicates: boolean, ctx: ImportContext) {
    const toInsert = pickInsertable(rows, skipDuplicates);
    if (toInsert.length === 0) return { created: 0, skipped: 0 };

    // Preflight: si la tabla no existe todavía (SQL pendiente), un error claro
    // en vez de que cada lote falle uno por uno.
    try {
      await prisma.migratedInstallment.count({ where: { clinicId } });
    } catch (e) {
      if (faltaLaTabla(e)) {
        throw new ImportError(
          409,
          "Falta aplicar el SQL de las cuotas por vencer (sql/cuotas-por-vencer-migradas.sql) antes de importar",
          undefined,
          "MIGRATED_INSTALLMENTS_TABLE_MISSING",
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
        invoiceId: (r.data.invoiceId as string | null) ?? null,
        migratedOrthoCaseId: (r.data.migratedOrthoCaseId as string | null) ?? null,
        planExternalId: (r.data.folio as string | null) ?? null,
        installmentNumber: r.data.installmentNumber as number,
        amount: round2(r.data.amount as number),
        dueDate: r.data.dueDate as Date,
        status: r.data.status as string,
        concept: (r.data.concept as string | null) ?? null,
        origin: r.data.origin as string,
        createdById: ctx.userId,
      }));
      try {
        created += (await prisma.migratedInstallment.createMany({ data: build(slice), skipDuplicates: true })).count;
      } catch {
        // Error de DB en el bloque (p. ej. FK si borraron al paciente entre dry-run y commit):
        // NO abortamos el lote, aislamos fila por fila.
        for (const r of slice) {
          try {
            created += (await prisma.migratedInstallment.createMany({ data: build([r]), skipDuplicates: true })).count;
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
    if (pares.length > 0 && !(await guardarExternos(clinicId, FUENTE_CUOTAS, "installment", pares))) {
      console.warn("[import/installment-plans] import_external_ids no existe: la idempotencia usa solo la red de siempre (falta aplicar sql/import-ids-externos.sql)");
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
