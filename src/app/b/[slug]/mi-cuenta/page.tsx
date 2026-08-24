import type { Metadata } from "next";
import {
  PORTAL_CODE_TTL_MIN,
  getPortalSession,
  loadPortalData,
  resolvePortalShop,
} from "@/lib/barber/client-portal";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { PortalClient } from "@/components/barber/portal/portal-client";
import { PortalLogin } from "@/components/barber/portal/portal-login";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/mi-cuenta — el portal del cliente final.

   Sesión PROPIA y aislada: cookie httpOnly firmada, sin nada que ver con
   la sesión Supabase del panel ni con la del dental. Un cliente del portal
   no tiene sesión de barbería, así que getBarberContext() le devuelve null
   y el layout de /barber/** lo manda a /login — no hay puerta al panel.

   La página decide en el servidor: con sesión válida pinta el portal ya
   cargado (nada de un parpadeo de "cargando"); sin ella, la entrada por
   teléfono + código.

   noindex SIEMPRE: aquí vive información personal del cliente.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const shop = await resolvePortalShop(params.slug);
  const t = getBarberT(shop?.locale ?? "es");
  return {
    title: shop
      ? t("barber.reserva.portal.meta.title", { shop: shop.name })
      : t("barber.reserva.cerrado.noEncontrada"),
    description: shop ? t("barber.reserva.portal.meta.description", { shop: shop.name }) : undefined,
    // Datos personales: fuera de los buscadores, siempre.
    robots: { index: false, follow: false },
  };
}

export default async function BarberPortalPage({ params }: PageProps) {
  const shop = await resolvePortalShop(params.slug);

  if (!shop) {
    const t = getBarberT("es");
    return (
      <Shell>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>
            {t("barber.reserva.cerrado.noEncontrada")}
          </h1>
        </div>
      </Shell>
    );
  }

  // La sesión se valida contra ESTA barbería: una cookie de otra no entra.
  const session = getPortalSession(shop.id);
  const data = session
    ? await loadPortalData({ barbershopId: shop.id, clientId: session.clientId })
    : null;

  return (
    <Shell>
      {data ? (
        <PortalClient slug={shop.slug} shop={shop} initial={data} />
      ) : (
        <>
          <Head shop={shop} />
          <PortalLogin slug={shop.slug} shop={shop} codeTtlMin={PORTAL_CODE_TTL_MIN} />
        </>
      )}
    </Shell>
  );
}

function Head({ shop }: { shop: NonNullable<Awaited<ReturnType<typeof resolvePortalShop>>> }) {
  return (
    <header className="dcb-head">
      {shop.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="dcb-head__logo" src={shop.logoUrl} alt="" />
      ) : (
        <span className="dcb-head__logo dcb-head__logo--fallback" aria-hidden="true">
          {shop.name.charAt(0).toUpperCase()}
        </span>
      )}
      <div>
        <h2 className="dcb-head__name">{shop.name}</h2>
        {shop.branchName || shop.city ? (
          <p className="dcb-head__meta">{[shop.branchName, shop.city].filter(Boolean).join(" · ")}</p>
        ) : null}
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="barber-shell">
      <div className="dcb-public">
        <div className="dcb-shell">{children}</div>
      </div>
    </div>
  );
}
