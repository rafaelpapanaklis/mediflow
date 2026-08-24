// ═══════════════════════════════════════════════════════════════════════
// /barber/fila/[slug] — página PÚBLICA de la fila (la del QR del mostrador).
//
// Vive FUERA del grupo (panel) a propósito: así NO le toca el guard de
// sesión del layout del panel. Quien escanea el QR no tiene cuenta y no
// debería necesitarla.
//
// El tema caramelo se trae con la clase .barber-shell + barber-theme.css,
// igual que el panel: los tokens (--bg, --text-1, --brand…) viven bajo esa
// clase y sin ella la página saldría con los colores del panel dental.
//
// Qué NO sale de aquí: nada de los demás en la fila. La API pública solo
// devuelve el CONTEO y, si traes tu ticket, lo tuyo.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { WalkinPublic } from "@/components/barber/walkin/walkin-public";
import "../../barber-theme.css";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

/**
 * Solo lo público de la barbería. Select explícito a propósito: la fila
 * completa de Barbershop trae el token de WhatsApp y los ids de Stripe, y
 * esto lo pinta una página abierta a la calle.
 */
async function loadShop(slug: string) {
  try {
    return await prisma.barbershop.findFirst({
      where: { slug: slug.toLowerCase() },
      select: {
        name: true,
        slug: true,
        logoUrl: true,
        locale: true,
        isActive: true,
        subscriptionStatus: true,
      },
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const shop = await loadShop(params.slug);
  return {
    title: shop ? `Fila virtual · ${shop.name}` : "Fila virtual",
    description: "Anótate en la fila desde tu celular y mira tu lugar en vivo.",
    // La fila de una barbería no es contenido para buscadores: se llega por
    // el QR del mostrador y punto.
    robots: { index: false, follow: false },
  };
}

export default async function BarberPublicQueuePage({ params }: PageProps) {
  const shop = await loadShop(params.slug);
  const open = Boolean(shop && shop.isActive && isBarbershopSubscriptionActive(shop));

  return (
    <div className="barber-shell">
      <WalkinPublic
        dict={getBarberDict(open ? shop?.locale : "es")}
        slug={params.slug.toLowerCase()}
        shopName={open && shop ? shop.name : ""}
        logoUrl={open && shop ? shop.logoUrl : null}
      />
    </div>
  );
}
