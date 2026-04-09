import Link from "next/link";
import {
  Stethoscope, Heart, Apple, Brain, Scan, Activity, Footprints,
  Sparkles, Scissors, Star, Eye, Hand, Zap, Leaf, Palette, Waves,
  Calendar, FileText, Receipt, UserCircle, Camera, Package,
  BarChart3, Warehouse, Check, ArrowRight, MessageCircle, Shield,
  ChevronRight,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const SALUD = [
  { icon: Stethoscope, name: "Dental", desc: "Odontograma, periodontograma y radiografías digitales.", color: "text-blue-400", bg: "bg-blue-900/30", href: "/dental" },
  { icon: Heart, name: "Medicina General", desc: "Consulta con CIE-10, vitales y prescripciones.", color: "text-rose-400", bg: "bg-rose-900/30", href: "/medicina-general" },
  { icon: Apple, name: "Nutrición", desc: "Planes alimenticios, IMC y seguimiento de peso.", color: "text-green-400", bg: "bg-green-900/30", href: "/nutricion" },
  { icon: Brain, name: "Psicología", desc: "Notas SOAP/BIRP, escalas PHQ-9 y plan terapéutico.", color: "text-violet-400", bg: "bg-violet-900/30", href: "/psicologia" },
  { icon: Scan, name: "Dermatología", desc: "Registro fotográfico de lesiones y tratamientos.", color: "text-amber-400", bg: "bg-amber-900/30", href: "/dermatologia" },
  { icon: Activity, name: "Fisioterapia", desc: "Ejercicios personalizados, ROM y evolución.", color: "text-teal-400", bg: "bg-teal-900/30", href: "/fisioterapia" },
  { icon: Footprints, name: "Podología", desc: "Evaluación podológica, ortesis y pie diabético.", color: "text-orange-400", bg: "bg-orange-900/30", href: "/podologia" },
];

const ESTETICA = [
  { icon: Sparkles, name: "Medicina Estética", desc: "Botox, fillers, PRP y protocolos faciales.", color: "text-purple-400", bg: "bg-purple-900/30", href: "/medicina-estetica" },
  { icon: Scissors, name: "Clínicas Capilares", desc: "Trasplante capilar, PRP y seguimiento folicular.", color: "text-indigo-400", bg: "bg-indigo-900/30", href: "/clinicas-capilares" },
];

const BELLEZA = [
  { icon: Star, name: "Centros de Estética", desc: "Faciales, corporales y aparatología avanzada.", color: "text-pink-400", bg: "bg-pink-900/30", href: "/centros-estetica" },
  { icon: Eye, name: "Cejas y Pestañas", desc: "Microblading, extensiones y diseño personalizado.", color: "text-fuchsia-400", bg: "bg-fuchsia-900/30", href: "/cejas-pestanas" },
  { icon: Hand, name: "Masajes", desc: "Terapéuticos, deportivos y relajantes.", color: "text-emerald-400", bg: "bg-emerald-900/30", href: "/masajes" },
  { icon: Zap, name: "Depilación Láser", desc: "Control por zona, sesiones y fototipos.", color: "text-yellow-400", bg: "bg-yellow-900/30", href: "/depilacion-laser" },
  { icon: Scissors, name: "Peluquerías", desc: "Colorimetría, fórmulas y agenda por servicio.", color: "text-cyan-400", bg: "bg-cyan-900/30", href: "/peluquerias" },
  { icon: Leaf, name: "Medicina Alternativa", desc: "Acupuntura, herbolaria y terapias holísticas.", color: "text-lime-400", bg: "bg-lime-900/30", href: "/medicina-alternativa" },
  { icon: Palette, name: "Uñas", desc: "Manicura, pedicura, gel, acrílico y nail art.", color: "text-red-400", bg: "bg-red-900/30", href: "/unas" },
  { icon: Waves, name: "Spas", desc: "Circuitos de agua, envolturas y paquetes relax.", color: "text-sky-400", bg: "bg-sky-900/30", href: "/spas" },
];

const FEATURES = [
  { icon: Calendar, title: "Agenda inteligente", desc: "Confirmación automática por WhatsApp. Cero dobles reservaciones.", color: "bg-blue-600" },
  { icon: FileText, title: "Expediente clínico", desc: "Formularios especializados por categoría con notas SOAP.", color: "bg-emerald-600" },
  { icon: Receipt, title: "Facturación CFDI 4.0", desc: "Timbrado automático, pagos a plazos y reportes fiscales.", color: "bg-violet-600" },
  { icon: UserCircle, title: "Portal del paciente", desc: "Citas, historial y pagos — acceso seguro por link.", color: "bg-orange-600" },
  { icon: Camera, title: "Fotos antes/después", desc: "Comparación visual por ángulo para documentar progreso.", color: "bg-pink-600" },
  { icon: Package, title: "Paquetes y bonos", desc: "Sesiones prepagadas con control de redención automático.", color: "bg-cyan-600" },
  { icon: Warehouse, title: "Inventario", desc: "Stock en tiempo real con alertas de mínimo y trazabilidad.", color: "bg-amber-600" },
  { icon: BarChart3, title: "Reportes y analytics", desc: "KPIs, revenue, churn y ocupación para decidir con datos.", color: "bg-rose-600" },
];

const PLANS = [
  {
    id: "BASIC", name: "Básico", price: "$499", per: "/mes",
    desc: "Para consultorios individuales",
    features: ["1 profesional", "200 pacientes", "Agenda completa", "Expediente clínico", "Facturación básica", "Soporte por email"],
    highlight: false,
  },
  {
    id: "PRO", name: "Profesional", price: "$999", per: "/mes",
    desc: "El más popular",
    features: ["Hasta 5 profesionales", "Pacientes ilimitados", "Todo lo del Básico", "Fotos antes/después", "Paquetes y membresías", "WhatsApp bidireccional", "Soporte prioritario"],
    highlight: true,
  },
  {
    id: "CLINIC", name: "Clínica", price: "$2,499", per: "/mes",
    desc: "Para equipos grandes",
    features: ["Profesionales ilimitados", "Todo lo del Profesional", "Múltiples sucursales", "Inventario avanzado", "Reportes y analytics", "API access", "Soporte 24/7"],
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    name: "Dra. María García", role: "Directora",
    clinic: "Clínica Dental Sonrisa · CDMX", stars: 5,
    quote: "Los expedientes digitales para odontología me ahorraron horas cada semana. Mis pacientes adoran el portal de citas.",
  },
  {
    name: "Lic. Andrea Torres", role: "Fundadora",
    clinic: "Centro de Estética Bella · Monterrey", stars: 5,
    quote: "Los paquetes y fotos antes/después son increíbles. La agenda con WhatsApp eliminó las inasistencias casi por completo.",
  },
  {
    name: "Dr. Carlos Mendoza", role: "Fisioterapeuta",
    clinic: "Fisioterapia Integral · Guadalajara", stars: 5,
    quote: "Los ejercicios personalizados y el seguimiento ROM me permiten dar un servicio de primer nivel.",
  },
];

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function SpecialtyCard({ icon: Icon, name, desc, color, bg, href }: { icon: any; name: string; desc: string; color: string; bg: string; href: string }) {
  return (
    <div className="group bg-slate-900/80 rounded-2xl p-5 border border-slate-700/50 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300">
      <div className={`w-11 h-11 ${bg} rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <h4 className="font-bold text-white mb-1 text-[15px]">{name}</h4>
      <p className="text-sm text-slate-400 leading-relaxed mb-3">{desc}</p>
      <Link href={href} className="text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors inline-flex items-center gap-1">
        Ver más <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-[Sora,sans-serif] overflow-x-hidden">

      {/* ---- NAVBAR ---- */}
      <nav className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2.5 font-extrabold text-lg mr-10">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-sm font-extrabold shadow-lg shadow-blue-500/25">M</div>
            <span className="text-white">MediFlow</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-300 flex-1">
            {/* Especialidades dropdown */}
            <div className="relative group">
              <a href="#especialidades" className="hover:text-white transition-colors font-medium py-4 inline-block">Especialidades</a>
              <div className="hidden group-hover:block absolute top-full left-0 w-[540px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/40 p-6 -ml-4">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Salud</h4>
                    <ul className="space-y-2">
                      {SALUD.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Medicina Estetica</h4>
                    <ul className="space-y-2">
                      {ESTETICA.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Belleza y Bienestar</h4>
                    <ul className="space-y-2">
                      {BELLEZA.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <a href="#funciones" className="hover:text-white transition-colors font-medium">Funciones</a>
            <a href="#precios" className="hover:text-white transition-colors font-medium">Precios</a>
            <a href="#contacto" className="hover:text-white transition-colors font-medium">Contacto</a>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <Link href="/login" className="text-sm font-semibold text-slate-300 hover:text-white transition-colors hidden sm:block">
              Iniciar sesion
            </Link>
            <Link href="/register" className="bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:shadow-lg hover:shadow-blue-500/25 transition-all hover:-translate-y-0.5">
              Comenzar gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* ---- HERO ---- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-900 to-slate-950">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-blue-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-violet-500/10 to-transparent rounded-full translate-y-1/2 -translate-x-1/4" />

        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-4 py-2 mb-8 backdrop-blur">
            <div className="flex -space-x-2">
              <div className="w-7 h-7 rounded-full bg-blue-500 border-2 border-slate-900" />
              <div className="w-7 h-7 rounded-full bg-emerald-500 border-2 border-slate-900" />
              <div className="w-7 h-7 rounded-full bg-violet-500 border-2 border-slate-900" />
            </div>
            <span className="text-sm font-semibold text-slate-200">Usado por <span className="text-blue-400">500+</span> clinicas en Mexico</span>
          </div>

          <h1 className="text-5xl lg:text-7xl font-extrabold mb-6 leading-[1.1] tracking-tight text-white">
            El software que tu
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              clinica necesita
            </span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Gestion integral para clinicas de salud, medicina estetica y belleza.
            Agenda, expedientes, facturacion y WhatsApp — todo en un solo lugar.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link
              href="/register"
              className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold px-8 py-4 rounded-2xl hover:shadow-xl hover:shadow-blue-500/25 transition-all text-lg hover:-translate-y-0.5 flex items-center justify-center gap-2"
            >
              Comenzar gratis <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#especialidades"
              className="w-full sm:w-auto border-2 border-white/20 text-white font-semibold px-8 py-4 rounded-2xl hover:border-blue-400 hover:text-blue-400 transition-all text-lg text-center"
            >
              Ver especialidades
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14">
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white">500+</div>
              <div className="text-sm text-slate-400 font-medium">clinicas activas</div>
            </div>
            <div className="w-px h-10 bg-white/10 hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white">50,000+</div>
              <div className="text-sm text-slate-400 font-medium">pacientes gestionados</div>
            </div>
            <div className="w-px h-10 bg-white/10 hidden sm:block" />
            <div className="text-center">
              <div className="text-3xl font-extrabold text-white">18</div>
              <div className="text-sm text-slate-400 font-medium">especialidades</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- ESPECIALIDADES ---- */}
      <section id="especialidades" className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-blue-500/10 text-blue-400 text-sm font-bold px-4 py-1.5 rounded-full mb-4 border border-blue-500/20">
              <Stethoscope className="w-4 h-4" /> 18 especialidades
            </div>
            <h2 className="text-4xl font-extrabold mb-4 text-white">Disenado para tu especialidad</h2>
            <p className="text-slate-400 max-w-xl mx-auto text-lg">
              Cada categoria tiene formularios clinicos, herramientas y flujos unicos.
            </p>
          </div>

          {/* SALUD */}
          <div className="mb-14">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-blue-900/40 flex items-center justify-center">
                <Heart className="w-4 h-4 text-blue-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Salud</h3>
              <div className="h-px bg-slate-800 flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {SALUD.map((s) => <SpecialtyCard key={s.name} {...s} />)}
            </div>
          </div>

          {/* MEDICINA ESTETICA */}
          <div className="mb-14">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-purple-900/40 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-purple-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Medicina Estetica</h3>
              <div className="h-px bg-slate-800 flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ESTETICA.map((s) => <SpecialtyCard key={s.name} {...s} />)}
            </div>
          </div>

          {/* BELLEZA Y BIENESTAR */}
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-lg bg-pink-900/40 flex items-center justify-center">
                <Star className="w-4 h-4 text-pink-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Belleza y Bienestar</h3>
              <div className="h-px bg-slate-800 flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {BELLEZA.map((s) => <SpecialtyCard key={s.name} {...s} />)}
            </div>
          </div>
        </div>
      </section>

      {/* ---- FUNCIONES ---- */}
      <section id="funciones" className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 text-sm font-bold px-4 py-1.5 rounded-full mb-4 border border-emerald-500/20">
              <Shield className="w-4 h-4" /> Todo incluido
            </div>
            <h2 className="text-4xl font-extrabold mb-4 text-white">Todo lo que necesitas en un solo lugar</h2>
            <p className="text-slate-400 max-w-xl mx-auto text-lg">
              Herramientas potentes que reemplazan hojas de calculo, cuadernos y apps separadas.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-blue-500/30 hover:bg-white/[0.07] transition-all duration-300"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 ${f.color} rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-110 transition-transform`}>
                    <f.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white mb-1 text-[15px]">{f.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- COMO FUNCIONA ---- */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-extrabold mb-4 text-white">Empieza en 3 pasos</h2>
            <p className="text-slate-400 text-lg">Configura tu clinica en menos de 5 minutos.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: "1", title: "Crea tu cuenta", desc: "Elige tu especialidad, nombra tu clinica y registra tu primer profesional.", icon: UserCircle },
              { step: "2", title: "Configura tu agenda", desc: "Define horarios, servicios y conecta WhatsApp para recordatorios automaticos.", icon: Calendar },
              { step: "3", title: "Recibe pacientes", desc: "Agenda citas, crea expedientes y factura — todo desde un solo panel.", icon: Check },
            ].map((s) => (
              <div key={s.step} className="text-center relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center mx-auto mb-5 shadow-xl shadow-blue-500/20">
                  <s.icon className="w-7 h-7 text-white" />
                </div>
                <div className="absolute top-2 left-1/2 -translate-x-1/2 -translate-y-full text-6xl font-extrabold text-white/5 select-none pointer-events-none">{s.step}</div>
                <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- PRECIOS ---- */}
      <section id="precios" className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-violet-500/10 text-violet-400 text-sm font-bold px-4 py-1.5 rounded-full mb-4 border border-violet-500/20">
              14 dias gratis
            </div>
            <h2 className="text-4xl font-extrabold mb-4 text-white">Precios simples y transparentes</h2>
            <p className="text-slate-400 text-lg">Sin tarjeta de credito. Cancela cuando quieras.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start max-w-5xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-2xl p-8 border-2 flex flex-col relative ${
                  plan.highlight
                    ? "bg-brand-900/20 border-brand-500 lg:scale-105 lg:-my-4 shadow-xl shadow-brand-500/10"
                    : "bg-slate-900 border-slate-700 hover:border-slate-600 transition-colors"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-violet-600 text-white text-xs font-bold px-5 py-1.5 rounded-full whitespace-nowrap shadow-lg">
                    Mas popular
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-bold text-white text-lg mb-0.5">{plan.name}</h3>
                  <p className="text-sm text-slate-400">{plan.desc}</p>
                </div>
                <div className="mb-6">
                  <span className="text-5xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-slate-400 text-sm font-medium">{plan.per}</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/register?plan=${plan.id}`}
                  className={`w-full text-center font-bold py-3.5 rounded-xl transition-all text-sm block ${
                    plan.highlight
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:shadow-lg hover:shadow-blue-500/25 hover:-translate-y-0.5"
                      : "border-2 border-slate-600 text-slate-300 hover:border-blue-400 hover:text-blue-400"
                  }`}
                >
                  Empezar 14 dias gratis
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center mt-8 text-sm text-slate-500">
            Precios en MXN. Aceptamos tarjeta de credito/debito y transferencia SPEI.
          </p>
        </div>
      </section>

      {/* ---- TESTIMONIOS ---- */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-extrabold mb-4 text-white">Lo que dicen nuestros clientes</h2>
            <p className="text-slate-400 text-lg">Profesionales reales que transformaron su practica.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="bg-slate-900 border border-slate-700 rounded-2xl p-7 flex flex-col hover:border-slate-600 transition-colors"
              >
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-300 leading-relaxed mb-6 flex-1">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div>
                  <div className="font-bold text-white text-sm">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.role} · {t.clinic}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- WHATSAPP BADGE ---- */}
      <section className="py-16 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-10 sm:p-14 flex flex-col md:flex-row items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
                <MessageCircle className="w-10 h-10 text-white" />
              </div>
            </div>
            <div className="text-center md:text-left flex-1">
              <h3 className="text-2xl font-extrabold text-white mb-2">WhatsApp bidireccional incluido</h3>
              <p className="text-emerald-100 text-lg">
                Tus pacientes confirman o cancelan respondiendo &quot;si&quot; o &quot;no&quot;. Sin apps extra, sin complicaciones.
              </p>
            </div>
            <Link
              href="/register"
              className="bg-white text-emerald-700 font-bold px-8 py-4 rounded-2xl hover:shadow-lg transition-all flex-shrink-0 text-lg"
            >
              Probarlo gratis
            </Link>
          </div>
        </div>
      </section>

      {/* ---- CTA FINAL ---- */}
      <section className="py-24 bg-gradient-to-br from-brand-900 to-violet-900">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl lg:text-5xl font-extrabold mb-5 text-white leading-tight">
            Empieza hoy — 14 dias gratis
          </h2>
          <p className="text-xl text-blue-200 mb-10 max-w-lg mx-auto">
            Sin tarjeta de credito. Configura tu clinica en 5 minutos.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold px-10 py-4 rounded-2xl text-lg hover:shadow-2xl hover:shadow-white/20 transition-all hover:-translate-y-0.5"
          >
            Crear cuenta gratis <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ---- FOOTER ---- */}
      <footer id="contacto" className="bg-slate-950 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 font-extrabold text-lg mb-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-sm font-extrabold">M</div>
                MediFlow
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Software de gestion para clinicas de salud, estetica y belleza en Mexico.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4">Especialidades</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><Link href="/dental" className="hover:text-white transition-colors">Dental</Link></li>
                <li><Link href="/medicina-general" className="hover:text-white transition-colors">Medicina General</Link></li>
                <li><Link href="/nutricion" className="hover:text-white transition-colors">Nutricion</Link></li>
                <li><Link href="/psicologia" className="hover:text-white transition-colors">Psicologia</Link></li>
                <li><Link href="/medicina-estetica" className="hover:text-white transition-colors">Medicina Estetica</Link></li>
                <li><Link href="/fisioterapia" className="hover:text-white transition-colors">Fisioterapia</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4">Mas categorias</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><Link href="/depilacion-laser" className="hover:text-white transition-colors">Depilacion Laser</Link></li>
                <li><Link href="/peluquerias" className="hover:text-white transition-colors">Peluquerias</Link></li>
                <li><Link href="/cejas-pestanas" className="hover:text-white transition-colors">Cejas y Pestanas</Link></li>
                <li><Link href="/unas" className="hover:text-white transition-colors">Unas</Link></li>
                <li><Link href="/spas" className="hover:text-white transition-colors">Spas</Link></li>
                <li><Link href="/podologia" className="hover:text-white transition-colors">Podologia</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4">Producto</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="#funciones" className="hover:text-white transition-colors">Funciones</a></li>
                <li><a href="#precios" className="hover:text-white transition-colors">Precios</a></li>
                <li><a href="#especialidades" className="hover:text-white transition-colors">Especialidades</a></li>
                <li><Link href="/clinicas" className="hover:text-white transition-colors">Directorio</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4">Contacto</h4>
              <ul className="space-y-2 text-sm text-slate-400">
                <li><a href="mailto:hola@mediflow.app" className="hover:text-white transition-colors">hola@mediflow.app</a></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">Privacidad</Link></li>
                <li><Link href="/terms" className="hover:text-white transition-colors">Terminos</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-12 pt-8 text-center text-sm text-slate-500">
            &copy; 2026 MediFlow. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
