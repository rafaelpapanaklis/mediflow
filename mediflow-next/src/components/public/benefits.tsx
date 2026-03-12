import { SectionHeader } from "@/components/shared/section-header";

const benefits = [
  {
    icon: "⚡",
    title: "Setup en 5 minutos",
    desc: "Sin instalaciones, sin servidores propios, sin configuración técnica. Crea tu cuenta y empieza a registrar pacientes hoy mismo.",
    bg: "bg-brand-50",
  },
  {
    icon: "🔒",
    title: "Datos cifrados y seguros",
    desc: "Cifrado AES-256 en reposo y en tránsito. Cumplimiento con NOM-024 en México y RGPD en España. Respaldos automáticos cada hora.",
    bg: "bg-emerald-50",
  },
  {
    icon: "💬",
    title: "WhatsApp integrado",
    desc: "Recordatorios automáticos 24h y 2h antes de cada cita. Reduce el 80% de los no-show. Confirmaciones en un clic desde el teléfono.",
    bg: "bg-amber-50",
  },
  {
    icon: "🤖",
    title: "Notas clínicas con IA",
    desc: "Dicta o escribe y la IA estructura tu nota SOAP automáticamente. Diagnósticos CIE-10 sugeridos. Ahorra 15 min por consulta.",
    bg: "bg-violet-50",
  },
  {
    icon: "📱",
    title: "Portal del paciente",
    desc: "Tus pacientes confirman citas, pagan, descargan facturas y ven sus indicaciones desde su celular. Sin apps que instalar.",
    bg: "bg-brand-50",
  },
  {
    icon: "📈",
    title: "Reportes en tiempo real",
    desc: "Ingresos, citas, pacientes nuevos, tratamientos más rentables. Exporta en PDF o Excel. Toma decisiones con datos reales.",
    bg: "bg-emerald-50",
  },
];

export function Benefits() {
  return (
    <section className="section-pad bg-white">
      <div className="container-tight">
        <SectionHeader
          eyebrow="Por qué MediFlow"
          title="Todo lo que necesitas, nada que no."
          subtitle="Diseñado por y para profesionales de la salud en Latinoamérica y España. Simple de usar, poderoso cuando lo necesitas."
          centered
          className="mb-14"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {benefits.map((b) => (
            <div
              key={b.title}
              className="group rounded-2xl border border-border bg-card p-6 hover:shadow-card-md hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className={`w-12 h-12 rounded-xl ${b.bg} flex items-center justify-center text-2xl mb-4`}>
                {b.icon}
              </div>
              <h3 className="text-base font-bold text-foreground mb-2">{b.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
