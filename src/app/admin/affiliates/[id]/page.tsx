export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatWhatsappDisplay, type AccountManagerDTO } from "@/lib/account-manager/types";
import { AffiliateDetailClient } from "./affiliate-detail-client";

/**
 * Ficha de un afiliado. Affiliate es global (sin clinicId): el middleware y el
 * layout de /admin ya protegen la ruta, igual que en /admin/affiliates.
 *
 * DECISIÓN (server vs client fetch): esta página resuelve SOLO el encabezado
 * (nombre, slug, email, estado, código) — lo justo para el <title> y para que
 * el header pinte sin parpadeo — y delega TODO el resto de la ficha al
 * endpoint GET /api/admin/affiliates/[id]/detail, que el client pide en un
 * useEffect con estados de carga/error y botón Reintentar.
 *
 * Por qué: el cálculo de la ficha (nivel, motor de comisiones, agregados por
 * clínica, historial, equipo) vive así en UN solo lugar en vez de duplicarse
 * entre la página y la API, y el botón "Guardar modalidad" puede refrescar los
 * datos sin recargar la ruta. Es el mismo patrón `loadMetrics` de
 * affiliates-client.tsx.
 */

const AFFILIATE_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  status: true,
  referralCode: true,
} as const;

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const affiliate = await prisma.affiliate
    .findUnique({ where: { id: params.id }, select: { name: true } })
    .catch(() => null);
  return {
    title: affiliate
      ? `${affiliate.name} — Afiliados — Admin DaleControl`
      : "Afiliado — Admin DaleControl",
  };
}

export default async function AdminAffiliateDetailPage({ params }: { params: { id: string } }) {
  const affiliate = await prisma.affiliate
    .findUnique({ where: { id: params.id }, select: AFFILIATE_SELECT })
    .catch(() => null);

  if (!affiliate) notFound();

  // Manager de cuenta asignado. Query APARTE y con su propio catch (NO metida en
  // el select de arriba): si la columna affiliates."accountManagerId" todavía no
  // existiera, ampliar aquel select tumbaría el findUnique entero y el
  // `.catch(() => null)` mandaría la ficha a notFound(). Así el peor caso es
  // "sin manager asignado", que es un estado VÁLIDO.
  let accountManager: AccountManagerDTO | null = null;
  try {
    const withManager = await prisma.affiliate.findUnique({
      where: { id: params.id },
      select: {
        accountManager: {
          select: {
            id: true, name: true, photoUrl: true, whatsappE164: true, whatsappDisplay: true,
            days: true, startMinutes: true, endMinutes: true, timezone: true, status: true,
          },
        },
      },
    });
    const m = withManager?.accountManager;
    if (m) {
      accountManager = {
        ...m,
        photoUrl: m.photoUrl ?? null,
        // Si el admin no capturó el formateado, se deriva del E.164.
        whatsappDisplay: m.whatsappDisplay || formatWhatsappDisplay(m.whatsappE164),
      };
    }
  } catch (e) {
    console.warn("[admin/affiliates/:id] manager de cuenta no disponible:", e);
  }

  return <AffiliateDetailClient initial={affiliate} accountManager={accountManager} />;
}
