// GET /api/paciente/ortodoncia — Parte 8 «Alineadores y cumplimiento»
// (ws1-t8, ola 1, sep-2026). H14/H15: el paciente ve su caso de ortodoncia
// (si tiene uno) para marcar cumplimiento de elásticos y subir fotos de
// monitoreo. Mismo patrón que /api/paciente/documentos.
//
// ws1-t2 (Paciente y WhatsApp, W4) agregó `cobranza`/`proximoControl` de
// forma ADITIVA a esta misma ruta compartida — no toca aligner/compliance
// ni el flujo de subida de fotos, que siguen siendo de esta parte.
//
// ws1-t5 (ronda 6, revisión de lógica de uso) — también ADITIVO:
//   · 93: `patientName` + `mostrarNombre`: una cuenta con dos hijos veía dos
//     tarjetas iguales.
//   · 94: `avance` («Mes 2 de 18 · Alineación»), `ultimoControl`
//     (indicaciones y elásticos del último control FIRMADO — nunca la nota
//     clínica) y `calendario` de mensualidades.
//   · 95: `registro` dice si se le pregunta por elásticos/alineadores y con
//     qué palabras; «hoy» es el día de la CLÍNICA, no el de UTC.
//   · Mapa 16: un caso terminado, o de una clínica con el módulo apagado, se
//     puede LEER (`soloLectura`), sin registro diario ni fotos.
// Las decisiones viven en `src/lib/patient-portal/ortodoncia-portal.ts`.
//
// Nunca confía en un patientId/clinicId del cliente — sale de ctx.links.
// Si el paciente no tiene ningún caso de ortodoncia responde 200 con
// `cases: []` — no es un error.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { summarizeElasticsCompliance } from "@/lib/orthodontics/elastics/compliance";
import { cargarCobranzaDelCaso } from "@/lib/orthodontics/cobranza-db";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { activeOrthodonticsModuleClinicIds } from "@/lib/orthodontics/access";
import { sinApartadoVencido } from "@/lib/agenda/apartado";
import {
  avanceDelCaso,
  calendarioDeMensualidades,
  diaDeLaClinica,
  diaDelRegistro,
  estadoDelCasoParaPaciente,
  hayQueNombrarAlPaciente,
  inicioDeVentana,
  permisosDelCaso,
  porcentajeDeAvance,
  registroDiario,
  ultimoControlParaPaciente,
  type MensualidadParaPaciente,
  type UltimoControlParaPaciente,
} from "@/lib/patient-portal/ortodoncia-portal";

export const dynamic = "force-dynamic";

const VENTANA_DIAS = 14;

function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface PacienteOrtodonciaCobranza {
  cuotaDeHoyMxn: number | null;
  /** "YYYY-MM-DD" de la próxima cuota que aún no vence, o null. */
  proximoVencimiento: string | null;
  vencidoMxn: number;
  saldoTotalMxn: number;
}

export interface PacienteOrtodonciaCase {
  treatmentPlanId: string;
  clinicId: string;
  clinicName: string;
  /** IANA de la clínica: las fechas con hora se pintan en SU hora. */
  timezone: string;
  /** ws1-t5 (93) — de quién es el caso. */
  patientName: string;
  /** ws1-t5 (93) — true si la cuenta lleva a más de un paciente: hay que decir de quién es cada tarjeta. */
  mostrarNombre: boolean;
  /** ws1-t5 (mapa 16) — «En tratamiento», «En pausa», «Terminado»… */
  estado: string;
  /** ws1-t5 (mapa 16) — caso cerrado o módulo apagado: se lee, no se escribe. */
  soloLectura: boolean;
  /** ws1-t5 (mapa 16) — por qué es de solo lectura, dicho para el paciente. */
  avisoSoloLectura: string | null;
  /** ws1-t5 (94) — «Mes 2 de 18 · Alineación». */
  avance: { texto: string; porcentaje: number | null };
  /** ws1-t5 (94) — indicaciones y elásticos del último control firmado, o null. */
  ultimoControl: UltimoControlParaPaciente | null;
  /** ws1-t5 (94) — todas las mensualidades, en orden. Vacío = sin plan de pago. */
  calendario: MensualidadParaPaciente[];
  /** ws1-t5 (95) — si se le pregunta por el uso de hoy, y con qué palabras. */
  registro: { preguntar: boolean; pregunta: string };
  aligner: {
    currentTray: number;
    totalTrays: number;
    systemName: string | null;
  } | null;
  compliance: {
    windowDays: number;
    /** null = todavía no ha registrado ningún día (no se pinta un «0 %»). */
    compliancePct: number | null;
    isLow: boolean;
  };
  todayLogged: boolean;
  /** ws1-t2 (W4) — null = sin factura de tratamiento (nada que cobrar todavía). */
  cobranza: PacienteOrtodonciaCobranza | null;
  /** ws1-t2 (W4) — ISO de la próxima cita "Control de ortodoncia", o null. */
  proximoControl: string | null;
}

