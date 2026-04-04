import { Metadata } from "next";

export const metadata: Metadata = { title: "Mi Portal — MediFlow" };

export default async function PortalPage({ params }: { params: { token: string } }) {
  // Fetch patient data server-side using token
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/portal/${params.token}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    const err = await res.json();
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Enlace no válido</h1>
          <p className="text-slate-500 text-sm">{err.error ?? "Este enlace no existe o ha expirado."}</p>
          <p className="text-slate-400 text-xs mt-4">Solicita un nuevo enlace a tu médico.</p>
        </div>
      </div>
    );
  }

  const { patient, appointments, doctor, clinic } = await res.json();

  const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    PENDING:     { label:"Pendiente",  color:"bg-amber-100 text-amber-700"   },
    CONFIRMED:   { label:"Confirmada", color:"bg-emerald-100 text-emerald-700"},
    COMPLETED:   { label:"Completada", color:"bg-slate-100 text-slate-600"   },
    CANCELLED:   { label:"Cancelada",  color:"bg-rose-100 text-rose-700"     },
    IN_PROGRESS: { label:"En curso",   color:"bg-blue-100 text-blue-700"     },
    NO_SHOW:     { label:"No asistió", color:"bg-orange-100 text-orange-700" },
  };

  function formatDate(d: string) {
    const date = new Date(d);
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  const upcoming = appointments.filter((a: any) => new Date(a.date) >= new Date() && a.status !== "CANCELLED");
  const past     = appointments.filter((a: any) => new Date(a.date) < new Date() || a.status === "COMPLETED");

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-slate-100" style={{ fontFamily:"system-ui,sans-serif" }}>
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {clinic.logo ? (
              <img src={clinic.logo} alt={clinic.name} className="h-8 w-auto object-contain" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-sm">M</div>
            )}
            <div>
              <div className="font-bold text-slate-800 text-sm">{clinic.name}</div>
              {clinic.phone && <div className="text-xs text-slate-400">{clinic.phone}</div>}
            </div>
          </div>
          <div className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-full font-semibold">Mi Portal</div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Patient greeting */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
              {patient.firstName[0]}{patient.lastName[0]}
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">Hola, {patient.firstName} 👋</div>
              <div className="text-sm text-slate-400">Paciente #{patient.patientNumber}</div>
              {doctor && <div className="text-sm text-blue-600 font-semibold mt-0.5">{doctor.name} · {doctor.specialty}</div>}
            </div>
          </div>
        </div>

        {/* Medical summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-base font-bold text-slate-800 mb-4">📋 Mi información médica</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { label:"Tipo de sangre", val: patient.bloodType ?? "No registrado" },
              { label:"Fecha de nacimiento", val: patient.dob ? formatDate(patient.dob) : "No registrado" },
            ].map(r => (
              <div key={r.label} className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{r.label}</div>
                <div className="font-semibold text-slate-700">{r.val}</div>
              </div>
            ))}
          </div>

          {patient.allergies.length > 0 && (
            <div className="mt-3 p-3 bg-rose-50 rounded-xl border border-rose-100">
              <div className="text-xs font-bold text-rose-600 uppercase tracking-wide mb-2">⚠️ Alergias</div>
              <div className="flex flex-wrap gap-1.5">
                {patient.allergies.map((a: string) => (
                  <span key={a} className="text-xs bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full font-semibold">{a}</span>
                ))}
              </div>
            </div>
          )}

          {patient.chronicConditions.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-2">📌 Condiciones crónicas</div>
              <div className="flex flex-wrap gap-1.5">
                {patient.chronicConditions.map((c: string) => (
                  <span key={c} className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-semibold">{c}</span>
                ))}
              </div>
            </div>
          )}

          {patient.currentMedications.length > 0 && (
            <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
              <div className="text-xs font-bold text-blue-600 uppercase tracking-wide mb-2">💊 Medicamentos actuales</div>
              <div className="flex flex-wrap gap-1.5">
                {patient.currentMedications.map((m: string) => (
                  <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-semibold">{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Upcoming appointments */}
        {upcoming.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-base font-bold text-slate-800 mb-4">📅 Próximas citas</h2>
            <div className="space-y-3">
              {upcoming.map((a: any, i: number) => {
                const cfg = STATUS_LABELS[a.status] ?? STATUS_LABELS.PENDING;
                return (
                  <div key={i} className="flex items-start gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <div className="w-12 h-12 bg-emerald-600 rounded-xl flex flex-col items-center justify-center text-white flex-shrink-0">
                      <div className="text-xs font-bold uppercase">{MONTHS[new Date(a.date).getMonth()]}</div>
                      <div className="text-xl font-bold leading-none">{new Date(a.date).getDate()}</div>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-slate-800">{a.type}</div>
                      <div className="text-sm text-slate-500">{a.doctor} · {a.startTime} – {a.endTime}</div>
                      <span className={`mt-1 inline-block text-xs font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Past appointments */}
        {past.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-base font-bold text-slate-800 mb-4">🕐 Historial de citas</h2>
            <div className="space-y-2.5">
              {past.slice(0,8).map((a: any, i: number) => {
                const cfg = STATUS_LABELS[a.status] ?? STATUS_LABELS.COMPLETED;
                return (
                  <div key={i} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
                    <div className="text-center w-10 flex-shrink-0">
                      <div className="text-xs text-slate-400 font-semibold">{MONTHS[new Date(a.date).getMonth()]}</div>
                      <div className="text-base font-bold text-slate-700">{new Date(a.date).getDate()}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-700 truncate">{a.type}</div>
                      <div className="text-xs text-slate-400">{a.doctor}</div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.color}`}>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contact clinic */}
        {clinic.phone && (
          <div className="bg-blue-600 rounded-2xl p-5 text-center">
            <div className="text-white font-bold mb-1">¿Necesitas agendar una cita?</div>
            <div className="text-blue-100 text-sm mb-3">Comunícate directamente con la clínica</div>
            <a href={`tel:${clinic.phone}`}
              className="inline-block bg-white text-blue-600 font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-blue-50 transition-colors">
              📞 {clinic.phone}
            </a>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 pb-4">
          Portal seguro generado por MediFlow · Tu información está protegida
        </p>
      </main>
    </div>
  );
}
