// Lecturas de la regla «con qué doctor nace la factura» (la regla y su porqué: doctor-de-factura.ts).
//
// Sin "server-only" a propósito: lo importan rutas y servicios que las pruebas cargan con tsx.
// El `clinicId` SIEMPRE lo pone quien llama, de la sesión; sin él no se consulta nada (un
// `clinicId: undefined` no filtraría).

import { prisma } from "@/lib/prisma";
import { ATIENDE_WHERE } from "@/lib/agenda/roles-que-atienden";
import { hoyEnZona, inicioDelDiaEnZona } from "@/lib/inventory/fecha-calendario";
import { diaSiguiente, elegirDoctorDeFactura, unicoDoctor, type DoctorDeFactura } from "./doctor-de-factura";

/** Los estados de un caso de ortodoncia que sigue vivo (el tratante sigue llevándolo). */
const CASO_VIVO = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"] as const;

export interface ArgsDoctorDeFactura {
  clinicId: string;
  patientId: string;
  /** Cita ligada a la factura, si la hay. */
  appointmentId?: string | null;
  /** Lo que pidió el cuerpo (ver `doctorPedido`): texto ya validado, `null` = «Sin asignar», `undefined` = heredar. */
  pedido?: string | null;
  /** Doctor de la nota clínica de la que sale la factura (se usa si no hay cita ligada). */
  autorDeNota?: string | null;
  /** Zona de la clínica, para saber qué es «hoy». */
  timezone?: string | null;
  now?: Date;
}

/**
 * El doctor con el que nace la factura. Solo hereda a quien sigue ATENDIENDO en la clínica
 * (`ATIENDE_WHERE`, la misma regla que valida el doctor elegido en POST /api/invoices y que llena
 * la lista de «Nueva factura»); si no, nace sin doctor.
 * Consultas: 1 (cita ligada) o hasta 4 (citas de hoy, planes en paralelo y la validación).
 */
export async function doctorDeFacturaNueva(args: ArgsDoctorDeFactura): Promise<DoctorDeFactura> {
  // El doctor es atribución para reportes: si su lectura falla, la factura nace sin doctor
  // (como antes) en vez de no nacer.
  try {
    return await leerDoctorDeFactura(args);
  } catch (err) {
    console.warn("[facturas] no se pudo heredar el doctor de la factura:", (err as Error)?.message ?? err);
    return { doctorId: null, origen: "ninguno" };
  }
}

async function leerDoctorDeFactura(args: ArgsDoctorDeFactura): Promise<DoctorDeFactura> {
  const { clinicId, patientId } = args;
  if (args.pedido !== undefined) return elegirDoctorDeFactura(args.pedido, {});
  if (!clinicId || !patientId) return { doctorId: null, origen: "ninguno" };

  let propuesta: DoctorDeFactura;
  if (args.appointmentId) {
    const cita = await prisma.appointment.findFirst({
      where: { id: args.appointmentId, clinicId },
      select: { doctorId: true },
    });
    propuesta = elegirDoctorDeFactura(undefined, { cita: cita?.doctorId ?? null });
  } else if (args.autorDeNota) {
    propuesta = elegirDoctorDeFactura(undefined, { nota: args.autorDeNota });
  } else {
    const hoy = hoyEnZona(args.timezone, args.now ?? new Date());
    const desde = inicioDelDiaEnZona(hoy, args.timezone);
    const hasta = inicioDelDiaEnZona(diaSiguiente(hoy), args.timezone);
    const citasDeHoy = desde && hasta
      ? await prisma.appointment.findMany({
          where: { clinicId, patientId, startsAt: { gte: desde, lt: hasta }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { doctorId: true },
          take: 20,
        })
      : [];
    if (unicoDoctor(citasDeHoy.map((c) => c.doctorId))) {
      propuesta = elegirDoctorDeFactura(undefined, { citasDeHoy: citasDeHoy.map((c) => c.doctorId) });
    } else if (citasDeHoy.length > 0) {
      // Hoy lo vieron dos doctores distintos: no se adivina con el plan.
      propuesta = { doctorId: null, origen: "ninguno" };
    } else {
      // El estado se filtra AQUÍ y no en el `where`: en la base real `treatment_plans.status` es
      // TEXT y Prisma lo compara como su enum (`text = "TreatmentStatus"`, error 42883). Lo cazó la
      // QA de ws1-t2 contra la clínica de prueba; leer el valor sí funciona.
      const [planes, casos] = await Promise.all([
        prisma.treatmentPlan.findMany({
          where: { clinicId, patientId },
          select: { doctorId: true, status: true },
          orderBy: { startDate: "desc" },
          take: 50,
        }),
        prisma.orthodonticTreatmentPlan.findMany({
          where: { clinicId, patientId, deletedAt: null, treatingDoctorId: { not: null } },
          select: { treatingDoctorId: true, status: true },
          take: 20,
        }),
      ]);
      const vivos = new Set<string>(CASO_VIVO);
      const pistasPlan = [
        ...planes.filter((p) => String(p.status) === "ACTIVE").map((p) => p.doctorId),
        ...casos.filter((c) => vivos.has(String(c.status))).map((c) => c.treatingDoctorId),
      ];
      // C-07: sin plan que lo diga, el doctor de cabecera del paciente.
      const cabecera = unicoDoctor(pistasPlan)
        ? null
        : (await prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { primaryDoctorId: true } }))?.primaryDoctorId ?? null;
      propuesta = elegirDoctorDeFactura(undefined, { planes: pistasPlan, cabecera });
    }
  }

  if (!propuesta.doctorId) return propuesta;
  const atiende = await prisma.user.findFirst({
    where: { id: propuesta.doctorId, clinicId, ...ATIENDE_WHERE },
    select: { id: true },
  });
  return atiende ? propuesta : { doctorId: null, origen: "ninguno" };
}
