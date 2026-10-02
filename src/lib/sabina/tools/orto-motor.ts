/**
 * El puente entre Sabina y el MOTOR REAL del módulo de Ortodoncia (ws1-t11).
 *
 * 🔴 AQUÍ NO SE CALCULA NADA. Cada número que Sabina dice de ortodoncia sale de
 * la misma función con la que el panel pinta su pantalla:
 *
 *   · el módulo contratado ....... `hasActiveOrthodonticsModule` + `decidirEntradaAlModulo`
 *                                   (el guardia `exigirModuloOrtodoncia`)
 *   · los casos y su dinero ....... `loadOrthoCases` → `cobranzaDelCasoUnificada`
 *   · Cobranza .................... `filasDeCobranza` + `resumenDeCobranza`
 *   · Tablero (lo del mes) ........ `loadOrthoTableroData`
 *   · Controles ................... `loadOrthoControles` → `controlesDeLaSemana`, `casosSinControl`
 *   · la ficha del caso ........... `loadOrthoData` + `adaptToOrthoRedesignViewModel`
 *                                   (fase, mes N de M, `resolveCurrentWire`),
 *                                   `buildHygieneTrend`/`detectHygieneWorsening`,
 *                                   `computeExpectedTray`/`compareTrayToExpected`,
 *                                   `historialDeControles`, `cargarCobranzaDelCaso`
 *
 * Lo único propio son tres lecturas que el panel hace dentro de funciones que
 * no se pueden llamar desde aquí (una server action con su sesión, y el
 * cargador entero de la ficha, que además firma fotos por POST y lee el
 * WhatsApp del paciente): las hojas de control, la secuencia de arcos y los
 * alineadores del caso. Van con el MISMO `where` que allí, más el `clinicId` de
 * la sesión, y por `dbDe(ctx)`: la rendija de solo lectura.
 *
 * ── POR QUÉ SE CARGA CON `import()` Y NO ARRIBA DEL ARCHIVO ────────────
 * Las herramientas entran a `engine-catalog.ts`, que lo importan el motor y una
 * docena de pruebas. Este archivo arrastra `server-only` (access.ts), el barrido
 * de cobranza por WhatsApp (`hoyEnZona`) y medio módulo de ortodoncia. Cargado
 * en diferido, solo lo paga la pregunta que de verdad es de ortodoncia.
 *
 * `clinicId`, el usuario y la zona horaria salen SIEMPRE del ctx (la sesión).
 * La visibilidad de paciente es la del panel: `visorDe(ctx)` a cada cargador.
 */

