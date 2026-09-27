import Link from "next/link";

/**
 * AVISO DE COOKIES del sitio público: una línea discreta en el pie, SIN botón de aceptar, sin banner y sin
 * bloquear nada (sugerencia del abogado que revisó el aviso de privacidad). Al navegar se entiende la
 * aceptación, y el aviso (sección 3 «Cookies», ancla #cookies) dice cómo desactivarlas.
 *
 * Un solo componente para los dos pies públicos (SalesFooter y el Footer de las páginas de especialidad):
 *  · tone "dark"  → SalesFooter (#080d1a, hex fijos);
 *  · tone "token" → Footer con los tokens de la landing (`--ld-*`).
 */
export const TEXTO_AVISO_COOKIES = "Al navegar en este sitio aceptas el uso de cookies conforme a nuestro";
export const HREF_AVISO_COOKIES = "/privacidad#cookies";

export function AvisoCookies({ tone = "dark" }: { tone?: "dark" | "token" }) {
  const dark = tone === "dark";
  return (
    <p
      data-testid="aviso-cookies"
      style={{
        margin: 0,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: dark ? "#94a3b8" : "var(--ld-fg-muted, var(--fg-muted))",
      }}
    >
      {TEXTO_AVISO_COOKIES}{" "}
      <Link
        href={HREF_AVISO_COOKIES}
        style={{ color: dark ? "#cbd5e1" : "var(--ld-fg, var(--fg))", textDecoration: "underline", textUnderlineOffset: 2 }}
      >
        Aviso de privacidad
      </Link>
      .
    </p>
  );
}
