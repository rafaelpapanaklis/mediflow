// ═══════════════════════════════════════════════════════════════════════════
// Las filas de Analítica › Doctores y del PDF de nómina (ws1-t2, auditoría de
// uso C-10 y C-11). UNA función para las dos: antes cada ruta repetía el
// cálculo, contaba las citas a su modo (con canceladas, hasta «ahora») y
// lanzaba tres consultas POR DOCTOR en paralelo (~75 con 25 doctores, contra la
// regla del pooler). Ahora son cuatro consultas fijas como mucho:
//   · quién atiende (ATIENDE_WHERE) y, aparte, quien cobró o tuvo citas sin
//     estar en esa lista;
//   · citas del periodo con la definición única (`citasDelPeriodoWhere`);
//   · encuestas y tiempos de consulta de esas citas;
//   · lo cobrado por doctor (`ingresosPorDoctorDelPeriodo`), con «Sin doctor».
// Así la columna «Citas» suma las citas del periodo (88 = Inicio) y la de
// «Ingresos» suma los ingresos (= Finanzas).
// `clinicId` SIEMPRE de la sesión; sin él no se consulta.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { ingresosPorDoctorDelPeriodo } from "@/lib/dinero/ingresos.server";
import { ID_SIN_DOCTOR, NOMBRE_SIN_DOCTOR, idsConIngresoFueraDeLista, ingresoSinDoctor } from "@/lib/dinero/por-doctor";
import { citasDelPeriodoWhere } from "@/lib/agenda/citas-del-periodo";
import { ESTADOS_ATENDIDOS, diasConCitas, idsConCitasFueraDeLista, type CitasDeDoctor } from "@/lib/agenda/citas-por-doctor";
import { ATIENDE_WHERE } from "@/lib/agenda/roles-que-atienden";

