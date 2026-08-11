"use client";
/* ============================================================
   EL flujo de reserva. Uno solo.

   Antes vivía copiado en cuatro archivos —_shared/booking-modal.tsx,
   landing-client.tsx (classic), reservar/[slug]/booking-client.tsx y
   components/directory/BookingSchedule.tsx— y cada arreglo había que
   hacerlo cuatro veces (o se hacía en tres). Aquí está una vez y lo
   consumen las ocho plantillas, /reservar y el directorio.

   Pasos: doctor → fecha → hora → procedimiento → identificarse.
   Los que no aplican se saltan solos (un solo doctor, servicio ya
   elegido desde el botón de un servicio, sesión ya iniciada).

   DOS SALIDAS en el último paso, ambas visibles desde el principio:
     · con cuenta  → POST /api/public/book        → CITA real
     · sin cuenta  → POST /api/public/booking-request → SOLICITUD
   La segunda no agenda nada: la clínica la confirma desde el panel.

   Piel: `surface` ("light" | "dark") da la base y TODO el acento sale
   de `theme` (landingThemeColor) con tint/shade/alpha. Ninguna plantilla
   necesita tocar este archivo para verse suya.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Calendar, Check, ChevronLeft, ChevronRight, Clock,
  Loader2, LogIn, MessageCircle, Phone, Send, UserPlus, Users, X,
} from "lucide-react";
import { alpha, shade } from "./landing-utils";
import {
  BOOKING_AUTH_COPY,
  bookingPhoneExit,
  currentBookingNext,
  patientAuthHref,
  pendingSlotOutcome,
  requiresPatientAuth,
  savePendingBooking,
  slotTakenNotice,
  splitFullName,
  usePatientSession,
  type PendingBooking,
} from "@/lib/patient-portal/booking-auth";

/* ---------- contrato de datos (superset de las cuatro superficies) ---------- */

/** Sentinela de "cualquier disponible". Lo entienden availability y book. */
export const ANY_DOCTOR = "any";

export interface BookingFlowDoctor {
  id: string;
  firstName: string;
  lastName: string;
  specialty?: string | null;
  color?: string | null;
  avatarUrl?: string | null;
  services?: string[];
}

export interface BookingFlowService {
  name: string;
  /** Texto libre tal como lo escribe la clínica ("Desde $1,200"). */
  price?: string | null;
  durationMin?: number | null;
  icon?: string | null;
}

