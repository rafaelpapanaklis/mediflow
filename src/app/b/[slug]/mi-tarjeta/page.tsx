import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageCircle, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getPortalSession, resolvePortalShop } from "@/lib/barber/client-portal";
import { getLoyaltyRule } from "@/lib/barber/loyalty-core";
import { barberCaptchaSiteKey } from "@/lib/barber/captcha";
import { normalizarConfigBarberWeb, rutaReservaBarberia, rutaWebBarberia, urlWhatsApp } from "@/lib/barber/landing";
import { canalDeTarjeta, depsDeTarjeta, rutaTarjetaDeSesion } from "@/lib/barber/tarjeta-web";
import { textoPedirTarjeta } from "@/lib/barber/tarjeta-web-core";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { MiTarjetaForm } from "@/components/barber/stars/mi-tarjeta-form";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/mi-tarjeta — «Mi tarjeta» desde la página web (ws6-t2).

   La puerta fácil a la tarjeta de estrellas: el cliente toca «Mi tarjeta» en
   el menú de la página de su barbería y escribe su teléfono.

   🔒 La tarjeta NUNCA se enseña aquí: cualquiera podría teclear el número de
   otro. Con WhatsApp conectado (y la plantilla aprobada) se le manda SU
   enlace a ese número y la pantalla dice lo mismo exista o no el cliente.
   Sin eso, se le dice que se la pida a la barbería, con WhatsApp / llamar.

   La única excepción no es una excepción: quien YA entró a «Mi cuenta» (con
   su código por WhatsApp) va directo a su tarjeta, porque ya probó quién es.

   noindex: es una puerta a datos personales.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const shop = await resolvePortalShop(params.slug);
  const t = getBarberT(shop?.locale ?? "es");
  return {
    title: shop ? t("barber.tarjeta.meta.title", { shop: shop.name }) : t("barber.reserva.cerrado.noEncontrada"),
    robots: { index: false, follow: false },
  };
}

/** El WhatsApp que la barbería puso en Mi web (solo dígitos), o null. Nunca lanza. */
async function whatsappDeLaPagina(barbershopId: string): Promise<string | null> {
  try {
    const fila = await prisma.barberLandingConfig.findUnique({ where: { barbershopId }, select: { config: true } });
    return normalizarConfigBarberWeb(fila?.config).whatsapp;
  } catch {
    return null;
  }
}

export default async function MiTarjetaPage(props: PageProps) {
  const params = await props.params;
  const shop = await resolvePortalShop(params.slug);
  const locale = shop?.locale === "en" ? "en" : "es";
  const t = getBarberT(locale);

  if (!shop) {
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

  const rule = await getLoyaltyRule(prisma, shop.id);

  // Ya entró a «Mi cuenta»: directo a SU tarjeta, sin pedirle nada.
  if (rule.enabled) {
    const session = await getPortalSession(shop.id);
    const ruta = session ? await rutaTarjetaDeSesion(prisma, shop, session.clientId) : null;
    if (ruta) redirect(ruta);
  }

  const [canal, whatsapp] = rule.enabled
    ? await Promise.all([canalDeTarjeta(await depsDeTarjeta(), shop.id), whatsappDeLaPagina(shop.id)])
    : (["barberia", null] as const);

  const wa = urlWhatsApp(whatsapp, textoPedirTarjeta(locale));
  const tel = shop.phone ? `tel:${shop.phone.replace(/[^\d+]/g, "")}` : null;

  const pedirla = (
    <section className="dcb-card" style={{ marginTop: 18 }}>
      <h1 className="dcb-title" style={{ marginTop: 0 }}>
        {t("barber.tarjeta.askTitle")}
      </h1>
      <p className="dcb-sub">{t("barber.tarjeta.ask")}</p>
      {wa || tel ? (
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {wa ? (
            <a className="dcb-btn dcb-btn--primary" href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle size={16} aria-hidden="true" />
              {t("barber.tarjeta.whatsapp")}
            </a>
          ) : null}
          {tel ? (
            <a className={`dcb-btn ${wa ? "dcb-btn--ghost" : "dcb-btn--primary"}`} href={tel}>
              <Phone size={16} aria-hidden="true" />
              {t("barber.tarjeta.call")}
              {shop.phone ? ` · ${shop.phone}` : ""}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );

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
          <h2 className="dcb-head__name">{shop.name}</h2>
          {shop.branchName || shop.city ? (
            <p className="dcb-head__meta">{[shop.branchName, shop.city].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
      </header>

      {!rule.enabled ? (
        <div className="dcb-card" style={{ marginTop: 18, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>
            {t("barber.tarjeta.off")}
          </h1>
        </div>
      ) : canal === "whatsapp" ? (
        <MiTarjetaForm
          slug={shop.slug}
          locale={locale}
          captchaSiteKey={barberCaptchaSiteKey()}
          sinWhatsApp={pedirla}
          labels={{
            title: t("barber.tarjeta.title"),
            sub: t("barber.tarjeta.sub"),
            why: t("barber.tarjeta.why"),
            phone: t("barber.tarjeta.phone"),
            country: t("barber.tarjeta.country"),
            placeholderMx: t("barber.tarjeta.placeholderMx"),
            placeholderOther: t("barber.tarjeta.placeholderOther"),
            send: t("barber.tarjeta.send"),
            sending: t("barber.tarjeta.sending"),
            sentTitle: t("barber.tarjeta.sentTitle"),
            sent: t("barber.tarjeta.sent"),
            sentHint: t("barber.tarjeta.sentHint"),
            again: t("barber.tarjeta.again"),
            errorPhone: t("barber.tarjeta.errors.phone"),
            errorGeneric: t("barber.tarjeta.errors.generic"),
            errorNetwork: t("barber.tarjeta.errors.network"),
            errorTooMany: t("barber.tarjeta.errors.tooMany"),
            captchaError: t("barber.reserva.captcha.error"),
            captchaRetry: t("barber.reserva.captcha.reintentar"),
          }}
        />
      ) : (
        pedirla
      )}

      <p className="dcb-foot">
        <a href={rutaWebBarberia(shop.slug)}>{t("barber.tarjeta.back")}</a>
        {" · "}
        <a href={rutaReservaBarberia(shop.slug)}>{t("barber.tarjeta.book")}</a>
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
