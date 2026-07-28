import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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

const COMPONENTS: Components = {
  a({ node, href, children, ...rest }) {
    if (isExternal(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  // Las imágenes vienen de URLs externas del propio artículo: <img> plano con
  // lazy-loading (next/image exigiría configurar remotePatterns por dominio).
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