/** El último control FIRMADO. Tolera que `indications` aún no exista en esta base. */
async function cargarUltimoControl(treatmentPlanId: string, clinicId: string) {
  const where = { treatmentPlanId, clinicId, status: "SIGNED" as const, deletedAt: null };
  const elastics = { select: { elasticClass: true, config: true, zone: true } };
  try {
    return await prisma.orthoTreatmentCard.findFirst({
      where,
      orderBy: { visitDate: "desc" },
      select: { visitDate: true, indications: true, elastics },
    });
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  try {
    const hoja = await prisma.orthoTreatmentCard.findFirst({
      where,
      orderBy: { visitDate: "desc" },
      select: { visitDate: true, elastics },
    });
    return hoja ? { ...hoja, indications: null } : null;
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    return null;
  }
}

interface PlanDelPortal {
  id: string;
  clinicId: string;
  patientId: string;
  status: string;
  installedAt: Date | null;
  estimatedDurationMonths: number | null;
  clinic: { name: string; timezone: string };
  patient: { firstName: string; lastName: string };
  phases: Array<{ phaseKey: string; status: string; orderIndex: number }>;
}

async function armarCaso(
  plan: PlanDelPortal,
  args: { ahora: Date; mostrarNombre: boolean; moduloActivo: boolean },
): Promise<PacienteOrtodonciaCase> {
  const { ahora } = args;
  const zona = plan.clinic.timezone;
  const hoy = diaDeLaClinica(ahora, zona);
  const permisos = permisosDelCaso(plan.status, args.moduloActivo);

  let aligner: PacienteOrtodonciaCase["aligner"] = null;
  let estadoAlineador: string | null = null;
  let compliance: PacienteOrtodonciaCase["compliance"] = {
    windowDays: VENTANA_DIAS,
    compliancePct: null,
    isLow: false,
  };
  let todayLogged = false;

  try {
    const a = await prisma.orthodonticAligner.findFirst({
      where: { treatmentPlanId: plan.id, clinicId: plan.clinicId, deletedAt: null },
      select: { currentTray: true, totalTrays: true, systemName: true, status: true },
    });
    if (a) {
      aligner = { currentTray: a.currentTray, totalTrays: a.totalTrays, systemName: a.systemName };
      estadoAlineador = a.status;
    }
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  try {
    const logs = await prisma.orthodonticElasticsLog.findMany({
      where: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        // 14 días contando hoy, en el calendario de la clínica.
        logDate: { gte: inicioDeVentana(hoy, VENTANA_DIAS - 1) },
      },
      select: { logDate: true, wornHours: true, usedElastics: true },
    });
    const summary = summarizeElasticsCompliance(
      logs.map((l) => ({
        date: diaDelRegistro(l.logDate),
        wornHours: l.wornHours,
        usedElastics: l.usedElastics,
      })),
      { windowDays: VENTANA_DIAS, targetHoursPerDay: 20 },
    );
    if (summary.loggedDays > 0) {
      compliance = { windowDays: VENTANA_DIAS, compliancePct: summary.compliancePct, isLow: summary.isLow };
    }
    todayLogged = logs.some((l) => diaDelRegistro(l.logDate) === hoy);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  const hoja = await cargarUltimoControl(plan.id, plan.clinicId);
  const ultimoControl = ultimoControlParaPaciente(hoja, zona);

  // ws1-t2 (W4) — cobranza real (factura del tratamiento, decisión 1
  // de la arquitectura) y próximo control (Agenda, decisión 2).
  let cobranza: PacienteOrtodonciaCase["cobranza"] = null;
  let calendario: MensualidadParaPaciente[] = [];
  try {
    const resumen = await cargarCobranzaDelCaso({
      clinicId: plan.clinicId,
      patientId: plan.patientId,
      treatmentPlanId: plan.id,
      zonaHoraria: zona,
      ahora,
    });
    if (resumen) {
      cobranza = {
        cuotaDeHoyMxn: resumen.cuotaDeHoy ? Math.round(resumen.cuotaDeHoy.falta) : null,
        proximoVencimiento: resumen.proximoVencimiento,
        vencidoMxn: Math.round(resumen.vencidas.reduce((s, q) => s + q.falta, 0)),
        saldoTotalMxn: Math.round(resumen.saldoTotal),
      };
      calendario = calendarioDeMensualidades(resumen);
    }
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  let proximoControl: string | null = null;
  try {
    const cita = await prisma.appointment.findFirst({
      where: {
        clinicId: plan.clinicId,
        patientId: plan.patientId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: ahora },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        // Una cita apartada cuyo anticipo venció ya no es un control que anunciar.
        AND: [sinApartadoVencido(ahora)],
      },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    });
    proximoControl = cita?.startsAt.toISOString() ?? null;
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  const avance = avanceDelCaso({
    installedAt: plan.installedAt,
    estimatedDurationMonths: plan.estimatedDurationMonths,
    fases: plan.phases,
    ahora,
  });

  return {
    treatmentPlanId: plan.id,
    clinicId: plan.clinicId,
    clinicName: plan.clinic.name,
    timezone: zona,
    patientName: `${plan.patient.firstName} ${plan.patient.lastName}`.trim(),
    mostrarNombre: args.mostrarNombre,
    estado: estadoDelCasoParaPaciente(plan.status),
    soloLectura: permisos.soloLectura,
    avisoSoloLectura: permisos.aviso,
    avance: { texto: avance.texto, porcentaje: porcentajeDeAvance(avance) },
    ultimoControl,
    calendario,
    registro: registroDiario({
      estado: plan.status,
      soloLectura: permisos.soloLectura,
      elasticosVigentes: hoja?.elastics.length ?? 0,
      estadoAlineador,
    }),
    aligner,
    compliance,
    todayLogged,
    cobranza,
    proximoControl,
  };
}

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    // Multi-tenant: el caso tiene que ser del MISMO par paciente+clínica de
    // un vínculo de la sesión.
    const vinculos = ctx.links.filter((l) => l.patientId && l.clinicId);
    if (vinculos.length === 0) {
      return NextResponse.json({ cases: [] satisfies PacienteOrtodonciaCase[] });
    }

    const plans = await prisma.orthodonticTreatmentPlan.findMany({
      where: {
        deletedAt: null,
        // Un expediente dado de baja (p. ej. cancelación ARCO) no enseña su caso
        // en el portal, igual que ya no enseña sus citas.
        patient: { deletedAt: null },
        OR: vinculos.map((l) => ({ patientId: l.patientId, clinicId: l.clinicId })),
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        status: true,
        installedAt: true,
        estimatedDurationMonths: true,
        createdAt: true,
        clinic: { select: { name: true, timezone: true } },
        patient: { select: { firstName: true, lastName: true } },
        phases: { select: { phaseKey: true, status: true, orderIndex: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (plans.length === 0) {
      return NextResponse.json({ cases: [] satisfies PacienteOrtodonciaCase[] });
    }

    const ahora = new Date();
    const mostrarNombre = hayQueNombrarAlPaciente(vinculos);
    const clinicasConModulo = await activeOrthodonticsModuleClinicIds(plans.map((p) => p.clinicId), ahora);

    // Un caso tras otro, no todos a la vez: cada caso ya lanza hasta 4
    // consultas juntas al leer su cobranza, y el pooler se satura con 7.
    const cases: PacienteOrtodonciaCase[] = [];
    for (const plan of plans) {
      cases.push(
        await armarCaso(plan, {
          ahora,
          mostrarNombre,
          moduloActivo: clinicasConModulo.has(plan.clinicId),
        }),
      );
    }

    // Primero lo que el paciente usa a diario; los casos cerrados, al final.
    cases.sort((a, b) => Number(a.soloLectura) - Number(b.soloLectura));

    return NextResponse.json({ cases });
  } catch (err) {
    console.error("[paciente/ortodoncia] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
