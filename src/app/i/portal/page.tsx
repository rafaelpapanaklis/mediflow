import { redirect } from "next/navigation";
import {
  PORTAL_CODE_TTL_MIN,
  getPortalScope,
  getPortalSession,
  normalizePortalPhone,
  resolvePortalAccountBySlug,
  resolvePortalIdentities,
} from "@/lib/realty/portal-auth";
import { PortalLogin } from "@/components/realty/portal/portal-login";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   /i/portal — la puerta.

   ── LA LIGA QUE MANDA T6 POR WHATSAPP ────────────────────────────────
       https://…/i/portal?tel=5512345678&c=<slug-de-la-inmobiliaria>

   `tel` prellena el campo (10 dígitos; se limpia con mxTenDigits, y si
   viene basura simplemente se ignora). `c` es el slug de la inmobiliaria y
   solo sirve para pintar su logo y su nombre arriba, para que la persona
   reconozca de quién es la liga.

   🔴 NINGUNO DE LOS DOS AUTENTICA NADA. No hay liga mágica que entre sin
   código: un mensaje reenviado no puede abrirle a nadie el contrato de
   otro. Lo único que abre sesión es el código de seis dígitos.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { tel?: string; c?: string };
}

export default async function PortalEntradaPage({ searchParams }: PageProps) {
  const t = portalT();
  const session = getPortalSession();

  // 🔴 CON COOKIE, EL DESTINO SE DECIDE CON LO QUE DICE LA BASE, NO CON LO
  // QUE DICE LA COOKIE. Confiar en la cara guardada abre un bucle: si a esa
  // persona le terminaron el contrato, esta página la mandaría a
  // /i/portal/inquilino, el guard de (sesion) no encontraría alcance y la
  // devolvería aquí, y aquí otra vez para allá, para siempre.
  //
  // Cuesta dos consultas indexadas y SOLO cuando hay cookie.
  let caduco = false;
  if (session) {
    const scope = await getPortalScope();
    if (scope) {
      redirect(scope.role === "INQUILINO" ? "/i/portal/inquilino" : "/i/portal/propietario");
    }
    const identities = await resolvePortalIdentities(session.phone);
    // Sigue siendo alguien, pero no con la cara que traía guardada.
    if (identities.length > 0) redirect("/i/portal/elegir");
    // Ya no es inquilino ni propietario de nadie: la cookie no sirve para
    // nada. Se pinta el login con un aviso, sin echarle la culpa.
    caduco = true;
  }

  const account = await resolvePortalAccountBySlug(searchParams.c);
  const tel = normalizePortalPhone(searchParams.tel) ?? "";

  return (
    <div className="dcr-app dcr-app--plain">
      <main className="dcr-public">
        <div className="dcr-shell">
          <header className="dcr-top" style={{ margin: "0 -16px", borderRadius: 0 }}>
            {account?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="dcr-top__logo" src={account.logoUrl} alt="" />
            ) : (
              <span className="dcr-top__logo dcr-top__logo--fallback" aria-hidden="true">
                {(account?.name ?? "DC").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="dcr-top__txt">
              <p className="dcr-top__name">{account?.name ?? t("marca.producto")}</p>
              <p className="dcr-top__meta">{t("marca.portal")}</p>
            </div>
          </header>

          {caduco ? (
            <p className="dcr-alert dcr-alert--info" style={{ marginTop: 16 }}>
              {t("sesion.expirada")}
            </p>
          ) : null}

          <PortalLogin telInicial={tel} codeTtlMin={PORTAL_CODE_TTL_MIN} />
        </div>
      </main>
    </div>
  );
}
