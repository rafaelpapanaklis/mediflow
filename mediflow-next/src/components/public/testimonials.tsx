import { Star } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";

const testimonials = [
  {
    name: "Dra. Ana Martínez",
    role: "Cirujana Dental · CDMX",
    initials: "AM",
    color: "bg-violet-500",
    country: "🇲🇽",
    rating: 5,
    quote:
      "Antes usaba papel y Excel. MediFlow cambió todo. El odontograma es increíble y los recordatorios de WhatsApp redujeron mis no-show a casi cero. En serio, no puedo imaginar trabajar sin esto.",
  },
  {
    name: "Dr. Carlos Vega",
    role: "Médico General · Bogotá",
    initials: "CV",
    color: "bg-brand-600",
    country: "🇨🇴",
    rating: 5,
    quote:
      "La función de notas con IA es magia. Dicto mientras ausculto y la nota sale estructurada en formato SOAP con el CIE-10 correcto. Ahorro al menos 20 minutos por paciente. Increíble.",
  },
  {
    name: "Lic. Patricia Soto",
    role: "Nutrióloga · Buenos Aires",
    initials: "PS",
    color: "bg-emerald-600",
    country: "🇦🇷",
    rating: 5,
    quote:
      "El módulo de seguimiento nutricional es exactamente lo que necesitaba. Mis pacientes pueden ver su progreso en el portal y eso los motiva muchísimo. El soporte en español es excelente.",
  },
  {
    name: "Psic. Laura Flores",
    role: "Psicóloga Clínica · Madrid",
    initials: "LF",
    color: "bg-pink-500",
    country: "🇪🇸",
    rating: 5,
    quote:
      "La privacidad de las notas de sesión es fundamental para mí. Que el paciente no pueda ver mis anotaciones clínicas y al mismo tiempo tenga su portal de citas es perfecto. Muy bien diseñado.",
  },
  {
    name: "Dra. Isabel Ramos",
    role: "Dermatóloga · Santiago",
    initials: "IR",
    color: "bg-amber-500",
    country: "🇨🇱",
    rating: 5,
    quote:
      "La galería antes/después y el seguimiento fotográfico son perfectos para mis pacientes de estética. Las citas se confirman solas por WhatsApp. Mis pacientes están muy impresionados con el portal.",
  },
  {
    name: "Dr. Miguel Ángel Torres",
    role: "Ortodoncista · Guadalajara",
    initials: "MT",
    color: "bg-cyan-600",
    country: "🇲🇽",
    rating: 5,
    quote:
      "Tengo 3 doctores en el consultorio y MediFlow nos permite coordinar la agenda de todos sin conflictos. Los reportes de ingresos por doctor son muy útiles para la contabilidad mensual.",
  },
];

export function Testimonials() {
  return (
    <section className="section-pad bg-white">
      <div className="container-tight">
        <SectionHeader
          eyebrow="Lo que dicen nuestros clientes"
          title="Miles de profesionales ya confían en MediFlow"
          subtitle="Clínicas en México, Colombia, Argentina, Chile y España gestionan su día a día con MediFlow."
          centered
          className="mb-14"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="rounded-2xl border border-border bg-card p-6 hover:shadow-card-md transition-all duration-200 flex flex-col"
            >
              {/* Stars */}
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-sm text-muted-foreground leading-relaxed flex-1 mb-5">
                &ldquo;{t.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}
                >
                  {t.initials}
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {t.name} {t.country}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 p-8 rounded-2xl bg-slate-50 border border-border">
          {[
            { value: "+2,400", label: "Clínicas activas" },
            { value: "+180K",  label: "Pacientes gestionados" },
            { value: "94%",    label: "Tasa de retención" },
            { value: "4.9/5",  label: "Calificación promedio" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-extrabold text-brand-600 tracking-tight">
                {stat.value}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
