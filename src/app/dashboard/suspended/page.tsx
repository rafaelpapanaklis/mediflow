import Link from "next/link";

const BANK_INFO = {
  nombre: "Efthymios Rafail Papanaklis",
  clabe:  "012910015008025244",
  banco:  "BBVA",
};

const PLANS = [
  { id: "BASIC",  name: "Básico",      price: "$49/mes",  features: ["1 profesional","200 pacientes","Agenda","Facturación"] },
  { id: "PRO",    name: "Profesional", price: "$99/mes",  features: ["3 profesionales","Ilimitado","Expedientes","Reportes"] },
  { id: "CLINIC", name: "Clínica",     price: "$249/mes", features: ["Todo ilimitado","Multi-sucursal","API","Manager"] },
];

export default function SuspendedPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-3xl mx-auto mb-4">⏰</div>
          <h1 className="text-2xl font-extrabold text-white mb-2">Tu suscripción ha vencido</h1>
          <p className="text-muted-foreground">Tu acceso está temporalmente suspendido. Renueva tu plan para continuar usando MediFlow.</p>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {PLANS.map(plan => (
            <div key={plan.id} className={`rounded-xl border p-4 ${plan.id === "PRO" ? "border-brand-500 bg-brand-950/50" : "border-slate-700 bg-card"}`}>
              {plan.id === "PRO" && <div className="text-[10px] font-bold text-brand-400 mb-2">⭐ MÁS POPULAR</div>}
              <div className="font-bold text-white mb-0.5">{plan.name}</div>
              <div className="text-lg font-extrabold text-brand-400 mb-3">{plan.price}</div>
              <ul className="space-y-1">
                {plan.features.map(f => (
                  <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="text-emerald-400">✓</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Payment info */}
        <div className="bg-card border border-brand-700 rounded-xl p-5 mb-4">
          <div className="text-xs font-bold text-brand-400 uppercase tracking-wide mb-4">💳 Realiza tu pago por transferencia SPEI</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Nombre del beneficiario</div>
              <div className="font-semibold text-white text-sm">{BANK_INFO.nombre}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">CLABE interbancaria</div>
              <div className="font-mono font-extrabold text-brand-400 text-xl tracking-wider">{BANK_INFO.clabe}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Banco</div>
              <div className="font-semibold text-white text-sm">{BANK_INFO.banco}</div>
            </div>
          </div>
          <div className="mt-4 p-3 bg-amber-950/50 border border-amber-700 rounded-lg text-xs text-amber-300">
            <strong>Importante:</strong> En el concepto de tu transferencia escribe el nombre de tu clínica. Tu acceso se reactivará en máximo 24 horas hábiles después de confirmar el pago.
          </div>
        </div>

        {/* Contact */}
        <div className="text-center text-sm text-muted-foreground">
          ¿Ya realizaste el pago? Escríbenos a{" "}
          <a href="mailto:soporte@mediflow.app" className="text-brand-400 hover:underline">soporte@mediflow.app</a>
          {" "}o por WhatsApp para activar tu cuenta de inmediato.
        </div>

        <div className="mt-6 text-center">
          <Link href="/login" className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">← Volver al login</Link>
        </div>
      </div>
    </div>
  );
}
