"use client";

import { useState } from "react";

interface PagoClientProps {
  appointmentId: string;
  patientName: string;
  doctorName: string;
  clinicName: string;
  appointmentType: string;
  date: string;
  time: string;
  amount: number;
  paymentStatus: string;
  teleRoomUrl: string | null;
  telePatientToken: string | null;
}

export function PagoClient({
  appointmentId,
  patientName,
  doctorName,
  clinicName,
  appointmentType,
  date,
  time,
  amount,
  paymentStatus,
  teleRoomUrl,
  telePatientToken,
}: PagoClientProps) {
  const [loading, setLoading] = useState(false);

  const formattedDate = new Date(date).toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedAmount = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);

  const handlePay = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("No checkout URL returned");
        setLoading(false);
      }
    } catch (err) {
      console.error("Error creating checkout session:", err);
      setLoading(false);
    }
  };

  // Already paid
  if (paymentStatus === "paid") {
    const teleconsultaUrl = teleRoomUrl
      ? `/teleconsulta/${appointmentId}?token=${telePatientToken}`
      : null;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-4xl mx-auto mb-6">
            ✅
          </div>
          <h1 className="text-2xl font-extrabold mb-2">Tu consulta ya está pagada</h1>
          <p className="text-muted-foreground mb-6">
            No necesitas hacer nada más. Recibirás un recordatorio antes de tu cita.
          </p>
          {teleconsultaUrl && (
            <a
              href={teleconsultaUrl}
              className="inline-block bg-blue-600 text-white font-bold px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Ir a la videollamada
            </a>
          )}
        </div>
      </div>
    );
  }

  // Payment pending
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl p-8 shadow-lg">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="text-2xl font-extrabold tracking-tight">
              <span className="text-blue-600">Medi</span>Flow
            </div>
            <p className="text-muted-foreground text-sm mt-1">Pago de teleconsulta</p>
          </div>

          {/* Appointment details */}
          <div className="space-y-4 mb-8">
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Doctor/a</span>
              <span className="text-sm font-semibold text-right">{doctorName}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Clínica</span>
              <span className="text-sm font-semibold text-right">{clinicName}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Tipo</span>
              <span className="text-sm font-semibold text-right">{appointmentType}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Fecha</span>
              <span className="text-sm font-semibold text-right capitalize">{formattedDate}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Hora</span>
              <span className="text-sm font-semibold text-right">{time}</span>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex justify-between items-center">
                <span className="font-bold">Total</span>
                <span className="text-2xl font-extrabold text-blue-600">{formattedAmount}</span>
              </div>
            </div>
          </div>

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                Procesando...
              </span>
            ) : (
              `Pagar ${formattedAmount}`
            )}
          </button>

          <p className="text-center text-xs text-muted-foreground mt-4">
            Serás redirigido a Stripe para completar el pago de forma segura.
          </p>
        </div>
      </div>
    </div>
  );
}
