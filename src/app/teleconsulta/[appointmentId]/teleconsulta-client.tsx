"use client";

import { useState, useEffect, useCallback } from "react";

interface TeleconsultaClientProps {
  appointmentId: string;
  roomUrl: string | null;
  token: string | null;
  role: "doctor" | "patient";
  patientName: string;
  doctorName: string;
  clinicName: string;
  appointmentType: string;
  appointmentTime: string;
  paymentStatus: string;
}

export function TeleconsultaClient({
  appointmentId,
  roomUrl,
  token,
  role,
  patientName,
  doctorName,
  clinicName,
  appointmentType,
  appointmentTime,
  paymentStatus,
}: TeleconsultaClientProps) {
  const [joined, setJoined] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!joined || callEnded) return;
    const interval = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [joined, callEnded]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleEnd = useCallback(async () => {
    try {
      await fetch("/api/teleconsulta/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
    } catch (err) {
      console.error("Error ending call:", err);
    }
    setCallEnded(true);
  }, [appointmentId]);

  // Payment not confirmed
  if (paymentStatus !== "paid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-amber-900/30 flex items-center justify-center text-3xl mx-auto mb-6">
            💳
          </div>
          <h1 className="text-xl font-bold text-white mb-3">Pago pendiente</h1>
          <p className="text-slate-400">
            El pago aún no se ha confirmado. La videollamada estará disponible
            una vez completado el pago.
          </p>
        </div>
      </div>
    );
  }

  // Room not ready
  if (!roomUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-blue-500 rounded-full mx-auto mb-6" />
          <p className="text-slate-400">
            La sala de video aún no está lista. Espera unos momentos...
          </p>
        </div>
      </div>
    );
  }

  // Call ended
  if (callEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-900/30 flex items-center justify-center text-3xl mx-auto mb-6">
            ✅
          </div>
          <h1 className="text-xl font-bold text-white mb-2">
            La consulta ha finalizado
          </h1>
          <p className="text-slate-400 mb-2">
            Duración: {formatTime(duration)}
          </p>
          <p className="text-slate-500 text-sm mb-6">
            Gracias por usar MediFlow.
          </p>
          <a
            href="/"
            className="inline-block bg-blue-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }

  // Waiting room (not joined yet)
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        {/* Header */}
        <div className="px-6 py-4">
          <div className="text-xl font-extrabold tracking-tight">
            <span className="text-blue-500">Medi</span>Flow
          </div>
        </div>

        {/* Center card */}
        <div className="flex items-center justify-center px-4" style={{ minHeight: "calc(100vh - 80px)" }}>
          <div className="w-full max-w-md">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
              <div className="w-20 h-20 rounded-full bg-blue-600/20 flex items-center justify-center text-4xl mx-auto mb-6">
                🩺
              </div>
              <h1 className="text-2xl font-extrabold mb-1">Teleconsulta</h1>
              <p className="text-slate-400 text-sm mb-6">{clinicName}</p>

              <div className="space-y-3 text-left bg-slate-800/50 rounded-xl p-4 mb-6">
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">
                    {role === "doctor" ? "Paciente" : "Doctor/a"}
                  </span>
                  <span className="text-sm font-semibold">
                    {role === "doctor" ? patientName : doctorName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Tipo</span>
                  <span className="text-sm font-semibold">{appointmentType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Hora</span>
                  <span className="text-sm font-semibold">{appointmentTime}</span>
                </div>
              </div>

              <p className="text-slate-500 text-xs mb-6">
                Asegúrate de tener buena conexión, usa audífonos si es posible.
              </p>

              <button
                onClick={() => setJoined(true)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl text-lg transition-colors"
              >
                Unirse a la consulta
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // In-call view
  return (
    <div className="h-screen flex flex-col bg-slate-950 text-white">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-4">
          <div className="text-lg font-extrabold tracking-tight">
            <span className="text-blue-500">Medi</span>Flow
          </div>
          <span className="text-sm text-slate-400">
            {role === "doctor" ? patientName : doctorName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm font-mono text-slate-300 bg-slate-800 px-3 py-1 rounded-lg">
            {formatTime(duration)}
          </span>
          <button
            onClick={handleEnd}
            className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            Terminar
          </button>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 relative">
        <iframe
          src={`${roomUrl}?t=${token}`}
          allow="camera;microphone;fullscreen;display-capture"
          style={{ width: "100%", height: "100%" }}
          className="border-0"
        />
      </div>
    </div>
  );
}
