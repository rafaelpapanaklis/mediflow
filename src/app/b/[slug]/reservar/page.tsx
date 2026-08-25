import type { Metadata } from "next";
import {
  getPublicBarbers,
  getPublicContact,
  getPublicServices,
  isBookingGateOk,
  resolveBookingGate,
  toPublicShop,
} from "@/lib/barber/booking";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BookingFlow } from "@/components/barber/booking/booking-flow";
import "@/app/barber/barber-theme.css";
import "@/components/barber/booking/barber-public.css";

/* ═══════════════════════════════════════════════════════════════════════
   /b/[slug]/reservar — el embudo público de reserva.

   SIN sesión. La barbería sale del slug, en el servidor. Al navegador solo
   viaja lo que devuelve toPublicShop() + el catálogo público: ni un token,
   ni un teléfono de otro cliente, ni nada interno.

   El botón "Reservar" de la mini-web (T8) apunta aquí; el acoplamiento
   entre las dos superficies es esta URL y nada más.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
  searchParams: { barbero?: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const gate = await resolveBookingGate(params.slug);
  const ok = isBookingGateOk(gate);
  const t = getBarberT(ok ? gate.shop.locale : "es");
  if (!ok) {
    return { title: t("barber.reserva.cerrado.noEncontrada"), robots: { index: false, follow: false } };
  }
  const shop = toPublicShop(gate.shop);
  return {
    title: t("barber.reserva.meta.title", { shop: shop.name }),
    description: t("barber.reserva.meta.description", { shop: shop.name }),
    // noindex, follow — decidido en la ola de SEO del vertical.
    //
    // Esta pantalla es contenido CALCADO de /b/<slug>: los mismos servicios,
    // los mismos barberos, el mismo negocio. Indexarla pone a la barbería a
    // competir contra su propia página en Google (y la que gana la pelea
    // suele ser la peor de las dos para convertir: un formulario sin fotos,
    // sin horario y sin reseñas). Además se sirve force-dynamic, así que
    // cada visita del robot es una lectura de la base que no vende nada.
    //
    // `follow` sí: el robot llega, no la indexa, y sigue los enlaces hacia
    // /b/<slug>, que es la página que SÍ queremos posicionada. Por eso el
    // noindex vive aquí y no en un Disallow de robots.txt: un Disallow
    // impediría rastrear la página y, con ella, LEER este noindex.
    robots: { index: false, follow: true },
    openGraph: {
      title: t("barber.reserva.meta.title", { shop: shop.name }),
      description: t("barber.reserva.meta.description", { shop: shop.name }),
      type: "website",
    },
  };
}

export default async function BarberBookingPage({ params, searchParams }: PageProps) {
  const gate = await resolveBookingGate(params.slug);

  if (!isBookingGateOk(gate)) {
    const t = getBarberT("es");
    return (
      <Shell>
        <div className="dcb-card" style={{ marginTop: 32, textAlign: "center" }}>
          <h1 className="dcb-title" style={{ marginTop: 0 }}>
            {gate.reason === "notFound"
              ? t("barber.reserva.cerrado.noEncontrada")
              : t("barber.reserva.cerrado.title")}
          </h1>
          {gate.reason !== "notFound" ? (
            <p className="dcb-sub" style={{ marginBottom: 0 }}>
              {t("barber.reserva.cerrado.body")}
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }

  const shop = toPublicShop(gate.shop);
  // El contacto viaja aparte de toPublicShop(): solo WhatsApp y teléfono,
  // para que la página pueda decir "escríbeles" cuando no hay horarios en
  // línea en vez de dar a entender que la barbería está llena.
  const [services, barbers, contact] = await Promise.all([
    getPublicServices(shop.id),
    getPublicBarbers(shop.id),
    getPublicContact({ id: shop.id, phone: shop.phone }),
  ]);

  // Liga directa por barbero (?barbero=<id>) para compartir en WhatsApp o en
  // la bio de Instagram. Un id que no sea de ESTA barbería se ignora.
  const pinned = typeof searchParams.barbero === "string" ? searchParams.barbero : null;
  const pinnedBarberId = pinned && barbers.some((b) => b.id === pinned) ? pinned : null;

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
            <p className="dcb-head__meta">
              {[shop.branchName, shop.city].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </header>

      <BookingFlow
        slug={shop.slug}
        shop={shop}
        services={services}
        barbers={barbers}
        contact={contact}
        pinnedBarberId={pinnedBarberId}
      />
    </Shell>
  );
}

/** El tema caramelo se aplica por .barber-shell; .dcb-public abre el
 *  contenedor de las @container queries de las superficies públicas. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="barber-shell">
      <div className="dcb-public">
        <div className="dcb-shell">{children}</div>
      </div>
    </div>
  );
}
