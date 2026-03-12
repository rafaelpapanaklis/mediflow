import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SectionHeader } from "@/components/shared/section-header";

const faqs = [
  {
    q: "¿Necesito instalar algo para usar MediFlow?",
    a: "No. MediFlow funciona 100% en el navegador, tanto en computadora como en tablet o celular. No requiere instalación, ni servidores propios, ni mantenimiento técnico de tu parte.",
  },
  {
    q: "¿Mis datos están seguros?",
    a: "Sí. Usamos cifrado AES-256 tanto en reposo como en tránsito. Los servidores están en la región más cercana a tu país y hacemos respaldos automáticos cada hora. Cumplimos con NOM-024 en México y RGPD en España.",
  },
  {
    q: "¿Puedo migrar mis pacientes desde otro sistema o Excel?",
    a: "Absolutamente. Tenemos una herramienta de importación que acepta archivos CSV y Excel. También ofrecemos migración asistida sin costo adicional en todos los planes pagados.",
  },
  {
    q: "¿Qué pasa si tengo más de un consultorio?",
    a: "El plan Clínica incluye soporte para múltiples sucursales. Cada sucursal tiene su propia agenda, doctores y configuración, pero todo se gestiona desde un solo panel administrativo.",
  },
  {
    q: "¿Cómo funciona el periodo de prueba?",
    a: "Tienes 14 días de acceso completo al plan Profesional sin necesidad de tarjeta de crédito. Al terminar, te preguntaremos si deseas continuar y qué plan se adapta mejor a ti.",
  },
  {
    q: "¿Ofrecen soporte en español?",
    a: "Sí, todo el soporte es en español. Chat en vivo de lunes a viernes 8am–8pm hora CDMX, email 24/7 con respuesta en menos de 4 horas, y videollamadas de onboarding incluidas en todos los planes pagados.",
  },
  {
    q: "¿Puedo cancelar en cualquier momento?",
    a: "Sí, sin penalizaciones ni trámites complicados. Cancelas desde la configuración de tu cuenta en menos de un minuto. Conservas acceso hasta el final del período facturado.",
  },
  {
    q: "¿El portal del paciente tiene costo adicional?",
    a: "No. El portal del paciente está incluido en el plan Profesional y Clínica sin costo adicional. Tus pacientes pueden confirmar citas, ver indicaciones y pagar en línea desde su celular.",
  },
];

export function FAQ() {
  return (
    <section className="section-pad bg-slate-50">
      <div className="max-w-3xl mx-auto px-6">
        <SectionHeader
          eyebrow="Preguntas frecuentes"
          title="Todo lo que necesitas saber"
          subtitle="¿Tienes más preguntas? Escríbenos al chat o a hola@mediflow.com"
          centered
          className="mb-12"
        />

        <Accordion type="single" collapsible className="bg-white rounded-2xl border border-border overflow-hidden px-6">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left">{faq.q}</AccordionTrigger>
              <AccordionContent>{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