import { cookies } from "next/headers";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  decidirEntradaAlModulo,
  moduloActivoALaVista,
  vistaPreviaSinModulo,
} from "@/lib/orthodontics/contratar";
import { loadOrthoCases, loadOrthoTableroData, type OrthoTableroData } from "@/lib/orthodontics/tablero-data";
import { cargarFiltroSinPrueba } from "@/lib/patients/paciente-de-prueba-db";
import { loadOrthoControles, type OrthoControlesData } from "@/lib/orthodontics/controles-data";
import { casosSinControl, historialDeControles, type CasoSinControl } from "@/lib/orthodontics/controles-modulo";
import {
  filasDeCobranza,
  resumenDeCobranza,
  type FilaCobranza,
  type ResumenDeCobranza,
} from "@/lib/orthodontics/cobranza-modulo";
import { cargarCobranzaDelCaso } from "@/lib/orthodontics/cobranza-db";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import type { CobranzaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { loadOrthoData } from "@/lib/orthodontics/load-data";
import { adaptToOrthoRedesignViewModel, type AdapterInput } from "@/lib/orthodontics/redesign/adapter";
import { cargarNombreDeTecnica, type LectorRaw } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { cargarPlanDetalle, type LectorDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import { lineasDelPlan, type LineaDelPlan } from "@/lib/orthodontics/plan-detalle";
import { buildHygieneTrend, detectHygieneWorsening } from "@/lib/orthodontics/redesign/hygiene-trend";
import { compareTrayToExpected, computeExpectedTray } from "@/lib/orthodontics/alineadores/expected-tray";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { computeActiveCasesCount, type OrthoCaseSummary } from "@/lib/orthodontics/specialty-kpis";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { zonaValida } from "@/components/specialties/orthodontics/modulo/fechas";
import type { OrthoRedesignViewModel } from "@/components/specialties/orthodontics/redesign/types";
import { dbDe, tienePermiso, visorDe } from "./base";
import { PERMISO_ORTO, type EstadoModulo } from "./orto-comun";
import type { SabinaCtx } from "../tipos";

/** Lo mismo que miran los cargadores del módulo: tabla o columna que aún no existe en esta base. */
function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

async function tolerante<T>(leer: () => Promise<T>, siFalta: T): Promise<T> {
  try {
    return await leer();
  } catch (e) {
    if (esRelacionAusente(e)) return siFalta;
    throw e;
  }
}

/** La cookie de la vista previa «sin módulo». Fuera de una petición de Next no hay cookies: `null`. */
function cookieDeVistaPrevia(): string | null {
  try {
    return cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value ?? null;
  } catch {
    return null;
  }
}

/** La zona de la clínica, con la misma red que las páginas del módulo. */
export function zonaDe(ctx: SabinaCtx): string {
  return zonaValida(ctx.timezone);
}

/**
 * ¿Esta sede tiene el módulo? Es el guardia del panel (`exigirModuloOrtodoncia`)
 * sin el `redirect`: mismas funciones, misma vista previa (que solo puede QUITAR
 * el acceso y en producción se ignora) y misma decisión.
 */
export async function estadoDelModulo(ctx: SabinaCtx, ahora: Date = new Date()): Promise<EstadoModulo> {
  const esDental = ctx.clinicCategory === "DENTAL";
  if (!esDental) return "no_es_dental";
  const real = await hasActiveOrthodonticsModule(ctx.clinicId, ahora);
  const moduloActivo = moduloActivoALaVista(
    real,
    vistaPreviaSinModulo({ nodeEnv: process.env.NODE_ENV, cookie: cookieDeVistaPrevia() }),
  );
  const entrada = decidirEntradaAlModulo({ esDental, tienePermiso: tienePermiso(ctx, PERMISO_ORTO), moduloActivo });
  return entrada.tipo === "modulo" ? "activo" : "no_contratado";
}

/* ═══════════════════════════════════════════════════════════════════════
   LOS CASOS, LOS CONTROLES Y LA COBRANZA DEL MÓDULO
   ═══════════════════════════════════════════════════════════════════════ */

export interface CasosDelModulo {
  /** `computeActiveCasesCount`: el T1 del Tablero. */
  activos: number;
  porEstado: Record<string, number>;
  total: number;
}

/** Cuántos casos hay, por estado. Los mismos casos que la lista «Pacientes en tratamiento». */
export async function leerCasos(ctx: SabinaCtx, ahora: Date = new Date()): Promise<CasosDelModulo> {
  const { cases } = await loadOrthoCases(ctx.clinicId, zonaDe(ctx), visorDe(ctx), ahora);
  const porEstado: Record<string, number> = {};
  for (const c of cases) porEstado[c.status] = (porEstado[c.status] ?? 0) + 1;
  return { activos: computeActiveCasesCount(cases), porEstado, total: cases.length };
}

/** La pantalla «Controles / agenda», tal cual. */
export async function leerControles(ctx: SabinaCtx, ahora: Date = new Date()): Promise<OrthoControlesData> {
  return loadOrthoControles(ctx.clinicId, zonaDe(ctx), visorDe(ctx), ahora);
}

export interface CobranzaDelModulo {
  hoy: string;
  filas: FilaCobranza[];
  resumen: ResumenDeCobranza;
}

/** La pantalla «Cobranza de mensualidades», tal cual: mismas filas, mismo resumen. */
export async function leerCobranza(ctx: SabinaCtx, ahora: Date = new Date()): Promise<CobranzaDelModulo> {
  const zona = zonaDe(ctx);
  const { cases } = await loadOrthoCases(ctx.clinicId, zona, visorDe(ctx), ahora);
  const hoy = hoyEnZona(ahora, zona);
  const filas = filasDeCobranza(cases, hoy);
  return { hoy, filas, resumen: resumenDeCobranza(filas) };
}

/** El Tablero, tal cual: de aquí sale lo del mes (proyección T6, producción T4, vencido T3). */
export async function leerTablero(ctx: SabinaCtx, ahora: Date = new Date()): Promise<OrthoTableroData> {
  // ws1-t11 (11d): mismo filtro que la pantalla (sin «Pacientes de prueba / no contactar»).
  return loadOrthoTableroData(ctx.clinicId, zonaDe(ctx), visorDe(ctx), ahora, await cargarFiltroSinPrueba(ctx.clinicId));
}

/* ═══════════════════════════════════════════════════════════════════════
   EL CASO DE UN PACIENTE
   ═══════════════════════════════════════════════════════════════════════ */

/** Hasta dónde se mira atrás y adelante: las mismas ventanas que `controles-data.ts`. */
const DIAS_DE_HISTORIAL = 365;
const DIAS_DE_FUTURO = 180;

export interface CasoLeido {
  paciente: string;
  /** `null` = el paciente no tiene plan de tratamiento de ortodoncia. */
  caso: {
    planId: string;
    status: string;
    /** `monthCurrent` / `monthTotal` de la cabecera de la ficha. */
    mes: number;
    de: number;
    inicio: string | null;
    finEstimado: string | null;
  } | null;
  /** Tiene valoración (diagnóstico) aunque todavía no lleve plan. */
  tieneValoracion: boolean;
  clinico: {
    fase: OrthoRedesignViewModel["treatment"]["phase"];
    arco: OrthoRedesignViewModel["treatment"]["wireCurrent"];
    /** ws1-t12 (revisión en panel.108, fallo 4): el arco de cada arcada; tras cambiar solo uno son dos. */
    arcos?: OrthoRedesignViewModel["treatment"]["wiresCurrent"];
    /** El último control FIRMADO con higiene registrada. */
    higiene: { fecha: string; placaPct: number | null; gingivitis: string | null; manchasBlancas: boolean } | null;
    higieneEmpeora: string[];
    /**
     * ws1-t12 — el plan de tratamiento COMPLETO, en los renglones de la ficha (`lineasDelPlan`). Solo lectura.
     * Vacío = el caso no tiene plan completo.
     */
    plan: LineaDelPlan[];
    alineadores: {
      sistema: string | null;
      actual: number;
      total: number;
      esperado: number;
      /** `compareTrayToExpected`: negativo = va atrasado. */
      diferencia: number;
      estado: string;
      pasoDelUltimo: boolean;
    } | null;
  } | null;
  controles: {
    ultimo: Date | null;
    proximo: Date | null;
    /** Solo si el caso está activo y NO tiene control futuro (`casosSinControl`). */
    sinControl: CasoSinControl | null;
  } | null;
  cobranza: {
    /** La fila de la pantalla de Cobranza. `null` = caso CERRADO que ya no debe: la pantalla no lo lista. */
    fila: FilaCobranza | null;
    /** `false` = el caso no tiene factura ni plan de pagos: no hay nada que dar por saldado. */
    tienePlan: boolean;
    /** Contadas del resumen del motor, para el caso cerrado que no tiene fila. */
    cuotasPagadas: number;
    cuotasTotales: number;
    saldoAFavor: number;
  } | null;
}

/**
 * El caso de UN paciente. `null` = ese paciente no existe para quien pregunta
 * (otra clínica, restringido, archivado): lo decide `loadOrthoData`, igual que
 * en la ficha. `ver` dice qué partes se leen: las hojas, los arcos, los
 * alineadores, la agenda y la cobranza no se consultan sin su permiso. El
 * cargador de la ficha sí se corre entero (es una sola función), y de lo suyo
 * solo sale el plan, la fase y el nombre.
 */
export async function leerCaso(
  ctx: SabinaCtx,
  patientId: string,
  ver: { clinico: boolean; controles: boolean; cobranza: boolean },
  ahora: Date = new Date(),
): Promise<CasoLeido | null> {
  const zona = zonaDe(ctx);
  const clinicId = ctx.clinicId;
  const legacy = await loadOrthoData({ clinicId, patientId }, visorDe(ctx));
  if (!legacy) return null;

  const plan = legacy.plan;
  if (!plan) {
    return {
      paciente: legacy.patientName,
      caso: null,
      // Que exista una valoración es expediente: solo con el permiso clínico.
      tieneValoracion: ver.clinico && legacy.diagnosis !== null,
      clinico: null,
      controles: null,
      cobranza: null,
    };
  }

  const db = dbDe(ctx);

  // Las hojas de control y la secuencia de arcos: el mismo `where` que el
  // cargador de la ficha (`redesign/loader.ts`), más el clinicId de la sesión.
  const hojas = ver.clinico
    ? await tolerante(
        () =>
          db.orthoTreatmentCard.findMany({
            where: { treatmentPlanId: plan.id, clinicId, deletedAt: null },
            orderBy: { cardNumber: "asc" },
            include: { elastics: true, iprPoints: true, brokenBrackets: true },
          }),
        [],
      )
    : [];
  const arcos = ver.clinico
    ? await tolerante(
        () => db.orthoWireStep.findMany({ where: { treatmentPlanId: plan.id, clinicId }, orderBy: { orderIndex: "asc" } }),
        [],
      )
    : [];

  // El adaptador de la ficha: de aquí salen la fase, el «mes N de M» y el arco
  // actual (`resolveCurrentWire`: el último anotado en un control firmado).
  const vm = adaptToOrthoRedesignViewModel({
    legacy,
    wireSteps: arcos as AdapterInput["wireSteps"],
    treatmentCards: hojas as AdapterInput["treatmentCards"],
    attendancePct: 0,
    elasticsCompliancePct: 0,
    realInvoiceTotal: legacy.invoiceTotal,
    realInvoicePaid: legacy.invoicePaid,
    techniqueLabel: plan ? await cargarNombreDeTecnica(clinicId, plan.id, db as unknown as LectorRaw) : null,
  });

  let clinico: CasoLeido["clinico"] = null;
  if (ver.clinico) {
    const tendencia = buildHygieneTrend(vm.treatmentCards);
    const ultima = [...tendencia]
      .reverse()
      .find((p) => p.plaquePct !== null || p.gingivitis !== null || p.whiteSpots);
    const alerta = detectHygieneWorsening(tendencia);

    // Alineadores: la lectura de `getAlignerCase` (que es una server action con
    // su propia sesión) y sus mismas dos funciones.
    const al = await tolerante(
      () => db.orthodonticAligner.findFirst({ where: { treatmentPlanId: plan.id, clinicId, deletedAt: null } }),
      null,
    );
    let alineadores: NonNullable<CasoLeido["clinico"]>["alineadores"] = null;
    if (al) {
      const esperado = computeExpectedTray({
        startedAt: al.startedAt,
        totalTrays: al.totalTrays,
        changeIntervalDays: al.changeIntervalDays,
        today: ahora,
      });
      alineadores = {
        sistema: al.systemName ?? null,
        actual: al.currentTray,
        total: al.totalTrays,
        esperado: esperado.expectedTray,
        diferencia: compareTrayToExpected(al.currentTray, esperado.expectedTray).delta,
        estado: al.status,
        pasoDelUltimo: esperado.isPastLastTray,
      };
    }

    // ws1-t12: el plan de tratamiento completo (mismo lector que la ficha; sin la columna, sin renglones extra).
    const detallePlan = await cargarPlanDetalle(clinicId, plan.id, db as unknown as LectorDelPlan).catch(() => null);
    const planCompleto = detallePlan
      ? lineasDelPlan(
          {
            estimatedDurationMonths: plan.estimatedDurationMonths ?? null,
            anchorageType: plan.anchorageType ? String(plan.anchorageType) : null,
            extractionsRequired: Boolean(plan.extractionsRequired),
            extractionsTeethFdi: plan.extractionsTeethFdi ?? [],
          },
          detallePlan,
          0,
        ).filter((l) => l.clave !== "duracion" && l.clave !== "tads")
      : [];

    clinico = {
      plan: planCompleto,
      fase: vm.treatment.phase,
      arco: vm.treatment.wireCurrent,
      arcos: vm.treatment.wiresCurrent,
      higiene: ultima
        ? {
            // El día de la visita en la zona de la CLÍNICA: un control de las
            // 18:30 del día 5 en Ciudad de México ya es día 6 en UTC.
            fecha: hoyEnZona(new Date(ultima.visitDate), zona),
            placaPct: ultima.plaquePct,
            gingivitis: ultima.gingivitis,
            manchasBlancas: ultima.whiteSpots,
          }
        : null,
      higieneEmpeora: alerta.worsening ? alerta.reasons : [],
      alineadores,
    };
  }

  // Un caso con la forma que piden las funciones del módulo (`casosSinControl`,
  // `filasDeCobranza`): los mismos campos que arma `loadOrthoCases`.
  const comoCaso = (cobranza: CobranzaDelCaso | null): OrthoCaseSummary => ({
    planId: plan.id,
    patientId,
    patientName: legacy.patientName,
    treatingDoctorId: plan.treatingDoctorId ?? null,
    treatingDoctorName: null,
    status: plan.status,
    installedAt: plan.installedAt,
    estimatedDurationMonths: plan.estimatedDurationMonths,
    droppedOutAt: plan.droppedOutAt,
    statusUpdatedAt: plan.statusUpdatedAt,
    cobranza,
  });

  let controles: CasoLeido["controles"] = null;
  if (ver.controles) {
    // Los controles son citas de la Agenda (decisión 2). El paciente ya pasó
    // por la visibilidad en `loadOrthoData`.
    const citas = await db.appointment.findMany({
      where: {
        clinicId,
        patientId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: {
          gte: new Date(ahora.getTime() - DIAS_DE_HISTORIAL * 86_400_000),
          lte: new Date(ahora.getTime() + DIAS_DE_FUTURO * 86_400_000),
        },
      },
      select: { patientId: true, startsAt: true, status: true },
      orderBy: { startsAt: "asc" },
      take: 500,
    });
    // Una hoja registrada también es un control hecho (mismo `groupBy` que la pantalla).
    const grupos = await tolerante(
      () =>
        db.orthoTreatmentCard.groupBy({
          by: ["patientId"],
          where: { clinicId, patientId: { in: [patientId] }, visitDate: { lte: ahora } },
          _max: { visitDate: true },
        }),
      [],
    );
    const hojasHechas = grupos
      .filter((g: any) => g?._max?.visitDate)
      .map((g: any) => ({ patientId: g.patientId as string, visitDate: g._max.visitDate as Date }));

    const historial = historialDeControles(citas, ahora, hojasHechas, zona);
    // La próxima: el criterio de la ficha (`resolveNextRealAppointment`).
    const proxima = citas.find((c: any) => c.startsAt >= ahora && c.status !== "CANCELLED");
    const [sinControl] = casosSinControl([comoCaso(null)], historial, hoyEnZona(ahora, zona), zona);
    controles = {
      ultimo: historial.ultimoAtendido.get(patientId) ?? null,
      proximo: proxima?.startsAt ?? null,
      sinControl: sinControl ?? null,
    };
  }

  let cobranza: CasoLeido["cobranza"] = null;
  const saldoDelLibro = async (c: string, pac: string) => {
    try {
      return Math.max(0, Math.round((await getPatientCreditBalance(c, pac)) * 100) / 100);
    } catch {
      return 0;
    }
  };
  if (ver.cobranza) {
    const resumen = await cargarCobranzaDelCaso({ clinicId, patientId, treatmentPlanId: plan.id, zonaHoraria: zona, ahora });
    // La fila de la pantalla de Cobranza para ESTE caso. Un caso cerrado y sin
    // deuda no tiene fila: `filasDeCobranza` lo deja fuera.
    const [fila] = filasDeCobranza([comoCaso(resumen)], hoyEnZona(ahora, zona));
    const cuotasPagadas = resumen?.pagadas.length ?? 0;
    const cuotasTotales = cuotasPagadas + (resumen?.vencidas.length ?? 0) + (resumen?.proximas.length ?? 0);
    cobranza = {
      fila: fila ?? null,
      tienePlan: cuotasTotales > 0,
      cuotasPagadas,
      cuotasTotales,
      // ws1-t4: sin nada facturado el resumen es null, pero el saldo a favor del
      // paciente (su libro) sigue siendo el de su resumen: se lee aparte.
      saldoAFavor: resumen ? resumen.saldoAFavor : await saldoDelLibro(clinicId, patientId),
    };
  }

  return {
    paciente: legacy.patientName,
    caso: {
      planId: plan.id,
      status: plan.status,
      mes: vm.treatment.monthCurrent,
      de: vm.treatment.monthTotal,
      inicio: vm.treatment.startDate ? vm.treatment.startDate.slice(0, 10) : null,
      finEstimado: vm.treatment.estimatedEndDate ? vm.treatment.estimatedEndDate.slice(0, 10) : null,
    },
    tieneValoracion: ver.clinico && legacy.diagnosis !== null,
    clinico,
    controles,
    cobranza,
  };
}