export interface BookingFlowSchedule {
  dayOfWeek: number; // 0 = lunes … 6 = domingo
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

export interface BookingFlowClinic {
  name: string;
  slug: string;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  doctors: BookingFlowDoctor[];
  schedules: BookingFlowSchedule[];
  services: BookingFlowService[];
}

/**
 * `landingServices` es JSON libre escrito por la clínica. Se normaliza aquí,
 * una sola vez, para que el flujo reciba siempre la misma forma sin importar
 * qué superficie lo monte. `durationMin` vive DENTRO de ese JSON (no es
 * columna) — ver sql/landing-v2.sql.
 */
export function normalizeServices(raw: unknown): BookingFlowService[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const lista: BookingFlowService[] = [];
  for (const s of raw) {
    const name = typeof (s as any)?.name === "string"
      ? (s as any).name.trim()
      : typeof s === "string" ? s.trim() : "";
    if (!name || vistos.has(name.toLowerCase())) continue;
    vistos.add(name.toLowerCase());
    const price = typeof (s as any)?.price === "string" ? (s as any).price.trim() : "";
    const icon = typeof (s as any)?.icon === "string" ? (s as any).icon.trim() : "";
    const dur = Number((s as any)?.durationMin);
    lista.push({
      name,
      price: price || null,
      durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
      icon: icon || null,
    });
  }
  return lista;
}

export interface BookingFlowSelection {
  doctorId: string | null;
  service: string | null;
  date: string | null;
  slot: string | null;
}

export interface BookingFlowProps {
  clinic: BookingFlowClinic;
  /** Acento. De aquí sale TODO el color del flujo. */
  theme: string;
  surface?: "light" | "dark";
  /** false pausa el GET de sesión (el modal cerrado no pregunta nada). */
  active?: boolean;
  preselectedDoctorId?: string | null;
  preselectedService?: string | null;
  /** Hueco guardado antes de irse al login. */
  restore?: PendingBooking | null;
  /** ?next= de vuelta a ESTA reserva. Por defecto, la URL actual. */
  nextPath?: string;
  onClose?: () => void;
  onBooked?: () => void;
  /** Cada cambio de selección — el directorio la persiste en URL + storage. */
  onSelectionChange?: (sel: BookingFlowSelection) => void;
  /** El contenedor pinta el título del paso (modal) en vez del flujo. */
  onStepChange?: (info: { title: string; index: number; total: number; done: boolean }) => void;
}

/* ---------- utilidades locales ---------- */

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_SHORT = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

type StepId = "doctor" | "date" | "time" | "service" | "identify";

const STEP_TITLE: Record<StepId, string> = {
  doctor:   "Elige tu doctor",
  date:     "Elige el día",
  time:     "Elige la hora",
  service:  "¿Qué necesitas?",
  identify: "Últimos datos",
};

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYMD(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function formatLargo(ymd: string) {
  return parseYMD(ymd).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}
function iniciales(d: BookingFlowDoctor) {
  return `${(d.firstName?.[0] ?? "").toUpperCase()}${(d.lastName?.[0] ?? "").toUpperCase()}`;
}
function soloDigitos(s: string) {
  return (s ?? "").replace(/\D/g, "");
}
/** wa.me solo acepta dígitos; sin número, no hay salida por WhatsApp. */
function whatsappHref(numero: string | null | undefined, texto: string) {
  const d = soloDigitos(numero ?? "");
  if (!d) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

interface Paleta {
  card: string; cardAlt: string; border: string;
  ink: string; inkSoft: string; inkFaint: string;
  field: string; fieldBorder: string;
  disabled: string;
}
function paleta(surface: "light" | "dark"): Paleta {
  return surface === "dark"
    ? { card:"#1e293b", cardAlt:"#0f172a", border:"#334155", ink:"#f1f5f9", inkSoft:"#94a3b8", inkFaint:"#64748b", field:"#0f172a", fieldBorder:"#334155", disabled:"#334155" }
    : { card:"#ffffff", cardAlt:"#f8fafc", border:"#e5e7eb", ink:"#111827", inkSoft:"#6b7280", inkFaint:"#9ca3af", field:"#ffffff", fieldBorder:"#e5e7eb", disabled:"#e5e7eb" };
}

/* ============================================================
   EL FLUJO
   ============================================================ */
export function BookingFlow({
  clinic,
  theme,
  surface = "light",
  active = true,
  preselectedDoctorId,
  preselectedService,
  restore,
  nextPath,
  onClose,
  onBooked,
  onSelectionChange,
  onStepChange,
}: BookingFlowProps) {
  const P = paleta(surface);
  const doctors = clinic.doctors ?? [];
  const services = clinic.services ?? [];
  const unSoloDoctor = doctors.length === 1;

  /* ---- qué pasos existen en ESTA reserva ---- */
  const pasos = useMemo<StepId[]>(() => {
    const lista: StepId[] = [];
    if (doctors.length > 1 && !preselectedDoctorId) lista.push("doctor");
    lista.push("date", "time");
    if (services.length > 0 && !preselectedService) lista.push("service");
    lista.push("identify");
    return lista;
  }, [doctors.length, services.length, preselectedDoctorId, preselectedService]);

  const [paso, setPaso] = useState<StepId>(() => pasos[0]);
  const [terminado, setTerminado] = useState<null | "cita" | "solicitud">(null);

  /* ---- selección ---- */
  const [doctorId, setDoctorId] = useState<string | null>(
    // Sin doctores en la clínica no hay paso que elegir: se pregunta por
    // "cualquiera" y el endpoint responde honestamente que no hay horarios.
    preselectedDoctorId ?? (unSoloDoctor ? doctors[0].id : doctors.length === 0 ? ANY_DOCTOR : null),
  );
  const [selDate, setSelDate] = useState("");
  const [selSlot, setSelSlot] = useState("");
  const [servicio, setServicio] = useState<string>(preselectedService ?? "");
  const [calDate, setCalDate] = useState(() => new Date());

  /* ---- disponibilidad ---- */
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsReason, setSlotsReason] = useState("");
  const [cargandoSlots, setCargandoSlots] = useState(false);

  /* ---- avisos ---- */
  const [aviso, setAviso] = useState("");   // ámbar: el hueco se lo ganaron
  const [error, setError] = useState("");   // rojo: algo falló de verdad

  /* ---- identificación ---- */
  const { status: sesion, me, markSignedOut } = usePatientSession(active);
  const [sinCuenta, setSinCuenta] = useState(false);
  const [usarOtrosDatos, setUsarOtrosDatos] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "", email: "", notes: "",
    // vía sin cuenta
    nombreCompleto: "", dob: "", whatsapp: "",
    // campo trampa: si un bot lo llena, el servidor lo descarta
    website: "",
  });

  const restoreRef = useRef<PendingBooking | null>(restore ?? null);
  const nextRef = useRef(nextPath ?? `/${clinic.slug}`);
  useEffect(() => {
    nextRef.current = nextPath ?? currentBookingNext(`/${clinic.slug}`);
  }, [nextPath, clinic.slug]);

  const doctorElegido = doctorId && doctorId !== ANY_DOCTOR
    ? doctors.find(d => d.id === doctorId) ?? null
    : null;
  const servicioElegido = services.find(s => s.name === servicio) ?? null;

  /* ---- el contenedor quiere saber en qué paso vamos ---- */
  const stepRef = useRef(onStepChange);
  useEffect(() => { stepRef.current = onStepChange; });
  useEffect(() => {
    stepRef.current?.({
      title: terminado ? (terminado === "cita" ? "¡Confirmado!" : "Solicitud enviada") : STEP_TITLE[paso],
      index: Math.max(0, pasos.indexOf(paso)),
      total: pasos.length,
      done: terminado !== null,
    });
  }, [paso, pasos, terminado]);

  /* ---- avisar la selección hacia afuera (URL del directorio) ---- */
  const selRef = useRef(onSelectionChange);
  useEffect(() => { selRef.current = onSelectionChange; });
  useEffect(() => {
    selRef.current?.({
      doctorId: doctorId,
      service: servicio || null,
      date: selDate || null,
      slot: selSlot || null,
    });
  }, [doctorId, servicio, selDate, selSlot]);

