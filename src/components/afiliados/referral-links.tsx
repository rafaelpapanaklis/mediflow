// Los tres enlaces del afiliado, con el reparto del diseño: el link corto
// arriba en su caja morada (es el que hay que compartir) y los dos históricos
// debajo, en una línea cada uno.
//
// Los dos de abajo SIGUEN aquí porque no son duplicados del corto:
// /socio/<slug> es una landing de venta con contenido propio (la que reparten
// el kit de marketing y las plantillas) y /signup?ref= entra directo al alta.
// Además muchos afiliados ya los tienen impresos o pegados en su bio: quitarlos
// de la pantalla no los desactivaría, solo dejaría al afiliado sin saber qué
// está circulando.
//
// SERVER-SAFE: ya no necesita "use client". Lo único interactivo —copiar— vive
// en los botones de ui/copy-button, que sí son de cliente. El link corto llega
// YA ARMADO por prop: link-url.ts (fuente única de estas URLs) importa prisma y
// crypto, así que no puede cruzar al cliente.
import { AFFILIATE_COOKIE_DAYS } from "@/lib/affiliates/attribution-cookie";
import { CopyButton, CopyIconButton } from "./ui/copy-button";

/** Lo que se MUESTRA quita el protocolo; lo que se COPIA lo conserva. */
function display(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function ReferralLinks({
  siteUrl,
  slug,
  referralCode,
  shortUrl,
}: {
  siteUrl: string;
  slug: string;
  referralCode: string;
  shortUrl: string; // /r/<referralCode>, resuelto en el servidor
}) {
  const base = siteUrl.replace(/\/$/, "");
  const partnerUrl = `${base}/socio/${slug}`;
  const signupUrl = `${base}/signup?ref=${referralCode}`;

  return (
    <>
      {/* ── El principal ─────────────────────────────────────────────── */}
      <div className="dcafp-linkhero">
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 750, color: "var(--dcafp-ink)" }}>Link corto</span>
          <span className="dcafp-chip dcafp-chip--solid">RECOMENDADO</span>
        </div>
        <div className="dcafp-linkhero__row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <code className="dcafp-code dcafp-code--lead" style={{ flex: 1, minWidth: 0 }}>
            {display(shortUrl)}
          </code>
          <CopyButton text={shortUrl} toast="Link corto copiado" ariaLabel="Copiar link corto" />
        </div>
        <div className="dcafp-hint">
          El más fácil de compartir y de dictar. Tu referido queda guardado {AFFILIATE_COOKIE_DAYS} días,
          aunque la clínica se registre días después.
        </div>
      </div>

      {/* ── Los dos históricos ───────────────────────────────────────── */}
      <div className="dcafp-linkrow">
        <div className="dcafp-linkrow__body">
          <div className="dcafp-linkrow__k">Página de socio</div>
          <code className="dcafp-code">{display(partnerUrl)}</code>
        </div>
        <CopyIconButton
          text={partnerUrl}
          toast="Link de tu página de socio copiado"
          ariaLabel="Copiar link de tu página de socio"
        />
      </div>

      <div className="dcafp-linkrow">
        <div className="dcafp-linkrow__body">
          <div className="dcafp-linkrow__k">Enlace directo de registro</div>
          <code className="dcafp-code">{display(signupUrl)}</code>
        </div>
        <CopyIconButton
          text={signupUrl}
          toast="Enlace de registro copiado"
          ariaLabel="Copiar enlace directo de registro"
        />
      </div>
    </>
  );
}
