import Link from "next/link";
import Image from "next/image";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Header } from "@/components/public/landing/header";
import { Footer } from "@/components/public/landing/footer";
import { Pricing } from "@/components/public/landing/pricing";
import {
  SPECIALTIES,
  type SpecialtyContent,
  type Faq,
} from "@/lib/specialty-content";
import {
  SpecialtyHeroPattern,
  SpecialtyImageFallback,
} from "./specialty-hero-pattern";

interface Props {
  content: SpecialtyContent;
}

function resolveIcon(name: string): LucideIcon {
  const lib = LucideIcons as unknown as Record<string, LucideIcon>;
  return lib[name] ?? LucideIcons.Circle;
}

const accentByVariant = {
  salud:    { ring: "ring-blue-500/30",   chip: "bg-blue-500/10 text-blue-300 border-blue-500/30",       gradient: "from-blue-500 to-teal-500"   },
  estetica: { ring: "ring-violet-500/30", chip: "bg-violet-500/10 text-violet-300 border-violet-500/30", gradient: "from-violet-500 to-pink-500" },
  belleza:  { ring: "ring-rose-500/30",   chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",       gradient: "from-rose-500 to-amber-500"  },
} as const;

export function SpecialtyPage({ content }: Props) {
  const accent = accentByVariant[content.heroVariant];
  const MainIcon = resolveIcon(content.iconMainName);

  return (
    <div className="min-h-screen bg-[#0B0F1E] text-white antialiased">
      <Header />

      {/* ─────────── HERO ─────────── */}
      <section className="relative overflow-hidden border-b border-white/5">
        <SpecialtyHeroPattern variant={content.heroVariant} />
        <div className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-20 md:px-12 md:pt-32 md:pb-32">
          <div className="mx-auto max-w-3xl text-center">
            <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wider ${accent.chip}`}>
              <MainIcon className="h-3.5 w-3.5" />
              MediFlow para {content.nombre.toLowerCase()}
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              {content.heroTitle}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 md:text-xl">
              {content.heroSubtitle}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className={`inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r ${accent.gradient} px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-[1.02]`}
              >
                Empezar 14 días gratis
                <LucideIcons.ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#demo"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                Ver demo
                <LucideIcons.PlayCircle className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-5 text-xs text-slate-500">
              Sin tarjeta de crédito. Configura tu {content.category === "belleza" ? "centro" : "clínica"} en menos de 10 minutos.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────── DISEÑADO PARA X ─────────── */}
      <section className="border-b border-white/5 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2 md:items-center md:px-12">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Diseñado específicamente
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Pensado para {content.nombre.toLowerCase()}, no genérico
            </h2>
            <div className="mt-6 space-y-5 text-base leading-relaxed text-slate-300 md:text-lg">
              {content.designedFor.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl md:aspect-square">
            {content.unsplashAmbient ? (
              <Image
                src={content.unsplashAmbient}
                alt={`Ambiente profesional de ${content.nombre.toLowerCase()}`}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover"
                loading="lazy"
              />
            ) : (
              <SpecialtyImageFallback
                variant={content.heroVariant}
                ariaLabel={`Imagen ambiente de ${content.nombre.toLowerCase()}`}
                className="h-full w-full"
              />
            )}
          </div>
        </div>
      </section>

      {/* ─────────── FEATURES ─────────── */}
      <section className="border-b border-white/5 bg-white/[0.015] py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Funciones del dashboard
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Todo lo que tu {content.category === "belleza" ? "estudio" : "clínica"} necesita
            </h2>
            <p className="mt-4 text-base text-slate-400">
              Herramientas diseñadas para el flujo real de un profesional de {content.nombre.toLowerCase()}.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {content.features.map((f, i) => {
              const Icon = resolveIcon(f.iconName);
              return (
                <div
                  key={i}
                  className="group rounded-2xl border border-white/10 bg-[#111631] p-6 transition-all hover:border-white/20 hover:bg-[#141a3a]"
                >
                  <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${accent.gradient} text-white shadow-lg shadow-violet-500/20`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold text-white">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─────────── FORMULARIO CLÍNICO ─────────── */}
      <section className="border-b border-white/5 py-24 md:py-32">
        <div className="mx-auto max-w-4xl px-6 text-center md:px-12">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Expediente especializado
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {content.clinicalFormTitle}
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            {content.clinicalFormDescription}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {content.iconSecondaryNames.slice(0, 8).map((name, i) => {
              const Icon = resolveIcon(name);
              return (
                <span
                  key={i}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${accent.chip}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─────────── CASOS DE USO ─────────── */}
      <section className="relative border-b border-white/5 py-24 md:py-32">
        <div className="absolute inset-0 opacity-30">
          <SpecialtyHeroPattern variant={content.heroVariant} />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-6 md:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Casos de uso reales
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Cómo se ve un día normal
            </h2>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
            {content.useCases.map((u, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/10 bg-[#111631]/90 p-7 backdrop-blur-sm"
              >
                <div className={`mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border ${accent.chip} text-base font-bold`}>
                  {i + 1}
                </div>
                <h3 className="text-lg font-semibold text-white">{u.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{u.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── INTEGRACIONES ─────────── */}
      <section className="border-b border-white/5 py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Integraciones
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Conectado con lo que ya usas
            </h2>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            {content.integrations.map((name, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300"
              >
                <LucideIcons.Plug className="h-3.5 w-3.5 text-slate-500" />
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── PRICING (reusado) ─────────── */}
      <Pricing />

      {/* ─────────── FAQ ─────────── */}
      <section className="border-y border-white/5 py-24 md:py-32">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Preguntas frecuentes
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Lo que otros profesionales preguntaron antes
            </h2>
          </div>
          <div className="space-y-3">
            {content.faqs.map((f, i) => (
              <FaqItem key={i} faq={f} />
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── TESTIMONIO ─────────── */}
      <section className="border-b border-white/5 py-20 md:py-24">
        <div className="mx-auto max-w-3xl px-6 md:px-12">
          <div className="rounded-3xl border border-white/10 bg-[#111631] p-8 md:p-12">
            <LucideIcons.Quote className="mb-6 h-8 w-8 text-violet-400" />
            <p className="text-lg leading-relaxed text-slate-200 md:text-xl">
              {content.testimonial.text}
            </p>
            <div className="mt-8 flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${accent.gradient} text-base font-bold text-white`}>
                {content.testimonial.author
                  .split(" ")
                  .slice(0, 2)
                  .map((s) => s[0])
                  .join("")
                  .toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{content.testimonial.author}</p>
                <p className="text-xs text-slate-500">
                  {content.testimonial.role} · {content.testimonial.clinic}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── OTRAS ESPECIALIDADES ─────────── */}
      <section className="border-b border-white/5 py-20 md:py-24">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="mb-12 text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Otras especialidades
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              MediFlow también funciona para
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {content.relatedSlugs
              .map((slug) => SPECIALTIES[slug])
              .filter(Boolean)
              .map((rel) => {
                const RelIcon = resolveIcon(rel.iconMainName);
                return (
                  <Link
                    key={rel.slug}
                    href={`/${rel.slug}`}
                    className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111631] p-4 transition-all hover:border-white/20 hover:bg-[#141a3a]"
                  >
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accentByVariant[rel.heroVariant].gradient} text-white`}>
                      <RelIcon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold text-white">{rel.nombre}</span>
                    <LucideIcons.ChevronRight className="ml-auto h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
          </div>
        </div>
      </section>

      {/* ─────────── CTA FINAL ─────────── */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <SpecialtyHeroPattern variant={content.heroVariant} />
        <div className="relative z-10 mx-auto max-w-3xl px-6 text-center md:px-12">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
            Empieza gratis 14 días
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-300">
            Sin tarjeta de crédito. Importamos tus pacientes desde Excel sin costo.
          </p>
          <Link
            href="/register"
            className={`mt-10 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r ${accent.gradient} px-8 py-4 text-base font-semibold text-white shadow-xl shadow-violet-500/20 transition-transform hover:scale-[1.02]`}
          >
            Crear mi cuenta
            <LucideIcons.ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function FaqItem({ faq }: { faq: Faq }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-[#111631] p-5 open:bg-[#141a3a]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-white">
        <span>{faq.question}</span>
        <LucideIcons.Plus className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-45" />
      </summary>
      <p className="mt-4 text-sm leading-relaxed text-slate-300">{faq.answer}</p>
    </details>
  );
}
