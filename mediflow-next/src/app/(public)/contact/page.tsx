import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/shared/section-header";

export const metadata: Metadata = {
  title: "Contacto — MediFlow",
  description: "Contáctanos y te respondemos en menos de 4 horas.",
};

const contactOptions = [
  {
    icon: "💬",
    title: "Chat en vivo",
    desc: "Lun–Vie, 8am–8pm hora CDMX",
    action: "Abrir chat",
    bg: "bg-brand-50",
  },
  {
    icon: "📧",
    title: "Email",
    desc: "hola@mediflow.com · <4h respuesta",
    action: "Enviar email",
    bg: "bg-emerald-50",
  },
  {
    icon: "📹",
    title: "Videollamada",
    desc: "Demo personalizada de 30 minutos",
    action: "Agendar demo",
    bg: "bg-violet-50",
  },
  {
    icon: "📞",
    title: "Teléfono",
    desc: "+52 55 8000 1234 (solo plan Clínica)",
    action: "Llamar ahora",
    bg: "bg-amber-50",
  },
];

export default function ContactPage() {
  return (
    <>
      {/* Hero */}
      <section className="hero-bg pt-20 pb-14 px-6">
        <div className="container-tight">
          <SectionHeader
            eyebrow="Hablemos"
            title="¿En qué podemos ayudarte?"
            subtitle="Nuestro equipo en español está listo para responder tus preguntas, hacer una demo personalizada o ayudarte a migrar desde tu sistema actual."
            centered
            className="mb-12"
          />

          {/* Contact channels */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
            {contactOptions.map((opt) => (
              <div
                key={opt.title}
                className="rounded-2xl border border-border bg-white p-5 text-center hover:shadow-card-md transition-all duration-200"
              >
                <div className={`w-12 h-12 rounded-xl ${opt.bg} flex items-center justify-center text-2xl mx-auto mb-3`}>
                  {opt.icon}
                </div>
                <h3 className="text-sm font-bold text-foreground mb-1">{opt.title}</h3>
                <p className="text-xs text-muted-foreground mb-3">{opt.desc}</p>
                <button className="text-xs font-semibold text-brand-600 hover:underline">
                  {opt.action} →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact form */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="grid lg:grid-cols-5 gap-10">
            {/* Left info */}
            <div className="lg:col-span-2">
              <h2 className="text-xl font-extrabold text-foreground mb-3">Envíanos un mensaje</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Cuéntanos sobre tu clínica y cómo podemos ayudarte.
                Respondemos en menos de 4 horas en horario hábil.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0 text-sm">🏢</div>
                  <div>
                    <div className="text-xs font-bold text-foreground">Oficinas</div>
                    <div className="text-xs text-muted-foreground">Ciudad de México · Madrid · Buenos Aires</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 text-sm">⏰</div>
                  <div>
                    <div className="text-xs font-bold text-foreground">Horario de soporte</div>
                    <div className="text-xs text-muted-foreground">Lun–Vie 8am–8pm CDMX · Email 24/7</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 text-sm">🌎</div>
                  <div>
                    <div className="text-xs font-bold text-foreground">Idiomas</div>
                    <div className="text-xs text-muted-foreground">Español · English · Português</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-3">
              <div className="rounded-2xl border border-border bg-white p-7 shadow-card">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-name">Nombre completo</Label>
                    <Input id="contact-name" placeholder="Dr. Juan García" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email">Correo electrónico</Label>
                    <Input id="contact-email" type="email" placeholder="juan@clinica.com" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-clinic">Nombre de tu clínica</Label>
                    <Input id="contact-clinic" placeholder="Clínica Dental García" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-phone">Teléfono / WhatsApp</Label>
                    <Input id="contact-phone" placeholder="+52 55 1234 5678" />
                  </div>
                </div>

                <div className="mb-4 space-y-1.5">
                  <Label htmlFor="contact-specialty">Especialidad</Label>
                  <select
                    id="contact-specialty"
                    className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all"
                  >
                    <option>Odontología</option>
                    <option>Medicina General</option>
                    <option>Nutrición</option>
                    <option>Psicología</option>
                    <option>Dermatología</option>
                    <option>Otra especialidad</option>
                  </select>
                </div>

                <div className="mb-4 space-y-1.5">
                  <Label htmlFor="contact-subject">Asunto</Label>
                  <select
                    id="contact-subject"
                    className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all"
                  >
                    <option>Quiero una demo personalizada</option>
                    <option>Tengo preguntas sobre precios</option>
                    <option>Soporte técnico</option>
                    <option>Migración desde otro sistema</option>
                    <option>Partnership / Afiliados</option>
                    <option>Otro</option>
                  </select>
                </div>

                <div className="mb-5 space-y-1.5">
                  <Label htmlFor="contact-message">Mensaje</Label>
                  <Textarea
                    id="contact-message"
                    rows={4}
                    placeholder="Cuéntanos sobre tu clínica, cuántos doctores trabajan contigo y qué estás buscando mejorar..."
                  />
                </div>

                <Button className="w-full" size="lg">
                  Enviar mensaje →
                </Button>

                <p className="text-center text-xs text-muted-foreground mt-3">
                  Al enviar aceptas nuestra{" "}
                  <a href="#" className="text-brand-600 hover:underline">política de privacidad</a>.
                  Respondemos en menos de 4 horas.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
