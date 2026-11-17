// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — «de dónde llegó» una barbería, para su ficha en
// /admin/barberias/[id] (ws6-t1). El dental enseña el «Origen» de la
// clínica (clinic_ads_clicks: Meta / Google Ads / orgánico, con UTM). El
// alta de barber NO guarda clic de anuncio ni UTM; lo único que sí guarda
// es si llegó REFERIDA por otra barbería del programa de socios
// (barber_affiliate_referrals: primer toque gana, una por barbería).
//
// La cuenta es la matriz: una sucursal enseña el origen de su matriz.
// Sin sql/barber_afiliados.sql: «sin dato», nunca lanza por eso.
// Sin "server-only" (como cash.ts): las pruebas lo importan con tsx.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSchemaBehindError } from "@/lib/barber/db-errors";

export interface OrigenBarberiaDTO {
  /** false = sin la tabla de socios: no se sabe. */
  disponible: boolean;
  /** null = llegó directo (sin socio). */
  referida: {
    porId: string;
    porNombre: string;
    codigo: string;
    estado: string;
    /** Cuándo se registró por el enlace del socio. */
    alta: string;
    /** Primera vez que quedó al día (null = aún no paga). */
    primerPago: string | null;
  } | null;
}

export async function cargarOrigenBarberia(barbershopId: string): Promise<OrigenBarberiaDTO> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ por_id: string; por_nombre: string; code: string; status: string; signed_up_at: Date; first_paid_at: Date | null }>
    >(Prisma.sql`
      SELECT r."barbershopId" AS por_id, s."name" AS por_nombre, r."code", r."status"::text AS status,
             r."signedUpAt" AS signed_up_at, r."firstPaidAt" AS first_paid_at
        FROM "barber_affiliate_referrals" r
        JOIN "barber_shops" s ON s."id" = r."barbershopId"
       WHERE r."referredBarbershopId" =
             (SELECT coalesce(x."parentId", x."id") FROM "barber_shops" x WHERE x."id" = ${barbershopId})
       LIMIT 1
    `);
    const r = rows[0];
    if (!r) return { disponible: true, referida: null };
    return {
      disponible: true,
      referida: {
        porId: r.por_id,
        porNombre: r.por_nombre,
        codigo: r.code,
        estado: r.status,
        alta: new Date(r.signed_up_at).toISOString(),
        primerPago: r.first_paid_at ? new Date(r.first_paid_at).toISOString() : null,
      },
    };
  } catch (e) {
    if (isSchemaBehindError(e)) return { disponible: false, referida: null };
    throw e;
  }
}
