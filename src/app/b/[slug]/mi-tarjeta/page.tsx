import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, MessageCircle, Phone } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/barber/client-portal";
import { getLoyaltyRule } from "@/lib/barber/loyalty-core";
import { barberCaptchaSiteKey } from "@/lib/barber/captcha";
import { normalizarConfigBarberWeb, rutaReservaBarberia, rutaWebBarberia, urlWhatsApp } from "@/lib/barber/landing";
import { rutaTarjetaDeSesion } from "@/lib/barber/tarjeta-web";
import { textoPedirTarjeta } from "@/lib/barber/tarjeta-web-core";
import { datosDeInstalacion } from "@/lib/barber/tarjeta-instalar";
import { coloresDeTarjeta, rutaIconoTarjeta } from "@/lib/barber/tarjeta-instalar-core";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { MiTarjetaForm } from "@/components/barber/stars/mi-tarjeta-form";
import { PielTarjeta } from "@/components/barber/stars/piel-tarjeta";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";
import "@/components/barber/stars/instalar-tarjeta.css";
import "@/components/barber/stars/piel-tarjeta.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/mi-tarjeta — «Mi tarjeta» desde la página web (ws6-t2).

   La puerta fácil a la tarjeta de estrellas: el cliente toca «Mi tarjeta» en
   el menú de la página de su barbería, escribe su teléfono y la ve ahí
   mismo, con la piel de la plantilla de la barbería (decisión de Rafael,
   16-nov: «si se pone el número de teléfono que muestre ahí la tarjeta
   digital, no pasa nada»). No se manda nada por WhatsApp.

   Lo que se enseña es SOLO la tarjeta: nombre de pila, estrellas, bonos e
   historial de estrellas. Ni teléfono completo, ni citas, ni pagos, ni fotos.

   Quien YA entró a «Mi cuenta» va directo a su tarjeta por enlace.

   noindex y sin Referer: es una puerta a datos personales.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const shop = await datosDeInstalacion(params.slug);
  const t = getBarberT(shop?.locale ?? "es");
  return {
    title: shop ? t("barber.tarjeta.meta.title", { shop: shop.name }) : t("barber.reserva.cerrado.noEncontrada"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** El color de la barra del sistema: el acento de la página de la barbería. */
export async function generateViewport(props: PageProps): Promise<Viewport> {
  const params = await props.params;
  const datos = await datosDeInstalacion(params.slug).catch(() => null);
  return datos ? { themeColor: coloresDeTarjeta(datos.template, datos.acento).tema } : {};
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
  const shop = await datosDeInstalacion(params.slug);

  if (!shop) {
    const t = getBarberT("es");
    return (
      <div className="barber-shell">
        <div className="dcb-public">
          <div className="dcb-shell">
            <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
              <h1 className="dcb-title" style={{ marginTop: 0 }}>
                {t("barber.reserva.cerrado.noEncontrada")}
              </h1>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const locale = shop.locale === "en" ? "en" : "es";
  const t = getBarberT(locale);
  const rule = await getLoyaltyRule(prisma, shop.id);

  // Ya entró a «Mi cuenta»: directo a SU tarjeta, sin pedirle nada.
  if (rule.enabled) {
    const session = await getPortalSession(shop.id);
    const ruta = session ? await rutaTarjetaDeSesion(prisma, shop, session.clientId) : null;
    if (ruta) redirect(ruta);
  }

  const whatsapp = rule.enabled ? await whatsappDeLaPagina(shop.id) : null;
  const wa = urlWhatsApp(whatsapp, textoPedirTarjeta(locale));
  const tel = shop.phone ? `tel:${shop.phone.replace(/[^\d+]/g, "")}` : null;

  // Lo que se ofrece cuando el número no aparece: reservar y hablar con la barbería.
  const salidas = (
    <div className="dcb-piel__salidas">
      <a className="dcb-btn dcb-btn--primary" href={rutaReservaBarberia(shop.slug)}>
        <CalendarDays size={16} aria-hidden="true" />
        {t("barber.tarjeta.book")}
      </a>
      {wa ? (
        <a className="dcb-btn dcb-btn--ghost" href={wa} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={16} aria-hidden="true" />
          {t("barber.tarjeta.whatsapp")}
        </a>
      ) : null}
      {tel ? (
        <a className="dcb-btn dcb-btn--ghost" href={tel}>
          <Phone size={16} aria-hidden="true" />
          {t("barber.tarjeta.call")} · {shop.phone}
        </a>
      ) : null}
    </div>
  );

  return (
    <PielTarjeta template={shop.template} acento={shop.acento} shop={shop}>
      {!rule.enabled ? (
        <div className="dcb-card" style={{ marginTop: 18, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>
            {t("barber.tarjeta.off")}
          </h1>
        </div>
      ) : (
        <MiTarjetaForm
          slug={shop.slug}
          locale={locale}
          timezone={shop.timezone}
          captchaSiteKey={barberCaptchaSiteKey()}
          iconHref={rutaIconoTarjeta(shop.slug, 180)}
          starsDict={((getBarberDict(locale).barber as Dictionary).estrellas ?? {}) as Dictionary}
          salidas={salidas}
          labels={{
            title: t("barber.tarjeta.title"),
            sub: t("barber.tarjeta.sub"),
            phone: t("barber.tarjeta.phone"),
            country: t("barber.tarjeta.country"),
            placeholderMx: t("barber.tarjeta.placeholderMx"),
            placeholderOther: t("barber.tarjeta.placeholderOther"),
            remember: t("barber.tarjeta.remember"),
            send: t("barber.tarjeta.send"),
            sending: t("barber.tarjeta.sending"),
            hello: t("barber.tarjeta.hello", { name: "{name}" }),
            cardSub: t("barber.tarjeta.cardSub"),
            notMe: t("barber.tarjeta.notMe"),
            linkTitle: t("barber.tarjeta.linkTitle"),
            linkBody: t("barber.tarjeta.linkBody"),
            linkOpen: t("barber.tarjeta.linkOpen"),
            linkCopy: t("barber.tarjeta.linkCopy"),
            linkCopied: t("barber.tarjeta.linkCopied"),
            notFoundTitle: t("barber.tarjeta.notFoundTitle", { shop: shop.name }),
            notFoundBody: t("barber.tarjeta.notFoundBody"),
            tryAgain: t("barber.tarjeta.tryAgain"),
            errorPhone: t("barber.tarjeta.errors.phone"),
            errorGeneric: t("barber.tarjeta.errors.generic"),
            errorNetwork: t("barber.tarjeta.errors.network"),
            errorTooMany: t("barber.tarjeta.errors.tooMany"),
            captchaError: t("barber.reserva.captcha.error"),
            captchaRetry: t("barber.reserva.captcha.reintentar"),
          }}
          instalar={{
            title: t("barber.tarjeta.install.title"),
            body: t("barber.tarjeta.install.body"),
            button: t("barber.tarjeta.install.button"),
            close: t("barber.tarjeta.install.close"),
            iphoneStep1: t("barber.tarjeta.install.iphoneStep1"),
            iphoneStep2: t("barber.tarjeta.install.iphoneStep2"),
            androidStep1: t("barber.tarjeta.install.androidStep1"),
            androidStep2: t("barber.tarjeta.install.androidStep2"),
            done: t("barber.tarjeta.install.done"),
          }}
        />
      )}

      <p className="dcb-foot">
        <a href={rutaWebBarberia(shop.slug)}>{t("barber.tarjeta.back")}</a>
        {" · "}
        <a href={rutaReservaBarberia(shop.slug)}>{t("barber.tarjeta.book")}</a>
      </p>
    </PielTarjeta>
  );
}
