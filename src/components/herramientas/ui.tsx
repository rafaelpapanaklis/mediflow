import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarX,
  FileSignature,
  Lock,
  Newspaper,
  Scale,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { blogLinkTitle } from "@/lib/casos/blog-links";
import {
  HERRAMIENTAS_PRIVACY_NOTE,
  type Herramienta,
  type HerramientaIcon,
} from "@/lib/herramientas/data";

// ─────────────────────────────────────────────────────────────────────────────
// Piezas presentacionales de /herramientas. Todas son server components: sin
// estado ni handlers (la interactividad vive en el tool.tsx de cada carpeta,
// que es el único "use client" de la sección).
//
// Sin imágenes: la identidad de cada herramienta es un gradiente + un ícono de
// lucide, igual que en /casos-de-uso. Cero archivos binarios nuevos.
//
// Estilos en src/app/herramientas/herramientas.css; la tipografía del cuerpo,
// el FAQ y el CTA reusan src/app/blog/blog.css. Cada página monta los dos.
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<HerramientaIcon, LucideIcon> = {
  "citas-perdidas": CalendarX,
  "punto-equilibrio": Scale,
  "aviso-privacidad": ShieldCheck,
  consentimiento: FileSignature,
  "precio-tratamiento": BadgeDollarSign,
};

/** El tipo de herramienta, deducido del slug — evita otro campo en la data. */
function kindLabel(slug: string): string {
  return slug.startsWith("generador") ? "Generador" : "Calculadora";
}

export function ToolIcon({ icon }: { icon: HerramientaIcon }) {
  const Icon = TOOL_ICONS[icon] ?? Wrench;
  return (
    <span className={`tool-card__icon tool-card__icon--${icon}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

export function ToolCard({ tool }: { tool: Herramienta }) {
  return (
    <Link href={`/herramientas/${tool.slug}`} className="tool-card">
      <ToolIcon icon={tool.icon} />
      <span className="tool-card__kind">{kindLabel(tool.slug)} · Gratis</span>
      <h3 className="tool-card__title">{tool.name}</h3>
      <p className="tool-card__text">{tool.purpose}</p>
      <span className="tool-card__more">
        Abrir la herramienta <ArrowRight size={15} />
      </span>
    </Link>
  );
}

export function ToolsGrid({ tools }: { tools: Herramienta[] }) {
  return (
    <div className="tool-grid">
      {tools.map((t) => (
        <ToolCard key={t.slug} tool={t} />
      ))}
    </div>
  );
}

/**
 * "Tus datos no salen de tu navegador". Va SIEMPRE visible bajo el hero de cada
 * herramienta y en el índice — es la promesa que sostiene toda la sección.
 */
export function ToolPrivacyNote() {
  return (
    <p className="tool-privacy">
      <Lock aria-hidden="true" />
      <span>{HERRAMIENTAS_PRIVACY_NOTE}</span>
    </p>
  );
}

/**
 * CTA de cierre — suave y sin cifras. Los precios cambian y viven en un solo
 * lugar (la landing): un número dentro de una página indexada envejece mal.
 */
export function ToolCta({ title, text }: { title: string; text: string }) {
  return (
    <aside className="blog-cta">
      <div style={{ minWidth: 0 }}>
        <p className="blog-cta__title">{title}</p>
        <p className="blog-cta__text">{text}</p>
      </div>
      <Link href="/" className="mfh-btn mfh-btn--primary" style={{ whiteSpace: "nowrap" }}>
        Conoce DaleControl
      </Link>
    </aside>
  );
}

/**
 * Los 3 artículos del blog relacionados. Lista con el título del mapa estático
 * (src/lib/casos/blog-links.ts) en lugar de tarjetas de la BD: así estas páginas
 * se prerenderizan en build sin DATABASE_URL y los enlaces internos existen
 * siempre.
 */
export function ToolRelatedBlog({ slugs }: { slugs: string[] }) {
  if (slugs.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }} aria-labelledby="tool-blog-title">
      <h2 id="tool-blog-title" className="blog-related__title">
        Para profundizar en el blog
      </h2>
      <div className="tool-bloglist">
        {slugs.map((s) => (
          <Link key={s} href={`/blog/${s}`} className="tool-bloglink">
            <span>{blogLinkTitle(s)}</span>
            <Newspaper aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ToolRelatedTools({ tools }: { tools: Herramienta[] }) {
  if (tools.length === 0) return null;
  return (
    <section style={{ marginTop: 48 }} aria-labelledby="tool-related-title">
      <h2 id="tool-related-title" className="blog-related__title">
        Otras herramientas gratuitas
      </h2>
      <ToolsGrid tools={tools} />
    </section>
  );
}