export interface FilaDeDoctor {
  id: string;
  name: string;
  color: string;
  /** Rol de la base («» en la fila «Sin doctor»). */
  role: string;
  apptsTotal: number;
  apptsCompleted: number;
  apptsNoShow: number;
  noShowRate: number;
  apptsPerDay: number;
  revenueGenerated: number;
  /** De `revenueGenerated`, lo de facturas de casos de ortodoncia (la misma cifra que Finanzas › Ortodoncia). */
  revenueOrtho: number;
  avgSatisfaction: number | null;
  satisfactionCount: number;
  avgConsultMin: number | null;
  sinDoctor?: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function filasDeDoctores(
  clinicId: string,
  ventana: { desde: Date; hasta: Date },
  zona: string,
  soloDoctorId?: string | null,
): Promise<FilaDeDoctor[]> {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  const { desde, hasta } = ventana;
  const citasWhere = { ...citasDelPeriodoWhere(clinicId, desde, hasta), ...(soloDoctorId ? { doctorId: soloDoctorId } : {}) };

  const [activos, citas, cobrado] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId, ...ATIENDE_WHERE, ...(soloDoctorId ? { id: soloDoctorId } : {}) },
      select: { id: true, firstName: true, lastName: true, color: true, role: true },
    }),
    prisma.appointment.findMany({ where: citasWhere, select: { doctorId: true, status: true, startsAt: true } }),
    ingresosPorDoctorDelPeriodo(clinicId, { gte: desde, lt: hasta }),
  ]);
  const [encuestas, tiempos] = await Promise.all([
    prisma.patientSatisfaction.findMany({
      where: { appointment: citasWhere },
      select: { score: true, appointment: { select: { doctorId: true } } },
    }),
    prisma.appointmentTimeline.findMany({
      where: { appointment: citasWhere, totalConsultMin: { not: null } },
      select: { totalConsultMin: true, appointment: { select: { doctorId: true } } },
    }),
  ]);

  // Citas por doctor (sin canceladas: ya vienen filtradas). Las «Sin doctor» (ws1-t11 · P2) van
  // a su propia cuenta, para la fila «Sin doctor»: sin ella la columna no sumaba las del periodo.
  const porDoctor = new Map<string, CitasDeDoctor & { inicios: Date[] }>();
  const citasSin: CitasDeDoctor & { inicios: Date[] } = { citas: 0, atendidas: 0, noAsistio: 0, inicios: [] };
  for (const c of citas) {
    const g = c.doctorId ? porDoctor.get(c.doctorId) ?? { citas: 0, atendidas: 0, noAsistio: 0, inicios: [] } : citasSin;
    g.citas += 1;
    if ((ESTADOS_ATENDIDOS as readonly string[]).includes(c.status)) g.atendidas += 1;
    if (c.status === "NO_SHOW") g.noAsistio += 1;
    g.inicios.push(c.startsAt);
    if (c.doctorId) porDoctor.set(c.doctorId, g);
  }

  // Quien cobró o tuvo citas sin estar en la lista también sale (solo de esta clínica).
  const ids = activos.map((d) => d.id);
  const fuera = soloDoctorId
    ? []
    : Array.from(new Set([...idsConIngresoFueraDeLista(ids, cobrado), ...idsConCitasFueraDeLista(ids, porDoctor)]));
  const personas = fuera.length > 0
    ? [
        ...activos,
        ...(await prisma.user.findMany({
          where: { clinicId, id: { in: fuera } },
          select: { id: true, firstName: true, lastName: true, color: true, role: true },
        })),
      ]
    : activos;

  // Encuestas y tiempos por doctor; los de citas «Sin doctor» quedan bajo ID_SIN_DOCTOR (no es
  // un id de usuario: tiene otra forma que un cuid o un uuid).
  const sumar = (filas: Array<{ v: number | null; doctorId: string | null | undefined }>) => {
    const m = new Map<string, { s: number; n: number }>();
    for (const f of filas) {
      if (f.v == null) continue;
      const clave = f.doctorId || ID_SIN_DOCTOR;
      const g = m.get(clave) ?? { s: 0, n: 0 };
      g.s += f.v;
      g.n += 1;
      m.set(clave, g);
    }
    return m;
  };
  const sat = sumar(encuestas.map((e) => ({ v: e.score, doctorId: e.appointment?.doctorId })));
  const consulta = sumar(tiempos.map((t) => ({ v: t.totalConsultMin, doctorId: t.appointment?.doctorId })));

  const filas: FilaDeDoctor[] = personas.map((d) => {
    const c = porDoctor.get(d.id);
    const total = c?.citas ?? 0;
    const dias = c ? diasConCitas(c.inicios, zona) : 0;
    const s = sat.get(d.id);
    const t = consulta.get(d.id);
    return {
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      color: d.color ?? "",
      role: String(d.role),
      apptsTotal: total,
      apptsCompleted: c?.atendidas ?? 0,
      apptsNoShow: c?.noAsistio ?? 0,
      noShowRate: total > 0 ? r1(((c?.noAsistio ?? 0) / total) * 100) : 0,
      apptsPerDay: dias > 0 ? r1(total / dias) : 0,
      revenueGenerated: cobrado.get(d.id)?.total ?? 0,
      revenueOrtho: cobrado.get(d.id)?.orto ?? 0,
      avgSatisfaction: s && s.n > 0 ? r1(s.s / s.n) : null,
      satisfactionCount: s?.n ?? 0,
      avgConsultMin: t && t.n > 0 ? Math.round(t.s / t.n) : null,
    };
  });
  filas.sort((a, b) => b.revenueGenerated - a.revenueGenerated || b.apptsTotal - a.apptsTotal);

  // La fila «Sin doctor»: lo cobrado que no es de nadie y las citas «Sin doctor» del periodo.
  // Con `soloDoctorId` (un DOCTOR viendo lo suyo) no sale: ya viene filtrado a sus citas.
  const sin = soloDoctorId ? null : ingresoSinDoctor(cobrado);
  if (!soloDoctorId && (sin || citasSin.citas > 0)) {
    const total = citasSin.citas;
    const dias = total > 0 ? diasConCitas(citasSin.inicios, zona) : 0;
    const s = sat.get(ID_SIN_DOCTOR);
    const t = consulta.get(ID_SIN_DOCTOR);
    filas.push({
      id: ID_SIN_DOCTOR,
      name: NOMBRE_SIN_DOCTOR,
      color: "",
      role: "",
      apptsTotal: total,
      apptsCompleted: citasSin.atendidas,
      apptsNoShow: citasSin.noAsistio,
      noShowRate: total > 0 ? r1((citasSin.noAsistio / total) * 100) : 0,
      apptsPerDay: dias > 0 ? r1(total / dias) : 0,
      revenueGenerated: sin?.total ?? 0,
      revenueOrtho: sin?.orto ?? 0,
      avgSatisfaction: s && s.n > 0 ? r1(s.s / s.n) : null,
      satisfactionCount: s?.n ?? 0,
      avgConsultMin: t && t.n > 0 ? Math.round(t.s / t.n) : null,
      sinDoctor: true,
    });
  }
  return filas;
}
