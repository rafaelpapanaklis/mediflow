import Link from "next/link";
import { Logo } from "./primitives/logo";

interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

const COLUMNS: FooterColumn[] = [
  {
    title: "Producto",
    links: [
      { label: "Features", href: "#features" },
      { label: "Precios", href: "#pricing" },
      { label: "Especialidades", href: "#specialties" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Sobre", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Contacto", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Términos", href: "/legal/terms" },
      { label: "Privacidad", href: "/legal/privacy" },
      { label: "CFDI", href: "/legal/cfdi" },
      { label: "NOM-024", href: "/legal/nom-024" },
    ],
  },
  {
    title: "Soporte",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Estado", href: "/status" },
      { label: "Contacto", href: "/support" },
    ],
  },
  {
    title: "Redes",
    links: [
      { label: "Twitter", href: "https://twitter.com/mediflow" },
      { label: "LinkedIn", href: "https://linkedin.com/company/mediflow" },
      { label: "Instagram", href: "https://instagram.com/mediflow" },
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
    <footer
      style={{
        borderTop: "1px solid var(--ld-border, var(--border))",
        background: "rgba(0,0,0,0.3)",
        padding: "80px 48px 40px",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div className="ld-footer-grid">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4
                style={{
                  fontFamily:
                    "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "var(--ld-fg, var(--fg))",
                  margin: 0,
                  marginBottom: 16,
                }}
              >
                {col.title}
              </h4>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {col.links.map((l) => {
                  const isExternal = l.href.startsWith("http");
                  const linkStyle = {
                    fontSize: 13,
                    color: "var(--ld-fg-muted, var(--fg-muted))",
                    textDecoration: "none",
                    transition: "color 0.2s",
                  } as const;
                  return (
                    <li key={l.label}>
                      {isExternal ? (
                        <a
                          href={l.href}
                          className="ld-footer-link"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={linkStyle}
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="ld-footer-link"
                          style={linkStyle}
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* HR */}
        <div
          style={{
            height: 1,
            background: "var(--ld-border, var(--border))",
            margin: "48px 0 24px",
          }}
        />

        {/* Bottom row */}
        <div
          className="ld-footer-bottom"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <Logo size={20} color="var(--ld-brand-light, var(--brand-light))" />
            <span
              style={{
                fontSize: 12,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                fontFamily:
                  "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              © 2026 MediFlow · Hecho en México 🇲🇽
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                className="ld-footer-link"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  textDecoration: "none",
                  fontFamily:
                    "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  letterSpacing: "0.04em",
                  transition: "color 0.2s",
                }}
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        .ld-footer-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 40px;
        }
        .ld-footer-link:hover {
          color: var(--ld-fg, var(--fg)) !important;
        }
        @media (max-width: 1024px) {
          .ld-footer-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 32px 24px;
          }
        }
        @media (max-width: 768px) {
          .ld-footer-grid {
            grid-template-columns: 1fr;
            gap: 28px;
          }
          .ld-footer-bottom {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </footer>
  );
}
