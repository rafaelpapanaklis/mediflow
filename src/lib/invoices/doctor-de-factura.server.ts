// Lecturas de la regla «con qué doctor nace la factura» (la regla y su porqué: doctor-de-factura.ts).
//
// Sin "server-only" a propósito: lo importan rutas y servicios que las pruebas cargan con tsx.
// El `clinicId` SIEMPRE lo pone quien llama, de la sesión; sin él no se consulta nada (un
// `clinicId: undefined` no filtraría).

import { prisma } from "@/lib/prisma";
import { conPuntoDeGuardado, type ClienteDb } from "@/lib/db/punto-de-guardado";
import { ATIENDE_WHERE } from "@/lib/agenda/roles-que-atienden";
import { hoyEnZona, inicioDelDiaEnZona } from "@/lib/inventory/fecha-calendario";
import { diaSiguiente, elegirDoctorDeFactura, unicoDoctor, type DoctorDeFactura } from "./doctor-de-factura";

/** Los estados de un caso de ortodoncia que sigue vivo (el tratante sigue llevándolo). */
const CASO_VIVO = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"] as const;
/** ws1-t11 — una cita en estos estados ya se atendió (o se cerró): su «Sin doctor» ya no va a cambiar solo. */
const CITA_YA_ATENDIDA = new Set(["COMPLETED", "CHECKED_OUT"]);

export interface ArgsDoctorDeFactura {
  clinicId: string;
  patientId: string;
  /** Cita ligada a la factura, si la hay. */
  appointmentId?: string | null;
  /** Lo que pidió el cuerpo (ver `doctorPedido`): texto ya validado, `null` = «Sin asignar», `undefined` = heredar. */
  pedido?: string | null;
  /** Doctor de la nota clínica de la que sale la factura (se usa si no hay cita ligada o si es «Sin doctor»). */
  autorDeNota?: string | null;
  /** Zona de la clínica, para saber qué es «hoy». */
  timezone?: string | null;
  now?: Date;
}

/**
 * El doctor con el que nace la factura. Solo hereda a quien sigue ATENDIENDO en la clínica
 * (`ATIENDE_WHERE`, la misma regla que valida el doctor elegido en POST /api/invoices y que llena
 * la lista de «Nueva factura»); si no, nace sin doctor.
 * Consultas: 1 (cita ligada) o hasta 4 (citas de hoy, planes en paralelo y la validación); con una
 * cita «Sin doctor», esa más las de las demás pistas. Nunca cae a quien pulsa Guardar.
 */
export async function doctorDeFacturaNueva(
  args: ArgsDoctorDeFactura,
  // ws1-t11 v4: el `tx` de quien llama, si está en una transacción. El punto de guardado hace que un
  // fallo de esta lectura (que aquí se traga a propósito) no deje abortada esa transacción.
  db: ClienteDb = prisma,
): Promise<DoctorDeFactura> {
  // El doctor es atribución para reportes: si su lectura falla, la factura nace sin doctor
  // (como antes) en vez de no nacer.
  try {
    return await conPuntoDeGuardado(db, () => leerDoctorDeFactura(args, db));
  } catch (err) {
    console.warn("[facturas] no se pudo heredar el doctor de la factura:", (err as Error)?.message ?? err);
    return { doctorId: null, origen: "ninguno" };
  }
}

