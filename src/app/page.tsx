import Link from "next/link";
import {
  Stethoscope,
  Heart,
  Apple,
  Brain,
  Scan,
  Activity,
  Footprints,
  Sparkles,
  Scissors,
  Star,
  Eye,
  Hand,
  Zap,
  Leaf,
  Palette,
  Waves,
  Calendar,
  FileText,
  Receipt,
  UserCircle,
  Camera,
  Package,
  BarChart3,
  Warehouse,
  Check,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const SALUD = [
  { icon: Stethoscope, name: "Dental", desc: "Odontograma, planes de tratamiento y evaluación periodontal." },
  { icon: Heart, name: "Medicina General", desc: "Consulta integral con CIE-10, signos vitales y prescripción." },
  { icon: Apple, name: "Nutrición", desc: "Planes alimenticios, cálculo de IMC/TMB y seguimiento de peso." },
  { icon: Brain, name: "Psicología", desc: "Notas SOAP/BIRP, escalas PHQ-9, plan terapéutico con metas." },
  { icon: Scan, name: "Dermatología", desc: "Registro fotográfico de lesiones y seguimiento de tratamientos." },
  { icon: Activity, name: "Fisioterapia", desc: "Ejercicios personalizados, seguimiento ROM y evolución." },
  { icon: Footprints, name: "Podología", desc: "Evaluación podológica, plantillas y tratamiento de uñas." },
];

const ESTETICA = [
  { icon: Sparkles, name: "Medicina Estética", desc: "Toxina botulínica, rellenos, protocolos faciales y corporales." },
  { icon: Scissors, name: "Clínicas Capilares", desc: "Tricología, trasplante capilar, PRP y seguimiento folicular." },
];

const BELLEZA = [
  { icon: Star, name: "Centros de Estética", desc: "Tratamientos faciales, corporales y aparatología avanzada." },
  { icon: Eye, name: "Cejas y Pestañas", desc: "Microblading, lifting, extensiones y diseño personalizado." },
  { icon: Hand, name: "Masajes", desc: "Terapéuticos, deportivos, relajantes y piedras calientes." },
  { icon: Zap, name: "Depilación Láser", desc: "Control de sesiones por zona, tipos de láser y fototipos." },
  { icon: Scissors, name: "Peluquerías", desc: "Agenda por servicio, colorimetría y fidelización de clientes." },
  { icon: Leaf, name: "Medicina Alternativa", desc: "Acupuntura, homeopatía, naturopatía y terapias holísticas." },
  { icon: Palette, name: "Uñas", desc: "Manicura, pedicura, acrílico, gel y nail art con agenda." },
  { icon: Waves, name: "Spas", desc: "Circuitos de agua, masajes, envolturas y paquetes de relax." },
];

const FEATURES = [
  { icon: Calendar, title: "Agenda inteligente", desc: "Confirmación automática por WhatsApp, recordatorios, sin dobles reservaciones." },
  { icon: FileText, title: "Expediente clínico digital", desc: "Formularios especializados por categoría con notas SOAP." },
  { icon: Receipt, title: "Facturación CFDI 4.0", desc: "Timbrado automático, pagos a plazos, reportes fiscales." },
  { icon: UserCircle, title: "Portal del paciente", desc: "Citas, historial, pagos — acceso seguro por link." },
  { icon: Camera, title: "Fotos antes/después", desc: "Documenta progreso con comparación visual por ángulo." },
  { icon: Package, title: "Paquetes y membresías", desc: "Sesiones prepagadas, bonos, control de redención." },
  { icon: Warehouse, title: "Inventario", desc: "Stock en tiempo real, alertas de mínimo, trazabilidad." },
  { icon: BarChart3, title: "Reportes y analytics", desc: "KPIs, revenue, churn, ocupación — decisiones con datos." },
];

const PLANS = [
  {
    id: "BASIC",
    name: "Básico",
    price: "$499",
    desc: "Consultorio individual",
    features: ["1 profesional", "200 pacientes", "Agenda completa", "Expediente clínico", "Facturación básica", "Soporte por email"],
    highlight: false,
  },
  {
    id: "PRO",
    name: "Profesional",
    price: "$999",
    desc: "El más popular",
    features: ["Hasta 5 profesionales", "Pacientes ilimitados", "Todo lo del Básico", "Fotos antes/después", "Paquetes y membresías", "Soporte prioritario"],
    highlight: true,
  },
  {
    id: "CLINIC",
    name: "Clínica",
    price: "$2,499",
    desc: "Equipos grandes",
    features: ["Profesionales ilimitados", "Todo lo del Profesional", "Múltiples sucursales", "Inventario avanzado", "Reportes y analytics", "Soporte 24/7"],
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    name: "Dra. María García",
    clinic: "Clínica Dental Sonrisa, CDMX",
    stars: 5,
    quote: "MediFlow transformó cómo gestiono mi consultorio. Los expedientes digitales especializados para odontología me ahorraron horas cada semana y mis pacientes adoran el portal de citas.",
  },
  {
    name: "Lic. Andrea Torres",
    clinic: "Centro de Estética Bella, Monterrey",
    stars: 5,
    quote: "Los paquetes y fotos antes/después son increíbles. Mis clientas ven su progreso y renuevan sin pensarlo. La agenda con WhatsApp eliminó las inasistencias casi por completo.",
  },
  {
    name: "Dr. Carlos Mendoza",
    clinic: "Fisioterapia Integral, Guadalajara",
    stars: 5,
    quote: "Los ejercicios personalizados y el seguimiento ROM me permiten dar un servicio de primer nivel. Mis pacientes reciben su plan por link y eso mejora la adherencia al tratamiento.",
  },
];

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                          */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-[Sora,sans-serif]">

      {/* ───────────────── NAVBAR ───────────────── */}
      <nav className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center">
          <Link href="/" className="flex items-center gap-2 font-extrabold text-lg mr-10">
            <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center text-white text-sm font-extrabold">M</div>
            MediFlow
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400 flex-1">
            <a href="#especialidades" className="hover:text-white transition-colors">Especialidades</a>
            <a href="#funciones" className="hover:text-white transition-colors">Funciones</a>
            <a href="#precios" className="hover:text-white transition-colors">Precios</a>
            <a href="#contacto" className="hover:text-white transition-colors">Contacto</a>
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <Link href="/login" className="text-sm font-semibold text-slate-400 hover:text-white transition-colors hidden sm:block">
              Iniciar sesión
            </Link>
            <Link href="/register" className="bg-brand-600 text-white text-sm font-bold px-5 py-2 rounded-xl hover:bg-brand-700 transition-colors">
              Comenzar gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* ───────────────── HERO ───────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-900 to-slate-950">
        <div className="max-w-7xl mx-auto px-6 pt-24 pb-28 text-center relative z-10">
          <h1 className="text-5xl lg:text-7xl font-extrabold mb-6 leading-tight tracking-tight">
            El software que tu
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-violet-400 bg-clip-text text-transparent">
              clínica necesita
            </span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Gestión integral para clínicas de salud, medicina estética y belleza.
            <br className="hidden sm:block" />
            Todo en un solo lugar.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/register"
              className="w-full sm:w-auto bg-brand-600 text-white font-bold px-8 py-4 rounded-2xl hover:bg-brand-700 transition-colors text-lg"
            >
              Comenzar gratis
            </Link>
            <a
              href="#especialidades"
              className="w-full sm:w-auto border border-white/20 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/10 transition-colors text-lg text-center"
            >
              Ver especialidades
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-10 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-2xl">500+</span>
              <span>clínicas</span>
            </div>
            <div className="w-px h-6 bg-slate-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-2xl">50,000+</span>
              <span>pacientes</span>
            </div>
            <div className="w-px h-6 bg-slate-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-white text-2xl">18</span>
              <span>especialidades</span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── ESPECIALIDADES ───────────────── */}
      <section id="especialidades" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold mb-4">Diseñado para tu especialidad</h2>
          <p className="text-slate-400 max-w-xl mx-auto text-lg">
            Cada categoría tiene herramientas únicas. Elige la tuya.
          </p>
        </div>

        {/* SALUD */}
        <div className="mb-16">
          <h3 className="text-sm font-bold uppercase tracking-widest text-blue-400 mb-6 pl-1">Salud</h3>
          <div className="bg-blue-950/20 rounded-3xl p-6 sm:p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {SALUD.map((s) => (
                <div
                  key={s.name}
                  className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-5 hover:scale-105 hover:shadow-xl hover:shadow-brand-500/10 transition-all duration-200"
                >
                  <s.icon className="w-7 h-7 text-blue-400 mb-3" />
                  <h4 className="font-bold text-white mb-1">{s.name}</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MEDICINA ESTÉTICA */}
        <div className="mb-16">
          <h3 className="text-sm font-bold uppercase tracking-widest text-purple-400 mb-6 pl-1">Medicina Estética</h3>
          <div className="bg-purple-950/20 rounded-3xl p-6 sm:p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ESTETICA.map((s) => (
                <div
                  key={s.name}
                  className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-5 hover:scale-105 hover:shadow-xl hover:shadow-purple-500/10 transition-all duration-200"
                >
                  <s.icon className="w-7 h-7 text-purple-400 mb-3" />
                  <h4 className="font-bold text-white mb-1">{s.name}</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* BELLEZA Y BIENESTAR */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-pink-400 mb-6 pl-1">Belleza y Bienestar</h3>
          <div className="bg-pink-950/20 rounded-3xl p-6 sm:p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {BELLEZA.map((s) => (
                <div
                  key={s.name}
                  className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-5 hover:scale-105 hover:shadow-xl hover:shadow-pink-500/10 transition-all duration-200"
                >
                  <s.icon className="w-7 h-7 text-pink-400 mb-3" />
                  <h4 className="font-bold text-white mb-1">{s.name}</h4>
                  <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── FUNCIONES ───────────────── */}
      <section id="funciones" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold mb-4">Todo lo que necesitas en un solo lugar</h2>
          <p className="text-slate-400 max-w-xl mx-auto text-lg">
            Herramientas potentes que reemplazan hojas de cálculo, cuadernos y apps separadas.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-brand-500/40 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <f.icon className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1">{f.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────── PRECIOS ───────────────── */}
      <section id="precios" className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold mb-4">Precios simples y transparentes</h2>
          <p className="text-slate-400 text-lg">14 días gratis en cualquier plan. Sin tarjeta de crédito.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl p-8 border flex flex-col relative ${
                plan.highlight
                  ? "bg-brand-900/20 border-brand-500 lg:scale-105 lg:-my-4 shadow-xl shadow-brand-500/10"
                  : "bg-slate-900 border-slate-700"
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
                  Popular
                </div>
              )}
              <div className="mb-5">
                <h3 className="font-bold text-white text-lg mb-0.5">{plan.name}</h3>
                <p className="text-xs text-slate-400">{plan.desc}</p>
              </div>
              <div className="mb-6">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                <span className="text-slate-400 text-sm">/mes</span>
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
                className={`w-full text-center font-bold py-3 rounded-xl transition-colors text-sm block ${
                  plan.highlight
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "border border-slate-600 text-white hover:bg-slate-800"
                }`}
              >
                Empezar 14 días gratis
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center mt-8 text-sm text-slate-500">
          Precios en MXN. Aceptamos tarjeta de crédito/débito y transferencia SPEI.
        </p>
      </section>

      {/* ───────────────── TESTIMONIOS ───────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold mb-4">Lo que dicen nuestros clientes</h2>
          <p className="text-slate-400 text-lg">Profesionales reales que transformaron su práctica con MediFlow.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <div
              key={t.name}
              className="bg-slate-900 border border-slate-700 rounded-2xl p-7 flex flex-col"
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
                <div className="text-xs text-slate-500">{t.clinic}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────── CTA FINAL ───────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="bg-gradient-to-br from-brand-900 to-violet-900 rounded-3xl p-12 sm:p-16 text-center">
          <h2 className="text-4xl font-extrabold mb-4">Empieza hoy — 14 días gratis</h2>
          <p className="text-lg text-slate-300 mb-8 max-w-lg mx-auto">
            Sin tarjeta de crédito. Configura tu clínica en 5 minutos.
          </p>
          <Link
            href="/register"
            className="inline-block bg-white text-slate-950 font-bold px-10 py-4 rounded-2xl text-lg hover:bg-slate-100 transition-colors"
          >
            Crear cuenta gratis
          </Link>
        </div>
      </section>

      {/* ───────────────── FOOTER ───────────────── */}
      <footer id="contacto" className="border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
            {/* Logo */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 font-extrabold text-lg mb-3">
                <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center text-white text-sm font-extrabold">M</div>
                MediFlow
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Software de gestión para clínicas de salud, estética y belleza.
              </p>
            </div>

            {/* Especialidades */}
            <div>
              <h4 className="font-bold text-sm text-white mb-4">Especialidades</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li>Dental</li>
                <li>Medicina General</li>
                <li>Nutrición</li>
                <li>Psicología</li>
                <li>Medicina Estética</li>
                <li>Centros de Estética</li>
              </ul>
            </div>

            {/* Producto */}
            <div>
              <h4 className="font-bold text-sm text-white mb-4">Producto</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#funciones" className="hover:text-white transition-colors">Funciones</a></li>
                <li><a href="#precios" className="hover:text-white transition-colors">Precios</a></li>
                <li><a href="#especialidades" className="hover:text-white transition-colors">Especialidades</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-bold text-sm text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link href="/privacy" className="hover:text-white transition-colors">Privacidad</Link></li>
                <li><Link href="/terms" className="hover:text-white transition-colors">Términos</Link></li>
              </ul>
            </div>

            {/* Contacto */}
            <div>
              <h4 className="font-bold text-sm text-white mb-4">Contacto</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="mailto:hola@mediflow.app" className="hover:text-white transition-colors">hola@mediflow.app</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 mt-12 pt-8 text-center text-sm text-slate-600">
            &copy; 2026 MediFlow. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
