// CASOS DE ORTODONCIA MIGRADOS (ws1-t1, sep-2026): "11_Pacientes_Ortodoncia"
// de Dentalink y equivalentes de Excel/otros sistemas. Cada fila es un caso
// de ortodoncia YA ABIERTO en el sistema anterior — historia administrativa:
//   · NUNCA crea OrthodonticDiagnosis/OrthodonticTreatmentPlan (el caso
//     CLÍNICO vivo del módulo): ese modelo exige datos de examen clínico
//     (angleClassRight, overbiteMm, overjetMm, dentalPhase,
//     clinicalSummary…) que Dentalink no exporta. Ver el comentario de
//     MigratedOrthoCase en prisma/schema.prisma.
//   · NUNCA toca `invoices`/`payments`: el precio total del caso es
//     informativo (el saldo del paciente ya debería venir contado por el
//     archivo de saldos, /api/import/balances — una factura aparte del caso
//     lo duplicaría).
//   · Solo en sedes con el módulo de Ortodoncia activo: si no, se avisa en
//     la vista previa (todas las filas quedan en error con el motivo) y no
//     se importa nada.
//   · Se ve, de solo lectura, en la ficha del paciente (pestaña Ortodoncia)
//     como "Casos de ortodoncia (migrados)".
//
// Construido en archivos NUEVOS (no en entities.ts) porque ws1-t12 está
// cambiando ese motor en paralelo; se registra ahí en cuanto esa tarea
// termine (ver el reporte de esta tarea). Este handler es
// EntityHandler-compatible (mismo shape que engine.ts espera) y se invoca
// directo con `runImport(orthoCasesHandler, opts)` desde su propia ruta
// (src/app/api/import/ortho-cases/route.ts).
//
// Multi-tenant: clinicId SIEMPRE de la sesión (runImport lo pasa).

import { prisma } from "@/lib/prisma";
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
import { cellText, oneLine, calendarNoonUtc, dayKey, nombreOrigen, newId as newRowId } from "../migrado";
import { cargarExternosOrthoCase, guardarExternosOrthoCase, limpiarId } from "./externos";
import { loadPatientIndex, resolveCasePatient } from "./paciente";

/** Fuente fija de las llaves en import_external_ids (idempotencia, ver llaveDeCaso). */
const FUENTE_CASOS = "ortho-casos";

/** ¿El error es "la tabla migrated_ortho_cases no existe todavía"? (SQL pendiente) */
function faltaLaTabla(e: unknown): boolean {
  const code = (e as any)?.code;
  return code === "P2021" || code === "P2022";
}

const pickInsertable = (rows: PreviewRow[], skipDuplicates: boolean) =>
  rows.filter((r) => r.status === "ok" || (!skipDuplicates && r.status === "duplicate"));

/** Estado tal como venía en el archivo → bucket normalizado. Nunca se pierde el texto original (ver statusRaw). */
function normalizeStatus(raw: string): "ACTIVE" | "COMPLETED" | "ON_HOLD" | "DROPPED_OUT" | "UNKNOWN" {
  const k = norm(raw);
  if (!k) return "UNKNOWN";
  if (/(activ|encurso|entratamiento|vigente|iniciad)/.test(k)) return "ACTIVE";
  if (/(termin|finaliz|complet|alta|concluid)/.test(k)) return "COMPLETED";
  if (/(pausa|suspend|detenid|standby|espera)/.test(k)) return "ON_HOLD";
  if (/(abandon|desercion|cancelad|baja)/.test(k)) return "DROPPED_OUT";
  return "UNKNOWN";
}

/**
 * Llave estable de un caso: la misma fila da la misma llave en cualquier
 * reintento. Con ID externo del caso (o del paciente, si el archivo trae uno
 * solo), esa. Sin él: paciente + técnica + fecha de colocación (o "sin
 * fecha") — un archivo tipo "11_Pacientes_Ortodoncia" trae normalmente UN
 * caso por paciente.
 */
function llaveDeCaso(o: { patientId: string; technique: string; installedAt: Date | null; externalId: string; origen: string }): string {
  if (o.externalId) return `id:${o.origen}:${o.externalId}`;
  const fecha = o.installedAt ? dayKey(calendarNoonUtc(o.installedAt)) : "sin-fecha";
  return `h:${o.patientId}|${norm(o.technique)}|${fecha}`;
}

