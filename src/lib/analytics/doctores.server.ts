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

  // Citas por doctor (sin canceladas: ya vienen filtradas).
  const porDoctor = new Map<string, CitasDeDoctor & { inicios: Date[] }>();
  for (const c of citas) {
    if (!c.doctorId) continue;
    const g = porDoctor.get(c.doctorId) ?? { citas: 0, atendidas: 0, noAsistio: 0, inicios: [] };
    g.citas += 1;
    if ((ESTADOS_ATENDIDOS as readonly string[]).includes(c.status)) g.atendidas += 1;
    if (c.status === "NO_SHOW") g.noAsistio += 1;
    g.inicios.push(c.startsAt);
    porDoctor.set(c.doctorId, g);
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

  const sumar = (filas: Array<{ v: number | null; doctorId: string | null | undefined }>) => {
    const m = new Map<string, { s: number; n: number }>();
    for (const f of filas) {
      if (!f.doctorId || f.v == null) continue;
      const g = m.get(f.doctorId) ?? { s: 0, n: 0 };
      g.s += f.v;
      g.n += 1;
      m.set(f.doctorId, g);
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

  const sin = soloDoctorId ? null : ingresoSinDoctor(cobrado);
  if (sin) {
    filas.push({
      id: ID_SIN_DOCTOR,
      name: NOMBRE_SIN_DOCTOR,
      color: "",
      role: "",
      apptsTotal: 0,
      apptsCompleted: 0,
      apptsNoShow: 0,
      noShowRate: 0,
      apptsPerDay: 0,
      revenueGenerated: sin.total,
      revenueOrtho: sin.orto,
      avgSatisfaction: null,
      satisfactionCount: 0,
      avgConsultMin: null,
      sinDoctor: true,
    });
  }
  return filas;
}
