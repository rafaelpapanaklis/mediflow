// src/lib/home/fetchers.ts
import "server-only";
import { NextRequest } from "next/server";
import { GET as getAdminHome } from "@/app/api/dashboard/home/admin/route";
import { GET as getDoctorHome } from "@/app/api/dashboard/home/doctor/route";
import { GET as getReceptionistHome } from "@/app/api/dashboard/home/receptionist/route";
import type {
  HomeReceptionistData,
  HomeDoctorData,
  HomeAdminData,
  AdminPeriod,
  HybridRoleCheck,
} from "./types";

// Antes estos fetchers hacían fetch HTTP a la PROPIA app (self-invoke): cada
// home server-side pagaba una invocación serverless extra + re-auth completa
// (supabase.auth.getUser + lookup Prisma) por endpoint. Ahora invocan el
// handler GET de la ruta en el mismo proceso: loadClinicSession dentro del
// handler reusa el getCurrentUser memoizado por request (React cache() en
// lib/auth), y el resultado se sigue consumiendo vía res.json() para
// conservar el shape serializado (fechas como string) que esperan los
// componentes. El contrato no cambia: status !ok o throw → fallback vacío.
async function callRoute<T>(
  run: () => Promise<Response>,
  fallback: T,
): Promise<T> {
  try {
    const res = await run();
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_RECEPTIONIST: HomeReceptionistData = {
  todayAppointments: [],
  actionItems: [],
  waitlist: [],
  checkedInPatients: [],
};

const EMPTY_DOCTOR: HomeDoctorData = {
  nextAppointment: null,
  todayAppointments: [],
  pendingTasks: { draftNotes: 0, unanalyzedXrays: 0, unsignedConsents: 0 },
  recentPatients: [],
  completedToday: 0,
};

const EMPTY_ADMIN = (period: AdminPeriod): HomeAdminData => ({
  period,
  kpis: [],
  revenueSeries: [],
  alerts: [],
  team: [],
});

export function fetchReceptionistData(): Promise<HomeReceptionistData> {
  return callRoute(() => getReceptionistHome(), EMPTY_RECEPTIONIST);
}

export function fetchDoctorData(): Promise<HomeDoctorData> {
  return callRoute(() => getDoctorHome(), EMPTY_DOCTOR);
}

export function fetchAdminData(period: AdminPeriod): Promise<HomeAdminData> {
  return callRoute(
    () =>
      getAdminHome(
        new NextRequest(
          `http://mediflow.internal/api/dashboard/home/admin?period=${period}`,
        ),
      ),
    EMPTY_ADMIN(period),
  );
}

// El endpoint /api/dashboard/home/can-be-doctor NUNCA se implementó: el
// fetch anterior 404eaba siempre y devolvía este mismo fallback tras pagar
// un roundtrip HTTP completo. Se devuelve directo hasta que exista la
// lógica real del toggle híbrido admin/doctor.
export async function fetchHybridRoleCheck(): Promise<HybridRoleCheck> {
  return { canBeDoctor: false };
}
