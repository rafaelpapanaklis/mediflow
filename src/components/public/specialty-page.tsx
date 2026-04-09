import Link from "next/link";
import {
  Stethoscope, Heart, Apple, Brain, Scan, Activity, Footprints,
  Sparkles, Scissors, Star, Eye, Hand, Zap, Leaf, Palette, Waves,
  Check, ArrowRight, ChevronRight, MessageCircle, Shield,
  Calendar, FileText, Receipt, UserCircle, Camera, Package,
  BarChart3, Warehouse,
} from "lucide-react";
import type { Metadata } from "next";

/* ------------------------------------------------------------------ */
/*  SHARED DATA (same plans used across all specialty pages)           */
/* ------------------------------------------------------------------ */

const PLANS = [
  {
    id: "BASIC", name: "Basico", price: "$499", per: "/mes",
    desc: "Para consultorios individuales",
    features: ["1 profesional", "200 pacientes", "Agenda completa", "Expediente clinico", "Facturacion basica", "Soporte por email"],
    highlight: false,
  },
  {
    id: "PRO", name: "Profesional", price: "$999", per: "/mes",
    desc: "El mas popular",
    features: ["Hasta 5 profesionales", "Pacientes ilimitados", "Todo lo del Basico", "Fotos antes/despues", "Paquetes y membresias", "WhatsApp bidireccional", "Soporte prioritario"],
    highlight: true,
  },
  {
    id: "CLINIC", name: "Clinica", price: "$2,499", per: "/mes",
    desc: "Para equipos grandes",
    features: ["Profesionales ilimitados", "Todo lo del Profesional", "Multiples sucursales", "Inventario avanzado", "Reportes y analytics", "API access", "Soporte 24/7"],
    highlight: false,
  },
];

/* ------------------------------------------------------------------ */
/*  NAV LINKS (specialty dropdown data)                                */
/* ------------------------------------------------------------------ */

const NAV_SALUD = [
  { name: "Dental", href: "/dental" },
  { name: "Medicina General", href: "/medicina-general" },
  { name: "Nutricion", href: "/nutricion" },
  { name: "Psicologia", href: "/psicologia" },
  { name: "Dermatologia", href: "/dermatologia" },
  { name: "Fisioterapia", href: "/fisioterapia" },
  { name: "Podologia", href: "/podologia" },
];

const NAV_ESTETICA = [
  { name: "Medicina Estetica", href: "/medicina-estetica" },
  { name: "Clinicas Capilares", href: "/clinicas-capilares" },
];

const NAV_BELLEZA = [
  { name: "Centros de Estetica", href: "/centros-estetica" },
  { name: "Cejas y Pestanas", href: "/cejas-pestanas" },
  { name: "Masajes", href: "/masajes" },
  { name: "Depilacion Laser", href: "/depilacion-laser" },
  { name: "Peluquerias", href: "/peluquerias" },
  { name: "Medicina Alternativa", href: "/medicina-alternativa" },
  { name: "Unas", href: "/unas" },
  { name: "Spas", href: "/spas" },
];

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

export interface SpecialtyPageProps {
  name: string;
  slug: string;
  description: string;
  icon: any;
  iconColor: string;
  bgColor: string;
  features: { title: string; desc: string }[];
  metaTitle: string;
  metaDescription: string;
}

/* ------------------------------------------------------------------ */
/*  HELPER: generate metadata                                          */
/* ------------------------------------------------------------------ */

export function buildSpecialtyMetadata(props: Pick<SpecialtyPageProps, "metaTitle" | "metaDescription">): Metadata {
  return {
    title: props.metaTitle,
    description: props.metaDescription,
  };
}

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                          */
/* ------------------------------------------------------------------ */

export default function SpecialtyPage({ name, slug, description, icon: Icon, iconColor, bgColor, features }: SpecialtyPageProps) {
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
            <div className="relative group">
              <Link href="/#especialidades" className="hover:text-white transition-colors font-medium py-4 inline-block">Especialidades</Link>
              <div className="hidden group-hover:block absolute top-full left-0 w-[540px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/40 p-6 -ml-4">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Salud</h4>
                    <ul className="space-y-2">
                      {NAV_SALUD.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Medicina Estetica</h4>
                    <ul className="space-y-2">
                      {NAV_ESTETICA.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Belleza y Bienestar</h4>
                    <ul className="space-y-2">
                      {NAV_BELLEZA.map(s => (
                        <li key={s.href}><Link href={s.href} className="text-sm text-slate-300 hover:text-white transition-colors">{s.name}</Link></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <Link href="/#funciones" className="hover:text-white transition-colors font-medium">Funciones</Link>
            <Link href="/#precios" className="hover:text-white transition-colors font-medium">Precios</Link>
            <Link href="/#contacto" className="hover:text-white transition-colors font-medium">Contacto</Link>
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
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-blue-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 text-center relative z-10">
          <div className={`w-20 h-20 ${bgColor} rounded-3xl flex items-center justify-center mx-auto mb-6`}>
            <Icon className={`w-10 h-10 ${iconColor}`} />
          </div>
          <h1 className="text-4xl lg:text-6xl font-extrabold mb-6 leading-[1.1] tracking-tight text-white">
            Software para{" "}
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              {name}
            </span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            {description}
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold px-8 py-4 rounded-2xl hover:shadow-xl hover:shadow-blue-500/25 transition-all text-lg hover:-translate-y-0.5"
          >
            Comenzar gratis <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ---- FEATURES ---- */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-extrabold mb-4 text-white">
              Herramientas especializadas para {name}
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto text-lg">
              Funcionalidades disenadas para optimizar tu consulta diaria.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-blue-500/30 hover:bg-white/[0.07] transition-all duration-300"
              >
                <div className={`w-11 h-11 ${bgColor} rounded-xl flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <h3 className="font-bold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- PRECIOS ---- */}
      <section className="py-24 bg-slate-950">
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
      <footer className="bg-slate-950 border-t border-slate-800">
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
                <li><Link href="/#funciones" className="hover:text-white transition-colors">Funciones</Link></li>
                <li><Link href="/#precios" className="hover:text-white transition-colors">Precios</Link></li>
                <li><Link href="/#especialidades" className="hover:text-white transition-colors">Especialidades</Link></li>
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
