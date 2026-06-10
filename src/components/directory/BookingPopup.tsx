"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, ArrowRight, Check, Stethoscope, UserRound } from "lucide-react";
import {
  DEFAULT_SERVICE,
  type BookingSelection,
  type DirectoryClinic,
  type DirectoryDoctor,
} from "@/lib/directory/types";
import { deriveStep, formatDateEs } from "@/lib/directory/booking-state";
import { BookingSchedule } from "./BookingSchedule";

// ─────────────────────────────────────────────────────────────────────────────
// POPUP DE RESERVA del directorio — shell + paso 1 (servicio) + paso 2
// (profesional) + paso 5 (éxito). Los pasos 3 (fecha/hora) y 4 (confirmar)
// los pinta <BookingSchedule> (solo se consumen sus props, no se toca).
// Bottom-sheet en móvil, centrado en sm+. Acento = clinic.themeColor ??
// violeta DaleControl. Sin fetch aquí — el único fetch de slots/booking vive
// en BookingSchedule. Cada cambio de selección se avisa al controller vía
// onSelectionChange (él la persiste en URL + sessionStorage).
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingPopupProps {
  clinic: DirectoryClinic;
  initialSelection?: Partial<BookingSelection>;
  /** Cada cambio de selección — el controller la persiste en URL + storage */
  onSelectionChange: (sel: BookingSelection) => void;
  onClose: () => void;
}

const STEP_TITLES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Elige el servicio",
  2: "Elige a tu profesional",
  3: "Fecha y hora",
  4: "Confirma tu cita",
  5: "¡Listo!",
};

