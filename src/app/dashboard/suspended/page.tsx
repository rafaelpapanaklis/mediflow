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

export const dynamic = "force-dynamic";

export default function SuspendedPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero bloqueante centrado */}
      <section className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 text-4xl">
          ⏰
        </div>
        <h1 className="mb-4 max-w-2xl text-4xl font-extrabold tracking-tight md:text-5xl">
          Tu plan expiró
        </h1>
        <p className="mb-8 max-w-xl text-base text-muted-foreground md:text-lg">
          Tu acceso al panel está bloqueado. Para seguir usando MediFlow y
          retomar tus citas, expedientes y facturación, renueva tu plan.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="#renovar-plan"
            className="inline-flex items-center justify-center rounded-xl px-8 py-4 text-base font-bold text-white shadow-lg transition hover:opacity-90"
            style={{
              background: "var(--brand)",
              boxShadow: "0 10px 30px -8px var(--brand-soft, rgba(124,58,237,0.4))",
            }}
          >
            Renovar plan →
          </a>
          <a
            href="mailto:soporte@mediflow.app"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-4 text-base font-semibold text-foreground transition hover:bg-muted"
          >
            Hablar con soporte
          </a>
        </div>
        <Link
          href="/login"
          className="mt-10 text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← Volver al login
        </Link>
      </section>

      {/* Sección de planes + datos de pago */}
      <section
        id="renovar-plan"
        className="mx-auto max-w-4xl scroll-mt-8 px-4 pb-20"
      >
        <h2 className="mb-2 text-center text-2xl font-bold tracking-tight">
          Elige tu plan
        </h2>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Realiza la transferencia y tu cuenta se reactiva en máximo 24 horas hábiles.
        </p>

        {/* Planes */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const isPopular = plan.id === "PRO";
            return (
              <div
                key={plan.id}
                className={`flex flex-col rounded-2xl border p-5 ${
                  isPopular
                    ? "border-2 shadow-md"
                    : "border-border bg-card"
                }`}
                style={
                  isPopular
                    ? {
                        borderColor: "var(--brand)",
                        background: "var(--brand-softer, hsl(var(--card)))",
                      }
                    : undefined
                }
              >
                {isPopular && (
                  <div
                    className="mb-2 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: "var(--brand)" }}
                  >
                    ★ Más popular
                  </div>
                )}
                <div className="mb-1 text-base font-bold">{plan.name}</div>
                <div
                  className="mb-4 text-2xl font-extrabold"
                  style={{ color: "var(--brand)" }}
                >
                  {plan.price}
                </div>
                <ul className="space-y-1.5">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span className="text-emerald-500">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Datos de pago SPEI */}
        <div
          className="rounded-2xl border-2 bg-card p-6"
          style={{ borderColor: "var(--brand)" }}
        >
          <div
            className="mb-5 text-xs font-bold uppercase tracking-wider"
            style={{ color: "var(--brand)" }}
          >
            💳 Realiza tu pago por transferencia SPEI
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                Nombre del beneficiario
              </div>
              <div className="text-sm font-semibold">{BANK_INFO.nombre}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                CLABE interbancaria
              </div>
              <div
                className="font-mono text-xl font-extrabold tracking-wider"
                style={{ color: "var(--brand)" }}
              >
                {BANK_INFO.clabe}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Banco</div>
              <div className="text-sm font-semibold">{BANK_INFO.banco}</div>
            </div>
          </div>
          <div
            className="mt-5 rounded-lg border p-3 text-xs"
            style={{
              background: "rgba(245, 158, 11, 0.08)",
              borderColor: "rgba(245, 158, 11, 0.4)",
              color: "rgb(180, 83, 9)",
            }}
          >
            <strong>Importante:</strong> en el concepto de tu transferencia
            escribe el nombre de tu clínica. Tu acceso se reactiva en máximo
            24 horas hábiles después de confirmar el pago.
          </div>
        </div>

        {/* Contacto */}
        <div className="mt-6 text-center text-sm text-muted-foreground">
          ¿Ya realizaste el pago? Escríbenos a{" "}
          <a
            href="mailto:soporte@mediflow.app"
            className="font-semibold hover:underline"
            style={{ color: "var(--brand)" }}
          >
            soporte@mediflow.app
          </a>{" "}
          o por WhatsApp para activar tu cuenta de inmediato.
        </div>
      </section>
    </div>
  );
}
