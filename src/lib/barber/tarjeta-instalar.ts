import { prisma } from "@/lib/prisma";
import { resolvePortalShop } from "@/lib/barber/client-portal";
import { normalizarConfigBarberWeb } from "@/lib/barber/landing";

/* ═══════════════════════════════════════════════════════════════════════
   «Agregar a pantalla de inicio» — lo que se lee de la base (ws6-t2).

   SOLO datos públicos de la barbería (nombre, logo, plantilla y acento de su
   página). Nada del cliente: el manifest y el ícono se sirven sin sesión.
   La puerta es la misma de «Mi cuenta» (resolvePortalShop): barbería activa
   y al corriente; si no, null y las rutas contestan 404.
   ═══════════════════════════════════════════════════════════════════════ */

export interface DatosDeInstalacion {
  id: string;
  name: string;
  slug: string;
  locale: string;
  logoUrl: string | null;
  /** Plantilla guardada en Mi web (cualquier id; quien la usa la normaliza). */
  template: string | null;
  acento: string | null;
}

export async function datosDeInstalacion(slug: string): Promise<DatosDeInstalacion | null> {
  const shop = await resolvePortalShop(slug);
  if (!shop) return null;
  let template: string | null = null;
  let acento: string | null = null;
  try {
    const fila = await prisma.barberLandingConfig.findUnique({
      where: { barbershopId: shop.id },
      select: { template: true, config: true },
    });
    template = fila?.template ?? null;
    acento = normalizarConfigBarberWeb(fila?.config).acento;
  } catch {
    // Sin tabla o sin fila: los colores por defecto (Oficio, caramelo).
  }
  return { id: shop.id, name: shop.name, slug: shop.slug, locale: shop.locale, logoUrl: shop.logoUrl, template, acento };
}