async function leerDoctorDeFactura(args: ArgsDoctorDeFactura, db: ClienteDb): Promise<DoctorDeFactura> {
  const { clinicId, patientId } = args;
  if (args.pedido !== undefined) return elegirDoctorDeFactura(args.pedido, {});
  if (!clinicId || !patientId) return { doctorId: null, origen: "ninguno" };

  let propuesta: DoctorDeFactura | null = null;
  /** El día cuyas citas cuentan como «de hoy»: hoy, o el de la cita ligada «Sin doctor» ya atendida. */
  let diaDeReferencia: Date = args.now ?? new Date();
  if (args.appointmentId) {
    const cita = await db.appointment.findFirst({
      // La cita tiene que ser del MISMO paciente (doctor-sugerido la recibe del cliente).
      where: { id: args.appointmentId, clinicId, patientId },
      select: { doctorId: true, status: true, startsAt: true },
    });
    // Una cita que no es de este paciente (o no existe) no da pista ni deja seguir: nace sin doctor.
    if (!cita) return { doctorId: null, origen: "ninguno" };
    if (cita.doctorId) {
      propuesta = elegirDoctorDeFactura(undefined, { cita: cita.doctorId });
    } else if (!CITA_YA_ATENDIDA.has(String(cita.status))) {
      // ws1-t11 · P2 (revisión): una «Sin doctor» que todavía no se atiende (anticipo, cobro antes de la
      // consulta) NO adivina doctor: la factura nace sin él y los reportes siguen al doctor de la cita, que
      // se le pone al llegar o al iniciar. Adivinar aquí dejaba el cobro a nombre de otro para siempre.
      // La nota (si la hay) sí dice quién atendió.
      return args.autorDeNota
        ? elegirDoctorDeFactura(undefined, { nota: args.autorDeNota })
        : { doctorId: null, origen: "ninguno" };
    } else {
      // Ya atendida y «Sin doctor» (se terminó sin consulta): las demás pistas, con las citas del DÍA DE LA
      // CITA, no las de hoy (cobrar mañana la de ayer no puede tomar al doctor de otra visita).
      diaDeReferencia = cita.startsAt;
    }
  }
  if (!propuesta && args.autorDeNota) {
    propuesta = elegirDoctorDeFactura(undefined, { nota: args.autorDeNota });
  }
  if (!propuesta) {
    const hoy = hoyEnZona(args.timezone, diaDeReferencia);
    const desde = inicioDelDiaEnZona(hoy, args.timezone);
    const hasta = inicioDelDiaEnZona(diaSiguiente(hoy), args.timezone);
    const citasDeHoy = desde && hasta
      ? await db.appointment.findMany({
          where: { clinicId, patientId, startsAt: { gte: desde, lt: hasta }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { doctorId: true },
          take: 20,
        })
      : [];
    // Las «Sin doctor» de hoy (la propia cita ligada, p. ej.) no dicen quién atendió: no cuentan.
    const doctoresDeHoy = citasDeHoy.map((c) => c.doctorId).filter((id): id is string => !!id);
    if (unicoDoctor(doctoresDeHoy)) {
      propuesta = elegirDoctorDeFactura(undefined, { citasDeHoy: doctoresDeHoy });
    } else if (doctoresDeHoy.length > 0) {
      // Hoy lo vieron dos doctores distintos: no se adivina con el plan.
      propuesta = { doctorId: null, origen: "ninguno" };
    } else {
      // El estado se filtra AQUÍ y no en el `where`: en la base real `treatment_plans.status` es
      // TEXT y Prisma lo compara como su enum (`text = "TreatmentStatus"`, error 42883). Lo cazó la
      // QA de ws1-t2 contra la clínica de prueba; leer el valor sí funciona.
      const [planes, casos] = await Promise.all([
        db.treatmentPlan.findMany({
          where: { clinicId, patientId },
          select: { doctorId: true, status: true },
          orderBy: { startDate: "desc" },
          take: 50,
        }),
        db.orthodonticTreatmentPlan.findMany({
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
        : (await db.patient.findFirst({ where: { id: patientId, clinicId }, select: { primaryDoctorId: true } }))?.primaryDoctorId ?? null;
      propuesta = elegirDoctorDeFactura(undefined, { planes: pistasPlan, cabecera });
    }
  }

  if (!propuesta.doctorId) return propuesta;
  const atiende = await db.user.findFirst({
    where: { id: propuesta.doctorId, clinicId, ...ATIENDE_WHERE },
    select: { id: true },
  });
  return atiende ? propuesta : { doctorId: null, origen: "ninguno" };
}
