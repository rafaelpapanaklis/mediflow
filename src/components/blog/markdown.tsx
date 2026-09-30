import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnuncioLink } from "./anuncio-link";

// ─────────────────────────────────────────────────────────────────────────────
// Renderer de markdown del blog — ÚNICO en toda la app.
//
// Lo usan la ficha pública del artículo (server component) y la vista previa
// del editor del admin (dentro de un client component), para que lo que ve el
// editor sea exactamente lo que verá Google. No lleva "use client": sin hooks,
// funciona en ambos entornos y Next lo bundlea según quién lo importe.
//
// SEGURIDAD — invariante del módulo:
//   · Sin rehype-raw y sin ninguna inyección de HTML crudo: el HTML que venga
//     dentro del markdown NO se interpreta. `skipHtml` además lo descarta en
//     vez de imprimirlo como texto.
//   · `urlTransform` por defecto de react-markdown ya neutraliza `javascript:`.
//   · `disallowedElements` es defensa redundante por si algún día alguien
//     añade un plugin que sí genere nodos crudos.
// El contenido lo escribe el equipo (importador JSON + admin), pero el blog es
// la superficie más pública del producto: no se confía en el input igual.
// ─────────────────────────────────────────────────────────────────────────────

const DISALLOWED = ["script", "iframe", "style", "object", "embed", "form", "input"];

function isExternal(href: string | undefined): boolean {
  if (!href) return false;
  return /^https?:\/\//i.test(href);
}

// ── Anuncios ────────────────────────────────────────────────────────────────
// Una cita con un enlace cuyo title empieza por «anuncio-» se pinta como
// tarjeta de marca. El sufijo elige la variante. Sigue siendo markdown normal:
// no se habilita HTML crudo.
export const ANUNCIO_VARIANTES = {
  pro: "Plan Profesional",
  basico: "Plan Básico",
  clinica: "Plan Clínica",
  anual: "Pago anual",
  sabina: "Sabina · IA",
  migracion: "Migración gratis",
} as const;
export type AnuncioVariante = keyof typeof ANUNCIO_VARIANTES;

/** Sufijo del title («pro» de «anuncio-pro»), o null si no es un anuncio. */
export function sufijoDeAnuncio(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const m = /^anuncio-([a-z0-9-]+)$/.exec(title.trim());
  return m ? m[1] : null;
}

type HastLike = { type?: string; tagName?: string; properties?: { title?: unknown }; children?: HastLike[] };

/** Busca dentro del blockquote (hast) un <a> con title «anuncio-…». */
export function anuncioDeBlockquote(node: HastLike | undefined): string | null {
  for (const hijo of node?.children ?? []) {
    if (hijo.type === "element" && hijo.tagName === "a") {
      const s = sufijoDeAnuncio(hijo.properties?.title);
      if (s) return s;
    }
    const s = anuncioDeBlockquote(hijo);
    if (s) return s;
  }
  return null;
}

function varianteConocida(sufijo: string): AnuncioVariante | "otro" {
  return sufijo in ANUNCIO_VARIANTES ? (sufijo as AnuncioVariante) : "otro";
}

function MarcaAnuncio({ etiqueta }: { etiqueta: string }) {
  return (
    <div className="blog-ad__marca">
      <svg width="22" height="22" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(255,255,255,.22)" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M5.5 18.5 L18 25.2 L30.5 18.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 24.5 L18 31.2 L30.5 24.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
      </svg>
      <span className="blog-ad__nombre">DaleControl</span>
      <span className="blog-ad__etiqueta">{etiqueta}</span>
    </div>
  );
}

const COMPONENTS: Components = {
  blockquote({ node, children, ...rest }) {
    const sufijo = anuncioDeBlockquote(node as HastLike | undefined);
    if (!sufijo) return <blockquote {...rest}>{children}</blockquote>;
    const variante = varianteConocida(sufijo);
    const etiqueta = variante === "otro" ? "Promoción" : ANUNCIO_VARIANTES[variante];
    return (
      <aside className={`blog-ad blog-ad--${variante}`} data-anuncio={sufijo} aria-label={`Anuncio: ${etiqueta}`}>
        <MarcaAnuncio etiqueta={etiqueta} />
        <div className="blog-ad__cuerpo">{children}</div>
      </aside>
    );
  },
  a({ node, href, title, children, ...rest }) {
    const sufijo = sufijoDeAnuncio(title);
    if (sufijo && !isExternal(href)) {
      return (
        <AnuncioLink promotionId={sufijo} href={href} {...rest}>
          {children}
        </AnuncioLink>
      );
    }
    if (isExternal(href)) {
      return (
        <a href={href} title={title} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} title={title} {...rest}>
        {children}
      </a>
    );
  },
  // Las imágenes vienen de URLs externas (https) o de /public (ruta que empieza
  // por «/», p. ej. /blog/panel/…): <img> plano con lazy-loading (next/image
  // exigiría configurar remotePatterns por dominio). El estilo (ancho completo,
  // esquinas, borde y pie de foto) vive en blog.css.
  img({ node, src, alt, ...rest }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" decoding="async" {...rest} />;
  },
  // Las tablas de GFM se desbordan en móvil: scroll horizontal propio, nunca
  // scroll del body.
  table({ node, children, ...rest }) {
    return (
      <div className="blog-prose__tablewrap">
        <table {...rest}>{children}</table>
      </div>
    );
  },
};

export function BlogMarkdown({ content }: { content: string }) {
  return (
    <div className="blog-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={DISALLOWED}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {content ?? ""}
      </ReactMarkdown>
    </div>
  );
}