  /* ---- reponer el hueco guardado al volver del login ---- */
  useEffect(() => {
    if (!restore) return;
    const existe = restore.doctorId === ANY_DOCTOR || doctors.some(d => d.id === restore.doctorId);
    if (!existe) {
      setAviso("Ese doctor ya no está disponible. Elige otro, por favor.");
      setPaso(pasos[0]);
      return;
    }
    restoreRef.current = restore;
    setDoctorId(restore.doctorId);
    if (restore.service) setServicio(restore.service);
    setCalDate(parseYMD(restore.date));
    setSelDate(restore.date);
    setPaso("time");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore]);

  /* ---- disponibilidad real del día elegido ---- */
  useEffect(() => {
    if (!selDate || !doctorId) return;
    const ctrl = new AbortController();
    setSlots([]); setSelSlot(""); setSlotsReason(""); setCargandoSlots(true);
    const qs = new URLSearchParams({ slug: clinic.slug, date: selDate });
    // Sin doctorId el endpoint devuelve los horarios en los que queda LIBRE
    // al menos un doctor (no los que están libres para todos).
    if (doctorId !== ANY_DOCTOR) qs.set("doctorId", doctorId);
    fetch(`/api/public/availability?${qs.toString()}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { slots?: string[]; reason?: string }) => {
        const lista = d.slots ?? [];
        setSlots(lista);
        setSlotsReason(lista.length === 0 ? (d.reason ?? "Sin horarios — elige otra fecha") : "");
        const pend = restoreRef.current;
        const outcome = pendingSlotOutcome(pend, doctorId, selDate, lista);
        if (outcome === "ignore") return;
        restoreRef.current = null;
        if (outcome === "apply") {
          setSelSlot(pend!.slot);
          // Con el procedimiento ya elegido antes del login, directo a
          // confirmar; si no, al paso que siga después de la hora.
          setPaso(pend!.service ? "identify" : (pasos[pasos.indexOf("time") + 1] ?? "identify"));
          return;
        }
        setAviso(slotTakenNotice(pend!.slot));
      })
      .catch(() => { /* abortado o red caída: se queda sin horarios */ })
      .finally(() => { if (!ctrl.signal.aborted) setCargandoSlots(false); });
    return () => ctrl.abort();
  }, [selDate, doctorId, clinic.slug]);

  /* ---- con sesión, los datos vienen de la cuenta ---- */
  useEffect(() => {
    if (!me) return;
    const { firstName, lastName } = splitFullName(me.name);
    setForm(f => ({ ...f, firstName, lastName, phone: me.phone ?? "", email: me.email ?? "" }));
  }, [me]);

  /* ---- navegación ---- */
  const idx = pasos.indexOf(paso);
  const avanzar = useCallback(() => {
    setAviso(""); setError("");
    const siguiente = pasos[pasos.indexOf(paso) + 1];
    if (siguiente) setPaso(siguiente);
  }, [paso, pasos]);
  const irA = useCallback((destino: StepId) => {
    setAviso(""); setError("");
    setPaso(destino);
  }, []);

  /** El hueco elegido, tal cual se guarda antes de irse a identificarse. */
  function seleccion(): PendingBooking {
    return { doctorId: doctorId ?? "", date: selDate, slot: selSlot, service: servicio };
  }

  /* ---- calendario ---- */
  const schedMap = useMemo(
    () => Object.fromEntries((clinic.schedules ?? []).map(s => [s.dayOfWeek, s])),
    [clinic.schedules],
  );
  function diaHabilitado(d: Date) {
    const js = d.getDay();
    const sched = schedMap[js === 0 ? 6 : js - 1];
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return !!sched?.enabled && d >= hoy;
  }
  function celdasDelMes() {
    const y = calDate.getFullYear(), m = calDate.getMonth();
    const primer = new Date(y, m, 1).getDay();
    const pad = primer === 0 ? 6 : primer - 1;
    const ultimo = new Date(y, m + 1, 0).getDate();
    const celdas: (Date | null)[] = [];
    for (let i = 0; i < pad; i++) celdas.push(null);
    for (let d = 1; d <= ultimo; d++) celdas.push(new Date(y, m, d));
    return celdas;
  }

  /* ---- envío: CITA (con cuenta) ---- */
  async function confirmarCita() {
    const nombre = form.firstName.trim(), apellido = form.lastName.trim();
    const tel = soloDigitos(form.phone);
    setIntentado(true);
    if (!nombre || !apellido || tel.length < 10) {
      setError("Necesitamos tu nombre, apellido y un teléfono de 10 dígitos.");
      return;
    }
    setError(""); setAviso(""); setEnviando(true);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: clinic.slug,
          doctorId: doctorId ?? ANY_DOCTOR,
          date: selDate,
          startTime: selSlot,
          type: servicio || "Consulta general",
          firstName: nombre,
          lastName: apellido,
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      // La sesión se venció a media reserva: guardamos el hueco y volvemos a
      // ofrecer los dos caminos. Nunca un muro rojo.
      if (requiresPatientAuth(res.status, data)) {
        savePendingBooking(clinic.slug, seleccion());
        markSignedOut();
        return;
      }
      // Se lo ganaron: de vuelta al paso de hora con el aviso ámbar.
      if (res.status === 409) {
        const perdido = selSlot;
        setSlots(s => s.filter(x => x !== perdido));
        setSelSlot("");
        setAviso(data.error ?? slotTakenNotice(perdido));
        irA("time");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "No pudimos agendar tu cita.");
      setTerminado("cita");
      onBooked?.();
    } catch (e: any) {
      setError(e?.message ?? "No pudimos agendar tu cita.");
    } finally {
      setEnviando(false);
    }
  }

  /* ---- envío: SOLICITUD (sin cuenta) ---- */
  async function enviarSolicitud() {
    const nombre = form.nombreCompleto.trim();
    const wa = soloDigitos(form.whatsapp);
    setIntentado(true);
    if (nombre.length < 3 || !form.dob || wa.length < 10) {
      setError("Completa tu nombre, fecha de nacimiento y WhatsApp de 10 dígitos.");
      return;
    }
    setError(""); setAviso(""); setEnviando(true);
    try {
      const res = await fetch("/api/public/booking-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: clinic.slug,
          doctorId: doctorId ?? ANY_DOCTOR,
          date: selDate,
          startTime: selSlot,
          service: servicio || null,
          serviceDurationMin: servicioElegido?.durationMin ?? null,
          patientName: nombre,
          patientDob: form.dob,
          whatsapp: wa,
          notes: form.notes.trim() || undefined,
          website: form.website,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error ?? "No pudimos enviar tu solicitud.");
      setTerminado("solicitud");
      onBooked?.();
    } catch (e: any) {
      setError(e?.message ?? "No pudimos enviar tu solicitud.");
    } finally {
      setEnviando(false);
    }
  }

  /* ---- estilos derivados ---- */
  const btnPrimario = (habilitado: boolean): React.CSSProperties => ({
    background: habilitado ? theme : P.disabled,
    color: habilitado ? "#fff" : P.inkFaint,
    boxShadow: habilitado ? `0 8px 24px ${alpha(theme, 0.35)}` : "none",
    cursor: habilitado ? "pointer" : "default",
  });
  const estiloCampo: React.CSSProperties = {
    background: P.field, borderColor: P.fieldBorder, color: P.ink,
  };
  const tarjeta: React.CSSProperties = {
    background: P.card, borderColor: P.border,
  };

  /* ============ PANTALLA FINAL ============ */
  if (terminado) {
    return (
      <FinalScreen
        tipo={terminado}
        theme={theme}
        P={P}
        clinic={clinic}
        doctor={doctorElegido}
        fecha={selDate}
        hora={selSlot}
        onClose={onClose}
      />
    );
  }

  const hoyYMD = toYMD(new Date());

  return (
    <div>
      {/* Barra de progreso */}
      <div className="flex gap-1.5 mb-5" aria-hidden="true">
        {pasos.map((p, i) => (
          <div key={p} className="flex-1 h-1 rounded-full transition-all"
            style={{ background: i <= idx ? theme : P.disabled }} />
        ))}
      </div>

      {/* Migas de vuelta */}
      {(paso === "date" || paso === "time" || paso === "service" || paso === "identify") && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs">
          {pasos.includes("doctor") && (
            <BackLink label="← Cambiar doctor" color={P.inkFaint} onClick={() => { setSelDate(""); setSelSlot(""); irA("doctor"); }} />
          )}
          {paso !== "date" && (
            <BackLink label="← Cambiar fecha" color={P.inkFaint} onClick={() => { setSelSlot(""); irA("date"); }} />
          )}
          {(paso === "service" || paso === "identify") && (
            <BackLink label="← Cambiar horario" color={P.inkFaint} onClick={() => irA("time")} />
          )}
          {paso === "identify" && pasos.includes("service") && (
            <BackLink label="← Cambiar procedimiento" color={P.inkFaint} onClick={() => irA("service")} />
          )}
        </div>
      )}

      {aviso && (
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm border"
          style={{ background: alpha("#f59e0b", surface === "dark" ? 0.14 : 0.1), borderColor: alpha("#f59e0b", 0.3), color: surface === "dark" ? "#fcd34d" : "#92400e" }}>
          {aviso}
        </div>
      )}

      {/* ══ PASO 1 — DOCTOR ══ */}
      {paso === "doctor" && (
        <div className="space-y-2.5">
          <p className="text-sm mb-4" style={{ color: P.inkSoft }}>Selecciona con quién deseas tu cita</p>

          {/* "Cualquier disponible" SIEMPRE primero: es lo que más gente quiere
              y lo que más horarios abre. */}
          <button type="button" onClick={() => { setDoctorId(ANY_DOCTOR); avanzar(); }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all"
            style={{ ...tarjeta, borderColor: doctorId === ANY_DOCTOR ? theme : P.border }}>
            <span className="w-14 h-14 rounded-2xl grid place-items-center shrink-0"
              style={{ background: alpha(theme, 0.12), color: theme }}>
              <Users size={22} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold" style={{ color: P.ink }}>Cualquier disponible</span>
              <span className="block text-xs mt-0.5" style={{ color: P.inkSoft }}>Te asignamos al doctor con lugar a esa hora</span>
            </span>
            <ArrowRight size={15} className="shrink-0" style={{ color: P.inkFaint }} />
          </button>

          {doctors.map(doc => (
            <button key={doc.id} type="button" onClick={() => { setDoctorId(doc.id); avanzar(); }}
              className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all"
              style={{ ...tarjeta, borderColor: doctorId === doc.id ? theme : P.border }}>
              {doc.avatarUrl ? (
                <img src={doc.avatarUrl} alt="" loading="lazy" className="w-14 h-14 rounded-2xl object-cover shrink-0" />
              ) : (
                <span className="w-14 h-14 rounded-2xl grid place-items-center text-white font-bold text-lg shrink-0"
                  style={{ background: `linear-gradient(135deg, ${doc.color ?? theme}, ${shade(doc.color ?? theme, 0.25)})` }}>
                  {iniciales(doc)}
                </span>
              )}
              <span className="flex-1 min-w-0">
                <span className="block font-bold truncate" style={{ color: P.ink }}>Dr/a. {doc.firstName} {doc.lastName}</span>
                {doc.specialty && <span className="block text-xs mt-0.5 font-semibold truncate" style={{ color: theme }}>{doc.specialty}</span>}
                {!!doc.services?.length && (
                  <span className="block text-[11px] mt-1 truncate" style={{ color: P.inkFaint }}>{doc.services.slice(0, 3).join(" · ")}</span>
                )}
              </span>
              <ArrowRight size={15} className="shrink-0" style={{ color: P.inkFaint }} />
            </button>
          ))}
        </div>
      )}

      {/* ══ PASO 2 — FECHA ══ */}
      {paso === "date" && (
        <div>
          {doctorId && (
            <ResumenDoctor doctor={doctorElegido} theme={theme} P={P} />
          )}
          <div className="rounded-2xl p-4 border" style={{ background: P.cardAlt, borderColor: P.border }}>
            <div className="flex items-center justify-between mb-4">
              <button type="button" aria-label="Mes anterior"
                onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="w-9 h-9 rounded-xl grid place-items-center transition-colors"
                style={{ color: P.inkSoft }}>
                <ChevronLeft size={18} />
              </button>
              <span className="font-bold text-sm" style={{ color: P.ink }}>
                {MONTHS_ES[calDate.getMonth()]} {calDate.getFullYear()}
              </span>
              <button type="button" aria-label="Mes siguiente"
                onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="w-9 h-9 rounded-xl grid place-items-center transition-colors"
                style={{ color: P.inkSoft }}>
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-2">
              {DAYS_SHORT.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold py-1" style={{ color: P.inkFaint }}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {celdasDelMes().map((dia, i) => {
                if (!dia) return <div key={i} />;
                const ymd = toYMD(dia);
                const habil = diaHabilitado(dia);
                const sel = ymd === selDate;
                const esHoy = ymd === hoyYMD;
                return (
                  <button key={i} type="button" disabled={!habil}
                    aria-label={formatLargo(ymd)}
                    aria-current={esHoy ? "date" : undefined}
                    onClick={() => { setSelDate(ymd); setAviso(""); avanzar(); }}
                    className="h-9 rounded-xl text-sm transition-all"
                    style={{
                      background: sel ? theme : "transparent",
                      color: sel ? "#fff" : habil ? P.ink : P.inkFaint,
                      opacity: habil ? 1 : 0.45,
                      fontWeight: esHoy || sel ? 700 : 400,
                      border: esHoy && !sel ? `2px solid ${theme}` : "2px solid transparent",
                      cursor: habil ? "pointer" : "default",
                    }}>
                    {dia.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ PASO 3 — HORA ══ */}
      {paso === "time" && (
        <div>
          <ResumenDoctor doctor={doctorElegido} theme={theme} P={P} />
          <div className="text-xs font-semibold mb-3 capitalize flex items-center gap-1.5" style={{ color: P.inkSoft }}>
            <Calendar size={13} /> {selDate ? formatLargo(selDate) : ""}
          </div>

          {cargandoSlots ? (
            <div className="flex items-center gap-2 text-sm py-4" style={{ color: P.inkSoft }}>
              <Loader2 size={14} className="animate-spin" /> Buscando horarios…
            </div>
          ) : slots.length === 0 ? (
            <p className="text-sm py-3" style={{ color: P.inkSoft }}>{slotsReason || "Sin horarios — elige otra fecha"}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
              {slots.map(s => {
                const sel = selSlot === s;
                return (
                  <button key={s} type="button" onClick={() => { setSelSlot(s); setAviso(""); }}
                    aria-pressed={sel}
                    className="py-2.5 rounded-xl text-sm font-bold border-2 transition-all tabular-nums"
                    style={{
                      background: sel ? theme : P.card,
                      color: sel ? "#fff" : P.ink,
                      borderColor: sel ? theme : P.border,
                    }}>
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          <button type="button" disabled={!selSlot} onClick={avanzar}
            className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
            style={btnPrimario(!!selSlot)}>
            {selSlot ? <><Check size={16} /> Continuar — {selSlot}</> : "Selecciona un horario"}
          </button>
        </div>
      )}

      {/* ══ PASO 4 — PROCEDIMIENTO ══ */}
      {paso === "service" && (
        <div className="space-y-2.5">
          <p className="text-sm mb-4" style={{ color: P.inkSoft }}>Elige el procedimiento de tu cita</p>
          {services.map(s => {
            const sel = servicio === s.name;
            return (
              <button key={s.name} type="button" onClick={() => { setServicio(s.name); avanzar(); }}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all"
                style={{ ...tarjeta, borderColor: sel ? theme : P.border }}>
                <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0 text-lg"
                  style={{ background: alpha(theme, 0.1), color: theme }}>
                  {s.icon || "🦷"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold truncate" style={{ color: P.ink }}>{s.name}</span>
                  {(s.price || s.durationMin) && (
                    <span className="block text-xs mt-0.5 font-mono" style={{ color: P.inkSoft }}>
                      {[s.price, s.durationMin ? `${s.durationMin} min` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <ArrowRight size={15} className="shrink-0" style={{ color: P.inkFaint }} />
              </button>
            );
          })}
          <button type="button" onClick={() => { setServicio(""); avanzar(); }}
            className="w-full py-3 text-xs font-semibold underline" style={{ color: P.inkSoft }}>
            No estoy seguro — que la clínica me oriente
          </button>
        </div>
      )}

      {/* ══ PASO 5 — IDENTIFICARSE ══ */}
      {paso === "identify" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4 text-sm font-semibold flex items-start gap-2.5"
            style={{ background: alpha(theme, 0.1), color: surface === "dark" ? P.ink : shade(theme, 0.35) }}>
            <Calendar size={15} className="mt-0.5 shrink-0" />
            <span>
              {selDate ? formatLargo(selDate) : ""} · <span className="font-mono">{selSlot}</span>
              <br />
              <span className="font-normal">
                {doctorElegido ? `Dr/a. ${doctorElegido.firstName} ${doctorElegido.lastName}` : "Cualquier doctor disponible"}
                {servicio ? ` · ${servicio}` : ""}
              </span>
            </span>
          </div>

          {sesion === "loading" ? (
            <div className="flex items-center gap-2 text-sm py-4" style={{ color: P.inkSoft }}>
              <Loader2 size={14} className="animate-spin" style={{ color: theme }} /> Un momento…
            </div>
          ) : sinCuenta ? (
            /* ---- VÍA B: sin cuenta → SOLICITUD ---- */
            <div className="space-y-3">
              <div className="rounded-2xl p-3.5 text-xs leading-relaxed"
                style={{ background: P.cardAlt, color: P.inkSoft, border: `1px solid ${P.border}` }}>
                Vas a <strong style={{ color: P.ink }}>pedir</strong> este horario. La clínica lo revisa y te
                confirma por WhatsApp — todavía no es una cita agendada.
              </div>

              <Campo label="Nombre completo *" P={P} theme={theme} intentado={intentado}
                invalido={form.nombreCompleto.trim().length < 3}
                value={form.nombreCompleto} onChange={v => setForm(f => ({ ...f, nombreCompleto: v }))}
                placeholder="Ana María Gómez López" autoComplete="name" />

              <Campo label="Fecha de nacimiento *" P={P} theme={theme} intentado={intentado}
                invalido={!form.dob} type="date"
                value={form.dob} onChange={v => setForm(f => ({ ...f, dob: v }))}
                autoComplete="bday" />

              <Campo label="WhatsApp * (10 dígitos)" P={P} theme={theme} intentado={intentado}
                invalido={soloDigitos(form.whatsapp).length < 10} type="tel" inputMode="numeric"
                value={form.whatsapp} onChange={v => setForm(f => ({ ...f, whatsapp: v }))}
                placeholder="999 123 4567" autoComplete="tel" />

              {/* Campo trampa: fuera de la vista y del tabulador, no del DOM. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />

              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: P.inkSoft }}>Notas (opcional)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} placeholder="Cuéntale a la clínica qué necesitas…"
                  className="w-full border-2 rounded-xl px-3.5 py-2.5 text-sm outline-none resize-none transition-colors"
                  style={estiloCampo} />
              </div>

              {error && <ErrorBox text={error} surface={surface} />}

              <button type="button" onClick={enviarSolicitud} disabled={enviando}
                className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 transition-all"
                style={btnPrimario(!enviando)}>
                {enviando ? <><Loader2 size={18} className="animate-spin" /> Enviando…</> : <><Send size={17} /> Enviar solicitud</>}
              </button>

              <button type="button" onClick={() => { setSinCuenta(false); setError(""); }}
                className="w-full text-xs font-semibold underline py-1" style={{ color: P.inkSoft }}>
                Mejor uso mi cuenta
              </button>
            </div>
          ) : sesion === "anonymous" ? (
            /* ---- Las dos vías, visibles a la vez ---- */
            <div className="space-y-3">
              <a href={patientAuthHref("login", nextRef.current)}
                onClick={() => savePendingBooking(clinic.slug, seleccion())}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all"
                style={{ background: theme, boxShadow: `0 8px 24px ${alpha(theme, 0.35)}` }}>
                <LogIn size={16} /> Ya tengo cuenta · Iniciar sesión
              </a>

              <a href={patientAuthHref("registro", nextRef.current)}
                onClick={() => savePendingBooking(clinic.slug, seleccion())}
                className="w-full py-3.5 rounded-2xl font-bold text-sm border-2 flex items-center justify-center gap-2 transition-all"
                style={{ borderColor: theme, color: theme }}>
                <UserPlus size={16} /> Es mi primera vez · Crear cuenta
              </a>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1" style={{ background: P.border }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: P.inkFaint }}>o</span>
                <span className="h-px flex-1" style={{ background: P.border }} />
              </div>

              <button type="button" onClick={() => { setSinCuenta(true); setIntentado(false); setError(""); }}
                className="w-full py-3.5 rounded-2xl font-bold text-sm border-2 transition-all"
                style={{ borderColor: P.border, color: P.ink, background: P.card }}>
                Reservar sin cuenta
              </button>

              <p className="text-[11px] text-center leading-relaxed" style={{ color: P.inkFaint }}>
                {BOOKING_AUTH_COPY.portable}
              </p>

              <SalidasDeContacto clinic={clinic} theme={theme} P={P} />
            </div>
          ) : (
            /* ---- VÍA A: con sesión → CITA real ---- */
            <div className="space-y-3">
              <div className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
                style={{ background: alpha(theme, 0.1) }}>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: surface === "dark" ? P.inkSoft : alpha(shade(theme, 0.4), 0.7) }}>
                    Reservas como
                  </div>
                  <div className="text-sm font-bold truncate" style={{ color: surface === "dark" ? P.ink : shade(theme, 0.4) }}>
                    {usarOtrosDatos ? "Otra persona" : (me?.name ?? "Tu cuenta")}
                  </div>
                </div>
                <button type="button"
                  onClick={() => {
                    setUsarOtrosDatos(v => !v);
                    if (!usarOtrosDatos) setForm(f => ({ ...f, firstName: "", lastName: "", phone: "" }));
                    else if (me) {
                      const { firstName, lastName } = splitFullName(me.name);
                      setForm(f => ({ ...f, firstName, lastName, phone: me.phone ?? "" }));
                    }
                  }}
                  className="text-[11px] font-bold underline shrink-0 whitespace-nowrap" style={{ color: theme }}>
                  {usarOtrosDatos ? "Usar mis datos" : "Usar otros datos"}
                </button>
              </div>

              {/* Con la cuenta llena y sin editar, el paso es un solo botón. */}
              {(usarOtrosDatos || !form.firstName.trim() || !form.lastName.trim() || soloDigitos(form.phone).length < 10) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Nombre *" P={P} theme={theme} intentado={intentado} invalido={!form.firstName.trim()}
                      value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} placeholder="Nombre" autoComplete="given-name" />
                    <Campo label="Apellido *" P={P} theme={theme} intentado={intentado} invalido={!form.lastName.trim()}
                      value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} placeholder="Apellido" autoComplete="family-name" />
                  </div>
                  <Campo label="WhatsApp / Teléfono *" P={P} theme={theme} intentado={intentado}
                    invalido={soloDigitos(form.phone).length < 10} type="tel" inputMode="numeric"
                    value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="999 123 4567" autoComplete="tel" />
                </>
              )}

              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: P.inkSoft }}>Notas (opcional)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} placeholder="Describe tu motivo…"
                  className="w-full border-2 rounded-xl px-3.5 py-2.5 text-sm outline-none resize-none transition-colors"
                  style={estiloCampo} />
              </div>

              {error && <ErrorBox text={error} surface={surface} />}

              <button type="button" onClick={confirmarCita} disabled={enviando}
                className="w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 transition-all"
                style={btnPrimario(!enviando)}>
                {enviando ? <><Loader2 size={18} className="animate-spin" /> Confirmando…</> : <><Check size={18} /> Confirmar cita</>}
              </button>

              <button type="button" onClick={() => { setSinCuenta(true); setIntentado(false); setError(""); }}
                className="w-full text-xs font-semibold underline py-1" style={{ color: P.inkSoft }}>
                Reservar sin cuenta
              </button>

              <SalidasDeContacto clinic={clinic} theme={theme} P={P} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- piezas ---------- */

function BackLink({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hover:underline" style={{ color }}>
      {label}
    </button>
  );
}

function ResumenDoctor({ doctor, theme, P }: { doctor: BookingFlowDoctor | null; theme: string; P: Paleta }) {
  return (
    <div className="flex items-center gap-3 mb-4 p-3 rounded-2xl" style={{ background: P.cardAlt }}>
      {doctor ? (
        doctor.avatarUrl ? (
          <img src={doctor.avatarUrl} alt="" loading="lazy" className="w-9 h-9 rounded-xl object-cover shrink-0" />
        ) : (
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white text-xs font-bold shrink-0"
            style={{ background: doctor.color ?? theme }}>{iniciales(doctor)}</span>
        )
      ) : (
        <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: alpha(theme, 0.12), color: theme }}>
          <Users size={16} />
        </span>
      )}
      <span className="text-sm font-semibold truncate" style={{ color: P.ink }}>
        {doctor ? `Dr/a. ${doctor.firstName} ${doctor.lastName}` : "Cualquier doctor disponible"}
      </span>
    </div>
  );
}

function Campo({
  label, value, onChange, placeholder, type = "text", inputMode, autoComplete,
  P, theme, invalido, intentado,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; inputMode?: "numeric" | "text" | "tel";
  autoComplete?: string; P: Paleta; theme: string; invalido?: boolean; intentado?: boolean;
}) {
  const malo = !!(intentado && invalido);
  return (
    <div>
      <label className="text-xs font-semibold block mb-1.5" style={{ color: P.inkSoft }}>{label}</label>
      <input
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={malo || undefined}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border-2 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{ background: P.field, borderColor: malo ? "#ef4444" : P.fieldBorder, color: P.ink }}
        onFocus={e => { e.currentTarget.style.borderColor = theme; }}
        onBlur={e => { e.currentTarget.style.borderColor = malo ? "#ef4444" : P.fieldBorder; }}
      />
    </div>
  );
}

function ErrorBox({ text, surface }: { text: string; surface: "light" | "dark" }) {
  return (
    <div className="rounded-xl p-3 text-sm border"
      style={surface === "dark"
        ? { background: "#450a0a", borderColor: "#7f1d1d", color: "#fca5a5" }
        : { background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
      {text}
    </div>
  );
}

/** La salida de siempre para quien no quiere ni cuenta ni formulario. */
function SalidasDeContacto({ clinic, theme, P }: { clinic: BookingFlowClinic; theme: string; P: Paleta }) {
  const wa = whatsappHref(clinic.whatsapp, `Hola, quiero agendar una cita en ${clinic.name}.`);
  const tel = bookingPhoneExit(clinic.phone);
  if (!wa && !tel) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pt-1">
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: theme }}>
          <MessageCircle size={13} /> Escríbenos por WhatsApp
        </a>
      )}
      {tel && (
        <a href={tel.href} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: P.inkSoft }}>
          <Phone size={13} /> {tel.label}
        </a>
      )}
    </div>
  );
}

function FinalScreen({
  tipo, theme, P, clinic, doctor, fecha, hora, onClose,
}: {
  tipo: "cita" | "solicitud";
  theme: string; P: Paleta; clinic: BookingFlowClinic;
  doctor: BookingFlowDoctor | null; fecha: string; hora: string;
  onClose?: () => void;
}) {
  const esCita = tipo === "cita";
  return (
    <div className="text-center py-4">
      <div className="w-24 h-24 rounded-full mx-auto mb-6 grid place-items-center" style={{ background: alpha(theme, 0.1) }}>
        <div className="w-16 h-16 rounded-full grid place-items-center" style={{ background: theme }}>
          {esCita ? <Check size={32} className="text-white" strokeWidth={3} /> : <Clock size={30} className="text-white" strokeWidth={2.5} />}
        </div>
      </div>

      <h3 className="text-2xl font-bold mb-2" style={{ color: P.ink }}>
        {esCita ? "¡Cita confirmada!" : "Solicitud enviada"}
      </h3>

      <p className="text-sm mb-1" style={{ color: P.inkSoft }}>
        {doctor ? `Dr/a. ${doctor.firstName} ${doctor.lastName}` : "Cualquier doctor disponible"}
      </p>
      <p className="font-bold text-base mb-6 font-mono" style={{ color: theme }}>
        {fecha ? formatLargo(fecha) : ""} · {hora}
      </p>

      <div className="rounded-2xl p-5 text-sm text-left space-y-3 mb-6" style={{ background: P.cardAlt }}>
        {esCita ? (
          <>
            <div className="flex items-center gap-3" style={{ color: P.inkSoft }}><span className="text-xl">📱</span>Recibirás un WhatsApp con los detalles</div>
            <div className="flex items-center gap-3" style={{ color: P.inkSoft }}><span className="text-xl">⏰</span>Recordatorio 24 horas antes</div>
          </>
        ) : (
          <>
            {/* Copy honesto: NO tiene cita. Si cree que sí y se presenta, el
                problema se lo come la clínica. */}
            <div className="flex items-start gap-3" style={{ color: P.inkSoft }}>
              <span className="text-xl shrink-0">📱</span>
              <span><strong style={{ color: P.ink }}>{clinic.name}</strong> revisará tu solicitud y te confirmará por WhatsApp.</span>
            </div>
            <div className="flex items-start gap-3" style={{ color: P.inkSoft }}>
              <span className="text-xl shrink-0">⚠️</span>
              <span>Ese horario <strong style={{ color: P.ink }}>aún no está apartado</strong>: tu cita queda en firme cuando la clínica te escriba.</span>
            </div>
          </>
        )}
        {clinic.address && (
          <div className="flex items-start gap-3" style={{ color: P.inkSoft }}><span className="text-xl shrink-0">📍</span><span>{clinic.address}</span></div>
        )}
      </div>

      {onClose && (
        <button type="button" onClick={onClose} className="w-full py-3.5 rounded-2xl font-bold text-white" style={{ background: theme }}>
          Cerrar
        </button>
      )}
    </div>
  );
}

/* ============================================================
   El mismo flujo dentro de un modal (plantillas y directorio).
   ============================================================ */
export interface BookingFlowModalProps extends BookingFlowProps {
  open: boolean;
}

export function BookingFlowModal({ open, onClose, ...props }: BookingFlowModalProps) {
  const P = paleta(props.surface ?? "light");
  const cardRef = useRef<HTMLDivElement>(null);
  const [titulo, setTitulo] = useState("Agendar cita");

  // Esc + bloqueo de scroll del body + focus-trap
  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Tab" && cardRef.current) {
        const foco = Array.from(
          cardRef.current.querySelectorAll<HTMLElement>('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'),
        ).filter(el => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
        if (!foco.length) return;
        const primero = foco[0], ultimo = foco[foco.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onStepChange = useCallback((info: { title: string }) => setTitulo(info.title), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={() => onClose?.()}>
      <div ref={cardRef}
        className="w-full sm:max-w-[460px] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[94vh] overflow-y-auto"
        style={{ background: P.card, maxHeight: "94dvh" }}
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`Reservar cita en ${props.clinic.name}`}>
        <div className="sticky top-0 z-10 px-6 pt-5 pb-4 border-b rounded-t-[2rem]"
          style={{ background: P.card, borderColor: P.border }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-lg leading-tight truncate" style={{ color: P.ink }}>{titulo}</div>
              <div className="text-xs truncate" style={{ color: P.inkFaint }}>{props.clinic.name}</div>
            </div>
            <button type="button" onClick={() => onClose?.()} aria-label="Cerrar"
              className="p-2 rounded-xl shrink-0 transition-colors" style={{ color: P.inkFaint }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-6 py-5">
          <BookingFlow {...props} onClose={onClose} onStepChange={onStepChange} active={open} />
        </div>
      </div>
    </div>
  );
}
