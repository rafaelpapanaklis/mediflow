import type { Metadata, Viewport } from "next";
import { prisma } from "@/lib/prisma";
import { resolvePortalShop } from "@/lib/barber/client-portal";
import { loadStarsView, parseCardToken, resolveCardToken } from "@/lib/barber/stars-core";
import { datosDeInstalacion } from "@/lib/barber/tarjeta-instalar";
import {
  coloresDeTarjeta,
  nombresDeTarjeta,
  rutaIconoTarjeta,
  rutaManifestTarjeta,
} from "@/lib/barber/tarjeta-instalar-core";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { StarsCard, StarsDetails, starsT } from "@/components/barber/stars/stars-card";
import { InstalarTarjeta } from "@/components/barber/stars/instalar-tarjeta";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";
import "@/components/barber/stars/instalar-tarjeta.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/tarjeta/[token] — la tarjeta de ESTRELLAS por enlace personal.

   Para el cliente que no puede entrar a «mi cuenta» (el código llega por
   WhatsApp y casi ninguna barbería lo tiene conectado): la barbería le da
   este enlace —o el QR— desde Caja o desde su ficha.

   SOLO LECTURA y SOLO la tarjeta: estrellas, bonos e historial de estrellas
   con el nombre de pila. Nada de citas, teléfono, pagos ni fotos.

   El token va firmado con la llave del servidor (stars-core.ts): no se
   adivina, no sirve para otro cliente ni para otra barbería (se compara
   contra la barbería del slug) y se revoca desde la ficha. Ante cualquier
   duda la página dice lo mismo: «este enlace ya no sirve», sin decir por qué.

   noindex y sin Referer: el enlace es la llave, no debe filtrarse.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string; token: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const shop = await resolvePortalShop(params.slug);
  const t = starsT(((getBarberDict(shop?.locale ?? "es").barber as Dictionary).estrellas ?? {}) as Dictionary);
  const base: Metadata = {
    title: shop ? `${t("card.title")} · ${shop.name}` : t("card.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
  // «Agregar a pantalla de inicio» (ws6-t2): manifest propio de ESTA tarjeta
  // e íconos de la barbería. Solo con una barbería válida y un token con
  // forma de token (si el enlace ya no sirve, el manifest no estorba).
  const token = decodeURIComponent(params.token ?? "");
  if (!shop || !parseCardToken(token)) return base;
  const nombres = nombresDeTarjeta(shop.name, shop.locale);
  return {
    ...base,
    manifest: rutaManifestTarjeta(shop.slug, token),
    applicationName: nombres.name,
    appleWebApp: { capable: true, title: nombres.shortName, statusBarStyle: "default" },
    icons: {
      icon: [{ url: rutaIconoTarjeta(shop.slug, 192), sizes: "192x192", type: "image/png" }],
      apple: [{ url: rutaIconoTarjeta(shop.slug, 180), sizes: "180x180", type: "image/png" }],
    },
  };
}

/** El color de la barra del sistema: el acento de la página de la barbería. */
export async function generateViewport(props: PageProps): Promise<Viewport> {
  const params = await props.params;
  const datos = await datosDeInstalacion(params.slug).catch(() => null);
  return datos ? { themeColor: coloresDeTarjeta(datos.template, datos.acento).tema } : {};
}

export default async function StarCardPage(props: PageProps) {
  const params = await props.params;
  const shop = await resolvePortalShop(params.slug);
  const locale = shop?.locale === "en" ? "en" : "es";
  const t = starsT(((getBarberDict(locale).barber as Dictionary).estrellas ?? {}) as Dictionary);
  const tr = getBarberT(locale);

  if (!shop) {
    return (
      <Shell>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>
            {tr("barber.reserva.cerrado.noEncontrada")}
          </h1>
        </div>
      </Shell>
    );
  }

  const resolved = await resolveCardToken(prisma, shop.id, decodeURIComponent(params.token));
  const view = resolved
    ? await loadStarsView(prisma, { barbershopId: shop.id, clientId: resolved.clientId, audience: "client" })
    : null;

  return (
    <Shell>
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
          <h1 className="dcb-head__name">
            {view?.firstName ? t("card.hello", { name: view.firstName }) : shop.name}
          </h1>
          <p className="dcb-head__meta">{shop.branchName ? `${shop.name} · ${shop.branchName}` : shop.name}</p>
        </div>
      </header>

      {!view ? (
        <div className="dcb-card" style={{ textAlign: "center" }}>
          <p style={{ margin: 0 }}>{t("card.invalid")}</p>
        </div>
      ) : !view.enabled ? (
        <div className="dcb-card" style={{ textAlign: "center" }}>
          <p style={{ margin: 0 }}>{t("card.off")}</p>
        </div>
      ) : (
        <>
          <StarsCard view={view} t={t} audience="client" locale={locale} />
          {/* Aviso amable para tenerla como ícono en el teléfono (se puede cerrar). */}
          <InstalarTarjeta
            slug={shop.slug}
            labels={{
              title: tr("barber.tarjeta.install.title"),
              body: tr("barber.tarjeta.install.body"),
              button: tr("barber.tarjeta.install.button"),
              close: tr("barber.tarjeta.install.close"),
              iphoneStep1: tr("barber.tarjeta.install.iphoneStep1"),
              iphoneStep2: tr("barber.tarjeta.install.iphoneStep2"),
              androidStep1: tr("barber.tarjeta.install.androidStep1"),
              androidStep2: tr("barber.tarjeta.install.androidStep2"),
              done: tr("barber.tarjeta.install.done"),
            }}
          />
          <StarsDetails view={view} t={t} audience="client" locale={locale} timezone={shop.timezone} />
        </>
      )}

      <p className="dcb-foot">
        <a href={`/b/${shop.slug}/reservar`}>{t("card.book")}</a>
      </p>
    </Shell>
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
