import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Baby,
  Building2,
  FlaskConical,
  HeartPulse,
  Info,
  Layers,
  MapPin,
  Newspaper,
  Smile,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { BlogGrid } from "@/components/blog/ui";
import type { BlogPostCardDTO } from "@/lib/blog/types";
import { blogLinkTitle } from "@/lib/casos/blog-links";
import {
  CASOS_DISCLAIMER,
  casoSpecialtyLabel,
  type CasoDeUso,
  type CasoSpecialty,
} from "@/lib/casos/data";

// ─────────────────────────────────────────────────────────────────────────────
// Piezas presentacionales de /casos-de-uso. Todas son server components (sin
// estado ni handlers), igual que las del blog.
//
// Sin imágenes: la identidad visual de cada caso es un bloque CSS con gradiente
// por especialidad + un ícono de lucide. Cero archivos binarios nuevos y cero
// fotos de clínicas — que sería justo lo que no queremos en un escenario
// ilustrativo.
//
// Los estilos viven en src/app/casos-de-uso/casos.css; la tipografía del cuerpo,
// el FAQ y el CTA reusan src/app/blog/blog.css. Cada página monta los dos.
// ─────────────────────────────────────────────────────────────────────────────

const SPECIALTY_ICONS: Record<CasoSpecialty, LucideIcon> = {
  ortodoncia: Smile,
  implantes: Layers,
  odontopediatria: Baby,
  endodoncia: Activity,
  estetica: Sparkles,
  general: Stethoscope,
  periodoncia: HeartPulse,
  protesis: FlaskConical,
  multisede: Building2,
};

/** Bloque visual del caso: gradiente por especialidad + ícono. */
export function CasoVisual({
  specialty,
  variant,
}: {
  specialty: CasoSpecialty;
  variant: "card" | "hero";
}) {
  const Icon = SPECIALTY_ICONS[specialty] ?? Stethoscope;
  return (
    <div
      className={`caso-visual caso-visual--${variant} caso-visual--${specialty}`}
      aria-hidden="true"
    >
      <Icon size={variant === "hero" ? 30 : 38} />
    </div>
  );
}

export function CasoCard({ caso }: { caso: CasoDeUso }) {
  return (
    <Link href={`/casos-de-uso/${caso.slug}`} className="caso-card">
      <CasoVisual specialty={caso.specialty} variant="card" />
      <div className="caso-card__badges">
        <span>{casoSpecialtyLabel(caso.specialty)}</span>
        <span className="blog-card__dot" aria-hidden="true" />
        <span className="caso-card__city">{caso.city}</span>
      </div>
      <h3 className="caso-card__title">{caso.title}</h3>
      <p className="caso-card__problem">{caso.problem}</p>
      <p className="caso-card__excerpt">{caso.excerpt}</p>
      <span className="caso-card__more">
        Ver el escenario <ArrowRight size={15} />
      </span>
    </Link>
  );
}

export function CasosGrid({ casos }: { casos: CasoDeUso[] }) {
  return (
    <div className="caso-grid">
      {casos.map((c) => (
        <CasoCard key={c.slug} caso={c} />
      ))}
    </div>
  );
}

/** Ciudad + especialidad de la ficha, como píldoras junto al título. */
export function CasoHeroMeta({ caso }: { caso: CasoDeUso }) {
  return (
    <div className="caso-hero__meta">
      <span className="caso-hero__pill">
        <MapPin /> {caso.city}
      </span>
      <span className="caso-hero__pill">{casoSpecialtyLabel(caso.specialty)}</span>
      <span className="caso-hero__pill">{caso.problem}</span>
    </div>
  );
}

/**
 * La línea que separa un escenario ilustrativo de un testimonio. Va SIEMPRE
 * visible al final del hero — no es letra chica opcional.
 */
export function CasoNote() {
  return (
    <p className="caso-note">
      <Info aria-hidden="true" />
      <span>{CASOS_DISCLAIMER}</span>
    </p>
  );
}

export function CasoModules({ modules }: { modules: string[] }) {
  if (modules.length === 0) return null;
  return (
    <section className="caso-modules" aria-labelledby="caso-modules-title">
      <h2 id="caso-modules-title" className="caso-modules__title">
        Módulos que intervienen
      </h2>
      <p className="caso-modules__text">
        Todo lo que aparece en este escenario son funciones que ya existen en DaleControl.
      </p>
      <div className="caso-chips">
        {modules.map((m) => (
          <span key={m} className="caso-chip">
            <span className="caso-chip__dot" aria-hidden="true" />
            {m}
          </span>
        ))}
      </div>
    </section>
  );
}

/** CTA de cierre — a crear cuenta. Sin cifras ni precios (viven en la landing). */
export function CasoCta() {
  return (
    <aside className="blog-cta">
      <div style={{ minWidth: 0 }}>
        <p className="blog-cta__title">Prueba este flujo en tu propia clínica</p>
        <p className="blog-cta__text">
          Crea tu cuenta, importa tus pacientes y arma la agenda con tu equipo. Agenda,
          expediente, WhatsApp y caja en un solo lugar.
        </p>
      </div>
      <Link href="/signup" className="mfh-btn mfh-btn--primary" style={{ whiteSpace: "nowrap" }}>
        Crear mi cuenta
      </Link>
    </aside>
  );
}

/**
 * Los 3 artículos del blog relacionados. Si la BD respondió, se pintan como
 * tarjetas del blog (con excerpt y fecha); si no —build sin DATABASE_URL— se cae
 * a una lista con el título del mapa estático, para que los enlaces internos
 * existan siempre.
 */
export function CasoRelatedBlog({
  posts,
  slugs,
}: {
  posts: BlogPostCardDTO[];
  slugs: string[];
}) {
  if (posts.length === 0 && slugs.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }} aria-labelledby="caso-blog-title">
      <h2 id="caso-blog-title" className="blog-related__title">
        Para profundizar en el blog
      </h2>
      {posts.length > 0 ? (
        <BlogGrid posts={posts} />
      ) : (
        <div className="caso-bloglist">
          {slugs.map((s) => (
            <Link key={s} href={`/blog/${s}`} className="caso-bloglink">
              <span>{blogLinkTitle(s)}</span>
              <Newspaper aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function CasoRelatedCasos({ casos }: { casos: CasoDeUso[] }) {
  if (casos.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }} aria-labelledby="caso-related-title">
      <h2 id="caso-related-title" className="blog-related__title">
        Otros escenarios
      </h2>
      <CasosGrid casos={casos} />
    </section>
  );
}
