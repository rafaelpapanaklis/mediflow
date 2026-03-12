import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/shared/section-header";
import { CTABanner } from "@/components/public/cta-banner";

export const metadata: Metadata = {
  title: "Características — MediFlow",
  description: "Descubre todas las funcionalidades de MediFlow para gestionar tu clínica.",
};

const featureGroups = [
  {
    icon: "👥",
    title: "Gestión de Pacientes",
    color: "text-brand-600",
    bg: "bg-brand-50",
    border: "border-brand-100",
    features: [
      { name: "Expediente clínico completo", desc: "Historia clínica, alergias, medicamentos, antecedentes familiares y notas SOAP estructuradas." },
      { name: "Importación masiva", desc: "Importa tus pacientes desde Excel o CSV en minutos. Migración asistida disponible." },
      { name: "Segmentación con etiquetas", desc: "Clasifica pacientes por tipo de tratamiento, prioridad, estado o cualquier criterio personalizado." },
      { name: "Portal del paciente", desc: "Tus pacientes ven sus citas, indicaciones, facturas y pueden confirmar desde su celular." },
      { name: "Búsqueda inteligente", desc: "Encuentra cualquier paciente por nombre, teléfono, email o número de expediente en milisegundos." },
      { name: "Historial de archivos", desc: "Adjunta radiografías, fotografías, resultados de laboratorio y documentos al expediente." },
    ],
  },
  {
    icon: "📅",
    title: "Agenda y Citas",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-100",
    features: [
      { name: "Vista día, semana y mes", desc: "Visualiza y gestiona tu agenda en la vista que prefieras. Arrastra y suelta para reagendar." },
      { name: "Recordatorios WhatsApp", desc: "Mensajes automáticos 24h y 2h antes. Reduce los no-show hasta en un 80%." },
      { name: "Confirmación en 1 clic", desc: "El paciente confirma desde WhatsApp sin necesidad de llamar ni iniciar sesión en ningún lugar." },
      { name: "Multi-doctor", desc: "Gestiona las agendas de todos los doctores desde un solo panel. Filtros por profesional y consultorio." },
      { name: "Lista de espera", desc: "Cuando se cancela una cita, el sistema notifica automáticamente a los pacientes en espera." },
      { name: "Disponibilidad online", desc: "Los pacientes pueden solicitar cita desde el portal. Tú apruebas con un clic." },
    ],
  },
  {
    icon: "📋",
    title: "Expediente Clínico",
    color: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-100",
    features: [
      { name: "Notas SOAP con IA", desc: "Dicta o escribe y la IA estructura tu nota. Ahorra hasta 15 minutos por consulta." },
      { name: "Diagnósticos CIE-10", desc: "Base de datos completa de diagnósticos. Búsqueda por nombre o código." },
      { name: "Recetas digitales", desc: "Genera recetas con QR verificable. El paciente la descarga desde su portal." },
      { name: "Privacidad por rol", desc: "El personal administrativo no puede ver notas clínicas. Configura cada permiso." },
      { name: "Odontograma interactivo", desc: "32 dientes con estado por superficie. Click para editar, presupuesto automático." },
      { name: "Escalas psicológicas", desc: "PHQ-9, GAD-7, Beck y más integradas. Resultados guardados en el expediente." },
    ],
  },
  {
    icon: "💳",
    title: "Facturación y Pagos",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-100",
    features: [
      { name: "Facturas en segundos", desc: "Crea y envía facturas por email o WhatsApp. PDF profesional con tu logo." },
      { name: "Cobro en línea", desc: "Link de pago con Stripe. El paciente paga con tarjeta desde cualquier dispositivo." },
      { name: "Pagos parciales", desc: "Registra abonos y controla el saldo pendiente de cada paciente fácilmente." },
      { name: "Múltiples métodos", desc: "Efectivo, tarjeta, transferencia, pago en línea. Todo registrado y reconciliado." },
      { name: "Descuentos y promociones", desc: "Aplica descuentos porcentuales o fijos por paciente o tratamiento." },
      { name: "Recordatorio de deuda", desc: "Envía recordatorios automáticos a pacientes con saldo pendiente." },
    ],
  },
  {
    icon: "📈",
    title: "Reportes y Analytics",
    color: "text-cyan-600",
    bg: "bg-cyan-50",
    border: "border-cyan-100",
    features: [
      { name: "Dashboard en tiempo real", desc: "Ingresos, citas, nuevos pacientes y KPIs clave actualizados al instante." },
      { name: "Reportes de ingresos", desc: "Por día, semana, mes, doctor o tipo de tratamiento. Exporta en PDF o Excel." },
      { name: "Análisis de tratamientos", desc: "Descubre tus tratamientos más rentables y optimiza tu oferta de servicios." },
      { name: "Tasa de retención", desc: "Identifica pacientes que no han regresado y activa campañas de reactivación." },
      { name: "Performance por doctor", desc: "Compara ingresos, citas y satisfacción por profesional. Útil para equipos." },
      { name: "Proyecciones", desc: "Basadas en tu histórico, el sistema proyecta tus ingresos del próximo mes." },
    ],
  },
  {
    icon: "🔗",
    title: "Integraciones",
    color: "text-pink-600",
    bg: "bg-pink-50",
    border: "border-pink-100",
    features: [
      { name: "WhatsApp Business", desc: "Integración oficial. Recordatorios, confirmaciones y mensajes desde el dashboard." },
      { name: "Stripe Pagos", desc: "Cobra en línea con la plataforma de pagos más confiable del mundo." },
      { name: "Google Calendar", desc: "Sincroniza tu agenda de MediFlow con Google Calendar automáticamente." },
      { name: "Zoom / Telemedicina", desc: "Genera links de videoconsulta y llévalos al expediente del paciente." },
      { name: "CFDI / Factura electrónica", desc: "Emisión de CFDI para México integrada. Compatible con los principales PACs." },
      { name: "API REST", desc: "Conecta MediFlow con cualquier sistema externo usando nuestra API documentada." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      {/* Hero */}
      <section className="hero-bg pt-20 pb-16 px-6">
        <div className="container-tight text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3.5 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-600" />
            <span className="text-xs font-semibold text-brand-700 uppercase tracking-wider">Funcionalidades completas</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight leading-tight mb-5">
            Todo lo que tu clínica{" "}
            <span className="gradient-text">necesita</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            MediFlow es la plataforma más completa para gestión clínica en español.
            Cada función diseñada con profesionales de la salud reales.
          </p>
          <div className="flex gap-3 justify-center">
            <Button size="lg" asChild>
              <Link href="/register">Empieza gratis →</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/pricing">Ver precios</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Feature groups */}
      <section className="py-20 px-6 bg-white">
        <div className="container-tight space-y-20">
          {featureGroups.map((group) => (
            <div key={group.title}>
              <div className="flex items-center gap-3 mb-8">
                <div className={`w-11 h-11 rounded-xl ${group.bg} border ${group.border} flex items-center justify-center text-2xl`}>
                  {group.icon}
                </div>
                <h2 className={`text-2xl font-extrabold ${group.color}`}>{group.title}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.features.map((f) => (
                  <div
                    key={f.name}
                    className="rounded-xl border border-border bg-card p-5 hover:shadow-card-md transition-all duration-200"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-600 flex-shrink-0" />
                      <h3 className="text-sm font-bold text-foreground">{f.name}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <CTABanner />
    </>
  );
}