function rowDbErrorMessage(e: any): string {
  if (e?.code === "P2003") return "No se pudo guardar: el paciente ya no existe";
  return "No se pudo guardar la fila (error de base de datos)";
}

export const orthoCasesHandler: EntityHandler = {
  entity: "orthoCases",
  auditEntityType: "record",
  sheetNames: ["pacientesortodoncia", "casosortodoncia", "ortodoncia", "ortodonciapacientes", "orthodonticpatients"],
  headerVariants: {
    name: ["nombre", "nombredelpaciente", "paciente", "nombrecompleto", "nombres", "cliente"],
    lastName: ["apellido", "apellidos", "lastname"],
    phone: ["telefono", "celular", "whatsapp", "phone", "movil"],
    email: ["email", "correo", "correoelectronico"],
    patientExternalId: ["idpaciente", "#paciente", "iddelpaciente", "idficha", "idfichapaciente", "codigopaciente", "nficha", "nroficha", "numeroficha", "numerodeficha"],
    // ID del CASO (no del paciente) en el sistema de origen, si lo trae.
    externalId: ["idcaso", "idtratamientoortodoncia", "idortodoncia", "idplandetratamiento", "idplanortodoncia"],
    technique: ["tecnica", "tipodetratamiento", "aparatologia", "sistema", "tipodebrackets", "aparato"],
    doctor: ["doctor", "doctora", "medico", "ortodoncista", "odontologo", "odontologa", "dentista", "profesional", "atiende", "tratante"],
    installedAt: ["fechacolocacion", "fechadecolocacion", "fechainicio", "fechadeinicio", "fechainiciotratamiento", "fechaactivacion", "fechadeactivacion"],
    status: ["estado", "estatus", "status", "situacion", "estadodeltratamiento", "estadocaso"],
    durationMonths: ["duracion", "duracionmeses", "duracionenmeses", "mesesestimados", "duracionestimada", "tiempoestimado", "tiempoestimadomeses"],
    totalAmount: ["preciototal", "totaltratamiento", "valortratamiento", "montotal", "preciodeltratamiento", "costototal", "total", "importetotal"],
    originInvoiceFolio: ["presupuesto", "npresupuesto", "numeropresupuesto", "folio", "idpresupuesto"],
  },

  validateMapping(campos) {
    if (!campos.has("phone") && !campos.has("email") && !campos.has("name") && !campos.has("patientExternalId")) {
      return "Falta una columna para identificar al paciente (ID, teléfono, correo o nombre)";
    }
    return null;
  },

  async process(rows: MappedRow[], clinicId: string, ctx: ImportContext): Promise<PreviewRow[]> {
    // Import dinámico a propósito (ws1-t12, pausa del gerente): @/lib/orthodontics/access
    // lleva `import "server-only"`, y un import estático lo cargaría con solo
    // importar este handler (p. ej. desde entities.ts para el registro/detección),
    // tumbando cualquier test que ni siquiera llegue a llamar process()/commit()
    // de casos de ortodoncia. Diferido a runtime, mismo criterio que doctores/handler.ts.
    const { hasActiveOrthodonticsModule } = await import("@/lib/orthodontics/access");
    const moduloActivo = await hasActiveOrthodonticsModule(clinicId);
    if (!moduloActivo) {
      return rows.map(({ row, mapped }) => ({
        row,
        data: {},
        status: "error" as const,
        errors: ["El módulo de Ortodoncia no está activo en esta clínica: actívalo en Configuración antes de importar estos casos"],
        warnings: [],
      }));
    }

    const idx = await loadPatientIndex(clinicId, { userId: ctx.userId, role: ctx.role, originId: ctx.originId });
    const origen = nombreOrigen(ctx.originName);

    // Doctor tratante (opcional): cualquier usuario de la clínica, activo o no
    // (mismo criterio que treatmentPlansHandler — puede ya no trabajar ahí).
    const users = await prisma.user.findMany({ where: { clinicId }, select: { id: true, firstName: true, lastName: true } });
    const byDoctor = new Map<string, string>();
    for (const u of users) {
      const key = norm(`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
      if (key && !byDoctor.has(key)) byDoctor.set(key, u.id);
    }

    // Modo de cobro de la clínica (default PRECIO_TOTAL, ver
    // orthodontics_clinic_settings.billingMode): un caso migrado solo trae un
    // total conocido, nunca el desglose por control — si la clínica cobra por
    // control se avisa, pero el caso se importa igual (es historia).
    let billingMode: string | null = null;
    try {
      const settings = await prisma.orthodonticsClinicSettings.findUnique({ where: { clinicId }, select: { billingMode: true } });
      billingMode = settings?.billingMode ?? null;
    } catch {
      billingMode = null;
    }
    const avisoModoCobro = billingMode === "PAGO_POR_CONTROL"
      ? "Esta clínica cobra por control (no por precio total); el caso migrado se importa igual, con el total conocido como dato informativo — no se desglosan controles porque el archivo no los trae"
      : null;

    const lector = crearLectorMontos(
      rows.map((r) => r.mapped.totalAmount),
      ctx.valueMapping[AMOUNT_FORMAT_FIELD]?.[AMOUNT_FORMAT_KEY],
    );

    // Lo ya importado: por llave (import_external_ids)…
    const externos = await cargarExternosOrthoCase(clinicId, FUENTE_CASOS);
    // …y, como red, contra lo que ya quedó en migrated_ortho_cases (tolera que la tabla aún no exista).
    const existentes = new Set<string>();
    try {
      const ya = await prisma.migratedOrthoCase.findMany({
        where: { clinicId },
        select: { patientId: true, technique: true, installedAt: true },
      });
      for (const c of ya) {
        const fecha = c.installedAt ? dayKey(calendarNoonUtc(c.installedAt)) : "sin-fecha";
        existentes.add(`h:${c.patientId}|${norm(c.technique ?? "")}|${fecha}`);
      }
    } catch (e) {
      if (!faltaLaTabla(e)) throw e;
    }

    const vecesEnArchivo = new Map<string, number>();
    const out: PreviewRow[] = [];

    for (const { row, mapped } of rows) {
      const pr: PreviewRow = { row, data: {}, status: "ok", errors: [], warnings: [] };

      const res = resolveCasePatient(mapped, idx);
      if (res.error) pr.errors.push(res.error);
      if (res.warning) pr.warnings.push(res.warning);

      const installedAt = mapped.installedAt && cellText(mapped.installedAt) ? parseDate(mapped.installedAt) : null;
      if (mapped.installedAt && cellText(mapped.installedAt) && !installedAt) {
        pr.errors.push(`Fecha de colocación "${cellText(mapped.installedAt)}" inválida`);
      }

      let durationMonths: number | null = null;
      if (cellText(mapped.durationMonths)) {
        const n = Number(String(mapped.durationMonths).replace(",", "."));
        if (Number.isFinite(n) && n > 0 && n <= 120) durationMonths = Math.round(n);
        else pr.errors.push(`Duración inválida "${cellText(mapped.durationMonths)}"`);
      }

      let totalAmount: number | null = null;
      if (cellText(mapped.totalAmount)) {
        const lectura = lector.leer(mapped.totalAmount);
        if (lectura.error) pr.errors.push(lectura.error);
        else if (lectura.pendiente) {
          pr.errors.push(`Monto ambiguo «${lectura.pendiente}»: puede ser de miles o con decimales. Confirma cómo se leen en la vista previa`);
          pr.unresolved = [{ field: AMOUNT_FORMAT_FIELD, key: AMOUNT_FORMAT_KEY, value: lectura.pendiente }];
        } else if (lectura.valor != null && lectura.valor < 0) pr.errors.push("El precio total no puede ser negativo");
        else totalAmount = lectura.valor;
        if (lectura.aviso) pr.warnings.push(lectura.aviso);
      }

      if (pr.errors.length > 0) { pr.status = "error"; out.push(pr); continue; }

      const technique = mapped.technique ? oneLine(mapped.technique, 120) : "";
      const statusRaw = mapped.status ? oneLine(mapped.status, 60) : "";
      const status = normalizeStatus(statusRaw);
      if (statusRaw && status === "UNKNOWN") {
        pr.warnings.push(`Estado "${statusRaw}" no se reconoció: se guarda tal cual, sin marcar activo/terminado/pausado/abandonado`);
      }

      let treatingDoctorId: string | undefined;
      const doctorNombre = mapped.doctor ? oneLine(mapped.doctor, 120) : "";
      if (doctorNombre) {
        treatingDoctorId = byDoctor.get(norm(doctorNombre));
        if (!treatingDoctorId) pr.warnings.push(`Doctor "${doctorNombre}" no encontrado como usuario de la clínica: se guarda solo el nombre`);
      }

      if (avisoModoCobro) pr.warnings.push(avisoModoCobro);

      // Un caso sin técnica, fecha, precio, doctor ni estado no es un caso: es una fila vacía (con un mapeo que no
      // era de este archivo salían «UNKNOWN» sin nada, I1 de la revisión final). Nunca se escribe a medias.
      if (!technique && !installedAt && (totalAmount === null || totalAmount === undefined) && !doctorNombre && !statusRaw) {
        pr.errors.push("La fila no trae técnica, fecha de colocación, precio, doctor ni estado: no hay nada que migrar");
        pr.status = "error";
        out.push(pr);
        continue;
      }

      const externalId = ctx.originId ? limpiarId(mapped.externalId) : "";
      const llave = llaveDeCaso({ patientId: res.id!, technique, installedAt, externalId, origen: ctx.originId });
      const n = (vecesEnArchivo.get(llave) ?? 0) + 1;
      vecesEnArchivo.set(llave, n);
      const llaveFinal = n > 1 ? `${llave}#${n}` : llave;

      pr.data = {
        patientId: res.id,
        name: res.fullName || (mapped.name ? String(mapped.name).trim() : undefined),
        technique: technique || null,
        treatingDoctorId: treatingDoctorId ?? null,
        treatingDoctorName: doctorNombre || null,
        status,
        statusRaw: statusRaw || null,
        installedAt,
        estimatedDurationMonths: durationMonths,
        totalAmount,
        originInvoiceFolio: mapped.originInvoiceFolio ? oneLine(mapped.originInvoiceFolio, 40) : null,
        origin: origen,
        key: llaveFinal,
      };

      const redKey = `h:${res.id}|${norm(technique)}|${installedAt ? dayKey(calendarNoonUtc(installedAt)) : "sin-fecha"}`;
      if (externos.mapa.has(llaveFinal) || existentes.has(redKey)) {
        pr.status = "skipped";
        pr.warnings.push("Este caso ya se importó antes");
      } else if (n > 1) {
        pr.status = "duplicate";
        pr.warnings.push("Fila repetida en el archivo (mismo paciente, técnica y fecha de colocación)");
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
      await prisma.migratedOrthoCase.count({ where: { clinicId } });
    } catch (e) {
      if (faltaLaTabla(e)) {
        throw new ImportError(
          409,
          "Falta aplicar el SQL de casos de ortodoncia (sql/ortodoncia-casos-migrados.sql) antes de importar",
          undefined,
          "MIGRATED_ORTHO_CASES_TABLE_MISSING",
        );
      }
      throw e;
    }

    for (const r of toInsert) r.data.newId = newRowId();

    let created = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const build = (rs: PreviewRow[]) => rs.map((r) => ({
        id: r.data.newId as string,
        clinicId,
        patientId: r.data.patientId as string,
        technique: (r.data.technique as string | null) ?? null,
        treatingDoctorId: (r.data.treatingDoctorId as string | null) ?? null,
        treatingDoctorName: (r.data.treatingDoctorName as string | null) ?? null,
        status: r.data.status as string,
        statusRaw: (r.data.statusRaw as string | null) ?? null,
        installedAt: (r.data.installedAt as Date | null) ?? null,
        estimatedDurationMonths: (r.data.estimatedDurationMonths as number | null) ?? null,
        totalAmount: (r.data.totalAmount as number | null) ?? null,
        originInvoiceFolio: (r.data.originInvoiceFolio as string | null) ?? null,
        origin: r.data.origin as string,
        createdById: ctx.userId,
      }));
      try {
        created += (await prisma.migratedOrthoCase.createMany({ data: build(slice), skipDuplicates: true })).count;
      } catch {
        // Error de DB en el bloque (p. ej. FK si borraron al paciente entre dry-run y commit):
        // NO abortamos el lote, aislamos fila por fila.
        for (const r of slice) {
          try {
            created += (await prisma.migratedOrthoCase.createMany({ data: build([r]), skipDuplicates: true })).count;
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
    if (pares.length > 0 && !(await guardarExternosOrthoCase(clinicId, FUENTE_CASOS, pares))) {
      console.warn("[import/ortho-cases] import_external_ids no existe: la idempotencia usa solo la red de siempre (falta aplicar sql/import-ids-externos.sql)");
    }

    const erroredNow = toInsert.filter((r) => r.status === "error").length;
    return { created, skipped: Math.max(0, toInsert.length - created - erroredNow) };
  },
};
