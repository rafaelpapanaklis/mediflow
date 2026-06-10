"use client";

// Botonera pública de confirmación de cita. Recibe datos ya formateados del
// server component; solo conoce el token (nunca ids internos).

import { useState } from "react";

export interface ConfirmInfo {
  clinicName: string;
  clinicLogoUrl: string | null;
  clinicPhone: string | null;
  clinicAddress: string | null;
  patientFirstName: string;
  doctorName: string;
  fecha: string;
  hora: string;
  /** Estado actual de la cita al cargar la página. */
  status: string;
}

export function ConfirmClient({ token, info }: { token: string; info: ConfirmInfo }) {
  const [loading, setLoading] = useState<"confirm" | "cancel" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);

  async function act(action: "confirm" | "cancel") {
    if (loading) return;
    setLoading(action);
    setError(null);
    try {
      const res = await fetch("/api/public/appointment-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      if (res.status === 429) {
        setError("Demasiados intentos, espera un momento.");
        return;
      }
      if (!res.ok) {
        setError("No se pudo procesar. Intenta de nuevo.");
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && typeof data.status === "string") {
        setResult(data.status);
      } else {
        setError("No se pudo procesar. Intenta de nuevo.");
      }
    } catch {
      setError("No se pudo procesar. Intenta de nuevo.");
    } finally {
      setLoading(null);
    }
  }

  const phoneLink = info.clinicPhone ? (
    <a
      href={`tel:${info.clinicPhone}`}
      className="text-emerald-400 underline underline-offset-2"
    >
      {info.clinicPhone}
    </a>
  ) : null;

  const header = (
    <div className="flex flex-col items-center text-center gap-3 mb-6">
      {info.clinicLogoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info.clinicLogoUrl}
          alt={info.clinicName}
          className="w-16 h-16 rounded-full object-cover border border-slate-700"
        />
      )}
      <div>
        <h1 className="text-xl font-bold">{info.clinicName}</h1>
        <p className="text-sm text-slate-400">Confirmación de cita</p>
      </div>
    </div>
  );

  const footer = (
    <p className="text-center text-xs text-slate-600 mt-8">Powered by DaleControl</p>
  );

  // ── Pantalla de resultado tras la acción ────────────────────────────────
  if (result) {
    const confirmed = result === "CONFIRMED";
    const cancelled = result === "CANCELLED";
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center">
            {header}
            <div className="text-5xl mb-4">{confirmed ? "✅" : cancelled ? "❌" : "ℹ️"}</div>
            {confirmed ? (
              <p className="text-lg font-semibold">
                ¡Listo! Tu cita está confirmada. Te esperamos.
              </p>
            ) : cancelled ? (
              <>
                <p className="text-lg font-semibold">Tu cita fue cancelada.</p>
                <p className="text-slate-400 mt-2">
                  Si quieres reagendar, contacta a la clínica.
                  {phoneLink && <> Llama al {phoneLink}.</>}
                </p>
              </>
            ) : (
              // La cita está en un estado que no se puede cambiar desde aquí
              // (p. ej. ya iniciada o completada).
              <>
                <p className="text-lg font-semibold">Tu cita sigue activa.</p>
                <p className="text-slate-400 mt-2">
                  No fue posible aplicar el cambio desde este enlace. Si
                  necesitas modificarla, contacta a la clínica.
                  {phoneLink && <> Llama al {phoneLink}.</>}
                </p>
              </>
            )}
            <p className="text-sm text-slate-500 mt-4">Ya puedes cerrar esta página.</p>
          </div>
          {footer}
        </div>
      </div>
    );
  }

  // ── Estado final: cita ya cancelada ─────────────────────────────────────
  if (info.status === "CANCELLED") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center">
            {header}
            <div className="text-5xl mb-4">❌</div>
            <p className="text-lg font-semibold">Esta cita fue cancelada.</p>
            <p className="text-slate-400 mt-2">
              Si quieres reagendar, contacta a la clínica.
              {phoneLink && <> Llama al {phoneLink}.</>}
            </p>
          </div>
          {footer}
        </div>
      </div>
    );
  }

  const alreadyConfirmed = info.status === "CONFIRMED";

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
          {header}

          <p className="text-lg mb-4">Hola {info.patientFirstName} 👋</p>

          {alreadyConfirmed && (
            <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded-xl px-4 py-3 mb-4 text-sm font-medium">
              ✅ Tu cita ya está confirmada
            </div>
          )}

          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-6 space-y-2 text-sm">
            <p>
              <span className="mr-2">📅</span>
              <span className="capitalize">{info.fecha}</span>
            </p>
            <p>
              <span className="mr-2">🕐</span>
              {info.hora} h
            </p>
            <p>
              <span className="mr-2">👨‍⚕️</span>
              {info.doctorName}
            </p>
            {info.clinicAddress && (
              <p>
                <span className="mr-2">📍</span>
                {info.clinicAddress}
              </p>
            )}
            {info.clinicPhone && (
              <p>
                <span className="mr-2">📞</span>
                {phoneLink}
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-950/60 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}

          {askCancel ? (
            <div className="space-y-3">
              <p className="text-center text-sm text-slate-300 font-medium">
                ¿Seguro que no podrás asistir?
              </p>
              <button
                onClick={() => act("cancel")}
                disabled={loading !== null}
                className="w-full py-3 rounded-xl font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading === "cancel" ? "Cancelando…" : "Sí, cancelar mi cita"}
              </button>
              <button
                onClick={() => setAskCancel(false)}
                disabled={loading !== null}
                className="w-full py-3 rounded-xl font-semibold border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                Volver
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {!alreadyConfirmed && (
                <button
                  onClick={() => act("confirm")}
                  disabled={loading !== null}
                  className="w-full py-3 rounded-xl font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loading === "confirm" ? "Confirmando…" : "✅ Confirmar asistencia"}
                </button>
              )}
              <button
                onClick={() => setAskCancel(true)}
                disabled={loading !== null}
                className="w-full py-3 rounded-xl font-semibold border border-red-700 text-red-400 hover:bg-red-950/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                Ya no puedo asistir
              </button>
            </div>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}
