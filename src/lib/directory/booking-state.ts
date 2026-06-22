// ─────────────────────────────────────────────────────────────────────────────
// Estado de reserva del directorio: bus de eventos, URL ⇄ selección,
// sessionStorage y helpers de fecha/nombre. SOLO se importa desde componentes
// client; todas las funciones que tocan window están protegidas para SSR.
// Implementación COMPLETA — los agentes la consumen, no la modifican.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOOKING_OPEN_EVENT,
  BOOKING_PARAM_KEYS,
  BOOKING_STORAGE_KEY,
  PATIENT_ME_API,
  PATIENT_REGISTER_PATH,
  PATIENT_LOGIN_PATH,
  type BookingSelection,
  type DirectoryClinic,
  type DirectorySchedule,
  type PatientMe,
} from "./types";

// ── Bus de eventos: las cards piden abrir el popup sin prop-drilling ─────────

export function openBookingPopup(clinic: DirectoryClinic): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BOOKING_OPEN_EVENT, { detail: { clinic } }));
}

export function onBookingOpenRequest(cb: (clinic: DirectoryClinic) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const clinic = (e as CustomEvent).detail?.clinic as DirectoryClinic | undefined;
    if (clinic?.slug) cb(clinic);
  };
  window.addEventListener(BOOKING_OPEN_EVENT, handler);
  return () => window.removeEventListener(BOOKING_OPEN_EVENT, handler);
}

// ── URL ⇄ selección (merge: preserva q, page y demás params ajenos) ──────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

export function readSelectionFromUrl(): Partial<BookingSelection> | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const clinicSlug = sp.get(BOOKING_PARAM_KEYS.clinic);
  if (!clinicSlug) return null;
  const date = sp.get(BOOKING_PARAM_KEYS.date);
  const slot = sp.get(BOOKING_PARAM_KEYS.slot);
  return {
    clinicSlug,
    service: sp.get(BOOKING_PARAM_KEYS.service) || null,
    doctorId: sp.get(BOOKING_PARAM_KEYS.doctor) || null,
    date: date && YMD_RE.test(date) ? date : null,
    slot: slot && HHMM_RE.test(slot) ? slot : null,
  };
}

/** Escribe la selección en la URL actual sin recargar. `null` limpia las llaves. */
export function syncSelectionToUrl(sel: BookingSelection | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of Object.values(BOOKING_PARAM_KEYS)) url.searchParams.delete(key);
  if (sel) {
    url.searchParams.set(BOOKING_PARAM_KEYS.clinic, sel.clinicSlug);
    if (sel.service) url.searchParams.set(BOOKING_PARAM_KEYS.service, sel.service);
    if (sel.doctorId) url.searchParams.set(BOOKING_PARAM_KEYS.doctor, sel.doctorId);
    if (sel.date) url.searchParams.set(BOOKING_PARAM_KEYS.date, sel.date);
    if (sel.slot) url.searchParams.set(BOOKING_PARAM_KEYS.slot, sel.slot);
  }
  window.history.replaceState(null, "", url.toString());
}

// ── Respaldo en sessionStorage (por si el registro pierde el querystring) ────

interface StoredSelection extends BookingSelection {
  savedPath: string; // pathname donde se guardó — solo se restaura ahí
}

export function persistSelection(sel: BookingSelection): void {
  if (typeof window === "undefined") return;
  try {
    const rec: StoredSelection = { ...sel, savedPath: window.location.pathname };
    sessionStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(rec));
  } catch { /* storage lleno o bloqueado — el querystring sigue funcionando */ }
}

export function readPersistedSelection(): (Partial<BookingSelection> & { savedPath?: string }) | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOKING_STORAGE_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as StoredSelection;
    if (!rec?.clinicSlug) return null;
    return rec;
  } catch {
    return null;
  }
}

export function clearPersistedSelection(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(BOOKING_STORAGE_KEY); } catch { /* noop */ }
}

// ── Contrato de auth de pacientes (solo consumo — otra terminal lo provee) ───

/** 200 → PatientMe · 401/404/red caída → null (tratar como "sin sesión"). */
export async function fetchPatientMe(): Promise<PatientMe | null> {
  try {
    const res = await fetch(PATIENT_ME_API, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ? (data as PatientMe) : null;
  } catch {
    return null;
  }
}

/** URL de registro con ?next= apuntando a la URL ACTUAL (que ya lleva la selección). */
export function buildRegistroUrl(): string {
  if (typeof window === "undefined") return PATIENT_REGISTER_PATH;
  const next = window.location.pathname + window.location.search;
  return `${PATIENT_REGISTER_PATH}?next=${encodeURIComponent(next)}`;
}

/** URL de login con ?next= apuntando a la URL ACTUAL (que ya lleva la selección). */
export function buildLoginUrl(): string {
  if (typeof window === "undefined") return PATIENT_LOGIN_PATH;
  const next = window.location.pathname + window.location.search;
  return `${PATIENT_LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

// ── Paso derivado de la selección (el popup no persiste el paso) ─────────────

export function deriveStep(sel: Partial<BookingSelection>): 1 | 2 | 3 | 4 {
  if (!sel.service) return 1;
  if (!sel.doctorId) return 2;
  if (!sel.date || !sel.slot) return 3;
  return 4;
}

// ── Utilidades de fecha/nombre compartidas por el popup ──────────────────────

export const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Encabezados del calendario — el grid arranca en lunes (como los schedules). */
export const DAYS_SHORT_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** JS Date.getDay() (0=Dom) → índice de schedule (0=Lun … 6=Dom). */
export function scheduleDayIndex(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 6 : js - 1;
}

/** Día habilitado para reservar: schedule enabled y fecha hoy o futura. */
export function isDayEnabled(date: Date, schedules: DirectorySchedule[]): boolean {
  const sched = schedules.find((s) => s.dayOfWeek === scheduleDayIndex(date));
  if (!sched?.enabled) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

/** "2026-06-15" → "lunes, 15 de junio" (es-MX). */
export function formatDateEs(ymd: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", ...opts,
  });
}

/** "Ana María López" → { firstName: "Ana", lastName: "María López" }. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function cleanPhoneDigits(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}
