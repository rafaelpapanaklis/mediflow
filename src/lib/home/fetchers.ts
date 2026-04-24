// src/lib/home/fetchers.ts
import "server-only";
import { headers, cookies } from "next/headers";
import type {
  HomeReceptionistData,
  HomeDoctorData,
  HomeAdminData,
  AdminPeriod,
  HybridRoleCheck,
} from "./types";

function baseUrl(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function forwardCookies(): string {
  return cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

async function safeFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      headers: { Cookie: forwardCookies(), Accept: "application/json" },
      cache: "no-store",
    });
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
  return safeFetch("/api/dashboard/home/receptionist", EMPTY_RECEPTIONIST);
}

export function fetchDoctorData(): Promise<HomeDoctorData> {
  return safeFetch("/api/dashboard/home/doctor", EMPTY_DOCTOR);
}

export function fetchAdminData(period: AdminPeriod): Promise<HomeAdminData> {
  return safeFetch(
    `/api/dashboard/home/admin?period=${period}`,
    EMPTY_ADMIN(period),
  );
}

export function fetchHybridRoleCheck(): Promise<HybridRoleCheck> {
  return safeFetch("/api/dashboard/home/can-be-doctor", { canBeDoctor: false });
}