/** Oscurece (amt < 0) o aclara (amt > 0) un hex #rrggbb — para gradientes de avatar. */
function shade(hex: string, amt: number): string {
  const h = (hex ?? "").replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function BookingPopup({ clinic, initialSelection, onSelectionChange, onClose }: BookingPopupProps) {
  const theme = clinic.themeColor || "#7c3aed";

  const [sel, setSel] = useState<BookingSelection>({
    clinicSlug: clinic.slug,
    service: initialSelection?.service ?? null,
    doctorId: initialSelection?.doctorId ?? null,
    date: initialSelection?.date ?? null,
    slot: initialSelection?.slot ?? null,
  });
  // Paso explícito, inicializado desde la selección: al volver del registro
  // con la selección completa abre directo en el 4. Si el doctorId de la URL
  // no existe en la clínica, de vuelta al paso 2.
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(() => {
    const s = deriveStep(sel);
    if (s >= 3 && !clinic.doctors.some((d) => d.id === sel.doctorId)) return 2;
    return s;
  });
  const [booked, setBooked] = useState(false);

  const doctor: DirectoryDoctor | undefined = clinic.doctors.find((d) => d.id === sel.doctorId);

  /** setSel + aviso al controller (URL + sessionStorage) en un solo paso. */
  const update = (partial: Partial<BookingSelection>) => {
    const next = { ...sel, ...partial };
    setSel(next);
    onSelectionChange(next);
  };

  // Bloquea el scroll del body mientras el popup está montado.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Tecla Escape cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Paso 1 — comodín + servicios únicos (dedup case-insensitive), tope 14.
  const services = useMemo(() => {
    const seen = new Set<string>([DEFAULT_SERVICE.toLowerCase()]);
    const list: string[] = [DEFAULT_SERVICE];
    for (const raw of [...clinic.featuredServices, ...clinic.doctors.flatMap((d) => d.services)]) {
      if (list.length >= 14) break;
      const name = (raw ?? "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      list.push(name);
    }
    return list;
  }, [clinic]);

  // Paso 2 — profesionales del servicio elegido; si ninguno coincide, todos.
  const { doctorList, anyDoctorNote } = useMemo(() => {
    const all = clinic.doctors;
    if (!sel.service || sel.service.toLowerCase() === DEFAULT_SERVICE.toLowerCase()) {
      return { doctorList: all, anyDoctorNote: false };
    }
    const svc = sel.service.toLowerCase();
    const filtered = all.filter((d) => d.services.some((s) => s.toLowerCase() === svc));
    return filtered.length > 0
      ? { doctorList: filtered, anyDoctorNote: false }
      : { doctorList: all, anyDoctorNote: true };
  }, [clinic.doctors, sel.service]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reservar cita en ${clinic.name}`}
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-[460px] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto"
        // dvh sigue al viewport visible en móvil (iOS Safari con toolbar
        // expandida recorta el header con 92vh); si no hay soporte, la
        // declaración inválida se ignora y aplica el max-h-[92vh] de la clase.
        style={{ maxHeight: "92dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky: logo + título del paso + X + progreso */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-4 border-b border-gray-50 rounded-t-[2rem]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {clinic.logoUrl ? (
                <img src={clinic.logoUrl} alt="" loading="lazy" className="w-6 h-6 rounded-lg object-cover shrink-0" />
              ) : (
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ background: theme }}
                >
                  {clinic.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-bold text-lg leading-tight truncate" style={{ color: "var(--ink)" }}>
                  {STEP_TITLES[step]}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--muted)" }}>{clinic.name}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-2 rounded-xl hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>
          {!booked && (
            <div className="flex gap-1.5 mt-4">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className="flex-1 h-1 rounded-full transition-all"
                  style={{ background: s <= step ? theme : "#f3f4f6" }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-5">
          {/* Paso 1 — servicio */}
          {step === 1 && (
            <div className="space-y-2.5">
              <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
                Selecciona el servicio para tu cita
              </p>
              {services.map((service) => {
                const selected = sel.service?.toLowerCase() === service.toLowerCase();
                return (
                  <button
                    key={service}
                    type="button"
                    onClick={() => {
                      update({ service });
                      setStep(2);
                    }}
                    className="w-full flex items-center gap-3 rounded-2xl border-2 border-[#f1f5f9] p-3.5 text-left transition-all hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]"
                    style={selected ? { borderColor: theme } : undefined}
                  >
                    <span
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={selected ? { background: `${theme}15`, color: theme } : { background: "var(--v50)", color: "var(--b2)" }}
                    >
                      <Stethoscope size={16} />
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>
                      {service}
                    </span>
                    {selected && <Check size={18} className="shrink-0" style={{ color: theme }} />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Paso 2 — profesional */}
          {step === 2 && (
            <div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs hover:text-gray-600 mb-4 flex items-center gap-1"
                style={{ color: "var(--muted)" }}
              >
                ← Cambiar servicio
              </button>
              {clinic.doctors.length === 0 ? (
                <div className="text-center py-8">
                  <div
                    className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                    style={{ background: "var(--v50)", color: "var(--b2)" }}
                  >
                    <UserRound size={24} />
                  </div>
                  <p className="font-bold mb-1" style={{ color: "var(--ink)" }}>
                    Esta clínica aún no tiene agenda en línea
                  </p>
                  <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                    Intenta más tarde o contacta directamente a la clínica.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl font-bold text-white transition-all"
                    style={{ background: theme }}
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-sm mb-1" style={{ color: "var(--muted)" }}>
                    Selecciona con quién deseas tu cita
                  </p>
                  {anyDoctorNote && (
                    <p className="text-xs rounded-xl px-3 py-2" style={{ background: "var(--v50)", color: "var(--b2)" }}>
                      Cualquiera de estos profesionales puede atenderte
                    </p>
                  )}
                  {doctorList.map((d) => {
                    const selected = sel.doctorId === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          update({ doctorId: d.id });
                          setStep(3);
                        }}
                        className="w-full flex items-center gap-4 rounded-2xl border-2 border-[#f1f5f9] p-3.5 text-left transition-all hover:border-[color:var(--v200)] hover:bg-[color:var(--tint2)]"
                        style={selected ? { borderColor: theme } : undefined}
                      >
                        {d.avatarUrl ? (
                          <img
                            src={d.avatarUrl}
                            alt=""
                            loading="lazy"
                            className="w-[52px] h-[52px] rounded-2xl object-cover shrink-0"
                          />
                        ) : (
                          <span
                            className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                            style={{ background: `linear-gradient(135deg, ${d.color}, ${shade(d.color, -25)})` }}
                          >
                            {(d.firstName?.[0] ?? "").toUpperCase()}
                            {(d.lastName?.[0] ?? "").toUpperCase()}
                          </span>
                        )}
                        <span className="flex-1 min-w-0 block">
                          <span className="block font-bold" style={{ color: "var(--ink)" }}>
                            Dr/a. {d.firstName} {d.lastName}
                          </span>
                          {d.specialty && (
                            <span className="block text-xs mt-0.5 font-semibold" style={{ color: theme }}>
                              {d.specialty}
                            </span>
                          )}
                          {d.services.length > 0 && (
                            <span className="block text-[11px] mt-1 truncate" style={{ color: "var(--muted)" }}>
                              {d.services.slice(0, 3).join(" · ")}
                            </span>
                          )}
                        </span>
                        <ArrowRight size={15} className="text-gray-300 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Pasos 3 y 4 — fecha/hora y confirmación (delegados a BookingSchedule) */}
          {(step === 3 || step === 4) && doctor && (
            <BookingSchedule
              clinic={clinic}
              mode={step === 3 ? "schedule" : "confirm"}
              service={sel.service ?? DEFAULT_SERVICE}
              doctor={doctor}
              date={sel.date}
              slot={sel.slot}
              theme={theme}
              onPick={(date, slot) => {
                update({ date, slot });
                setStep(4);
              }}
              onBack={() => {
                if (step === 4) {
                  update({ slot: null });
                  setStep(3);
                } else {
                  update({ doctorId: null, date: null, slot: null });
                  setStep(2);
                }
              }}
              onBooked={() => {
                setBooked(true);
                setStep(5);
              }}
            />
          )}

          {/* Paso 5 — éxito */}
          {step === 5 && (
            <div className="text-center py-4">
              <div className="w-24 h-24 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: `${theme}12` }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme }}>
                  <Check size={32} className="text-white" strokeWidth={3} />
                </div>
              </div>
              <h3 className="text-2xl font-bold mb-2" style={{ color: "var(--ink)" }}>¡Cita confirmada!</h3>
              {doctor && (
                <p className="text-sm mb-1" style={{ color: "var(--muted)" }}>
                  Dr/a. {doctor.firstName} {doctor.lastName}
                </p>
              )}
              <p className="font-bold text-base mb-8" style={{ color: theme }}>
                {sel.date ? formatDateEs(sel.date) : ""}{sel.slot ? ` · ${sel.slot}` : ""}
              </p>
              <div className="bg-gray-50 rounded-2xl p-5 text-sm text-left space-y-3 mb-6">
                <div className="flex items-center gap-3" style={{ color: "var(--muted)" }}>
                  <span className="text-xl">📱</span>Recibirás un WhatsApp con los detalles
                </div>
                {clinic.address && (
                  <div className="flex items-start gap-3" style={{ color: "var(--muted)" }}>
                    <span className="text-xl">📍</span>
                    <span>{clinic.address}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3.5 rounded-2xl font-bold text-white transition-all"
                style={{ background: theme, boxShadow: `0 8px 24px ${theme}40` }}
              >
                Cerrar
              </button>
              {clinic.landingActive && (
                <Link
                  href={`/${clinic.slug}`}
                  className="block w-full py-3 mt-2 rounded-2xl font-semibold text-sm text-center border hover:bg-[color:var(--tint2)] transition-colors"
                  style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                >
                  Ver clínica
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
