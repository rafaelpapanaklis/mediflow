import Link from "next/link";
import { Logo } from "./primitives/logo";

interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

// Solo rutas reales del repo + anclas de secciones de la home. Sin /about,
// /blog, /docs… que no existen (evita 404s).
const COLUMNS: FooterColumn[] = [
  {
    title: "Producto",
    links: [
      { label: "Funciones", href: "#features" },
      { label: "Comparativa", href: "#comparison" },
      { label: "Precios", href: "#pricing" },
      { label: "Preguntas frecuentes", href: "#faq" },
    ],
  },
  {
    title: "Empezar",
    links: [
      { label: "Crear cuenta", href: "/signup" },
      { label: "Ver planes", href: "#pricing" },
      { label: "Iniciar sesión", href: "/login" },
      { label: "Roadmap", href: "/roadmap" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Aviso de privacidad", href: "/privacidad" },
      { label: "Política de privacidad", href: "/legal/privacy" },
    ],
  },
];

const SOCIALS = [
  { label: "Twitter", href: "https://twitter.com/mediflow" },
  { label: "LinkedIn", href: "https://linkedin.com/company/mediflow" },
  { label: "Instagram", href: "https://instagram.com/mediflow" },
];

export function Footer() {
  return (
    <footer className="lp-section--tint" style={{ borderTop: "1px solid var(--ld-border)" }}>
      <div className="lp-container" style={{ paddingTop: 72, paddingBottom: 40 }}>
        <div className="lp-footer-grid">
          {/* Brand */}
          <div className="lp-footer-brand">
            <Link href="/" aria-label="MediFlow — inicio" style={{ textDecoration: "none" }}>
              <Logo size={24} color="var(--ld-brand-strong)" />
            </Link>
            <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.55, color: "var(--ld-fg-muted)", maxWidth: 280 }}>
              El software todo-en-uno para clínicas dentales en México: agenda, WhatsApp,
              expediente, CFDI 4.0 e IA en una sola plataforma.
            </p>
            <div style={{ marginTop: 18, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-footer-link lp-mono"
                  style={{ fontSize: 12, color: "var(--ld-fg-subtle)", textDecoration: "none" }}
                >
                  {s.label}
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="lp-mono" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ld-fg)", margin: "0 0 16px" }}>
                {col.title}
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 11 }}>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="lp-footer-link" style={{ fontSize: 14, color: "var(--ld-fg-muted)", textDecoration: "none" }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <hr className="lp-divider" style={{ margin: "44px 0 24px" }} />

        <div className="lp-footer-bottom">
          <span className="lp-mono" style={{ fontSize: 12.5, color: "var(--ld-fg-subtle)" }}>
            © 2026 MediFlow · Hecho en México <span aria-hidden="true">🇲🇽</span>
          </span>
          <span className="lp-mono" style={{ fontSize: 12.5, color: "var(--ld-fg-subtle)" }}>
            CFDI 4.0 · NOM-024 · Datos cifrados
          </span>
        </div>
      </div>

      <style>{`
        .lp-footer-grid {
          display: grid;
          grid-template-columns: 1.6fr repeat(3, 1fr);
          gap: 40px;
        }
        .lp-footer-link { transition: color 0.15s; }
        .lp-footer-link:hover { color: var(--ld-fg) !important; }
        .lp-footer-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        @media (max-width: 860px) {
          .lp-footer-grid { grid-template-columns: repeat(2, 1fr); gap: 32px 24px; }
          .lp-footer-brand { grid-column: 1 / -1; }
        }
        @media (max-width: 480px) {
          .lp-footer-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </footer>
  );
}
