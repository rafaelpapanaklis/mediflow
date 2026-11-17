import { getLoyaltyRule, type LoyaltyDb } from "@/lib/barber/loyalty-core";
import { cardPath, cardVersion, loadStarsView, signCardToken, type StarsView } from "@/lib/barber/stars-core";
import { TARJETA_PHONE_DAY_LIMIT, TARJETA_PHONE_LIMIT, claveFrenoTarjeta } from "@/lib/barber/tarjeta-web-core";

/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» — la capa con base (ws6-t2).

   El cliente escribe su teléfono y, si es cliente de ESA barbería, se le
   enseña su tarjeta de estrellas (decisión de Rafael, 16-nov). Aquí se
   decide qué vuelve al navegador:

     · la MISMA vista que la tarjeta por enlace (`loadStarsView` con
       `audience: "client"`): nombre de pila, estrellas, bonos e historial de
       estrellas. Ni teléfono, ni apellido, ni citas, ni pagos, ni fotos;
     · su enlace personal, para volver sin teclear (el mismo que le daría la
       barbería con el QR).

   El cliente se busca SOLO en la barbería del slug (barbershopId + teléfono):
   el mismo número en otra barbería no existe para esta consulta.

   Todo lo que toca el mundo entra por `TarjetaDeps`: la ruta usa
   `depsDeTarjeta()` y las pruebas pasan dobles.
   ═══════════════════════════════════════════════════════════════════════ */

/** El cliente de base (prisma, o el doble de las pruebas). */
export type TarjetaDb = LoyaltyDb;

export interface TarjetaDeps {
  db: TarjetaDb;
  /** Freno por clave (número). true = pasa. */
  allow(key: string, limit: number, windowSec: number): Promise<boolean>;
  /** La vista de la tarjeta (loadStarsView). Null si el cliente no es de la barbería. */
  loadView(db: TarjetaDb, args: { barbershopId: string; clientId: string; audience: "client" }): Promise<StarsView | null>;
}

export type ResultadoTarjeta =
  /** Es cliente: su tarjeta y su enlace personal (ruta sin dominio). */
  | { estado: "encontrada"; view: StarsView; ruta: string }
  /** Ese número no es de un cliente de esta barbería (o está bloqueado). */
  | { estado: "no" }
  /** Demasiadas consultas de ese número: que espere. */
  | { estado: "frenado" }
  /** La barbería no usa tarjeta de estrellas. */
  | { estado: "apagada" };

/**
 * Busca la tarjeta con el teléfono ya normalizado como se guarda (10 dígitos
 * de México o «+E.164»).
 */
export async function buscarTarjeta(
  deps: TarjetaDeps,
  args: { shop: { id: string; slug: string }; phone: string },
): Promise<ResultadoTarjeta> {
  const { shop, phone } = args;
  if (!shop.id || !phone) return { estado: "no" };

  const rule = await getLoyaltyRule(deps.db, shop.id);
  if (!rule.enabled) return { estado: "apagada" };

  // El freno va ANTES de mirar la base: quien insiste con un número no llega a consultarlo.
  const [porHora, porDia] = await Promise.all([
    deps.allow(claveFrenoTarjeta(shop.id, phone, "hora"), TARJETA_PHONE_LIMIT.limit, TARJETA_PHONE_LIMIT.windowSec),
    deps.allow(claveFrenoTarjeta(shop.id, phone, "dia"), TARJETA_PHONE_DAY_LIMIT.limit, TARJETA_PHONE_DAY_LIMIT.windowSec),
  ]);
  if (!porHora || !porDia) return { estado: "frenado" };

  const client = await deps.db.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true, preferences: true, blockedAt: true },
  });
  if (!client || client.blockedAt) return { estado: "no" };

  const view = await deps.loadView(deps.db, { barbershopId: shop.id, clientId: client.id, audience: "client" });
  if (!view) return { estado: "no" };
  if (!view.enabled) return { estado: "apagada" };

  return {
    estado: "encontrada",
    view,
    ruta: cardPath(shop.slug, signCardToken(shop.id, client.id, cardVersion(client.preferences))),
  };
}

/**
 * La tarjeta del cliente que YA entró a «Mi cuenta» en esta barbería: su
 * ruta personal, para llevarlo directo sin pedirle nada. Null si el cliente
 * de la sesión ya no es de esta barbería o está bloqueado (entonces la
 * página le pide el teléfono como a cualquiera).
 */
export async function rutaTarjetaDeSesion(
  db: TarjetaDb,
  shop: { id: string; slug: string },
  clientId: string,
): Promise<string | null> {
  if (!shop.id || !clientId) return null;
  const client = await db.barberClient.findFirst({
    where: { id: clientId, barbershopId: shop.id },
    select: { id: true, preferences: true, blockedAt: true },
  });
  if (!client || client.blockedAt) return null;
  return cardPath(shop.slug, signCardToken(shop.id, client.id, cardVersion(client.preferences)));
}

/** Las dependencias de verdad (imports perezosos: prisma y el freno son de servidor). */
export async function depsDeTarjeta(): Promise<TarjetaDeps> {
  const [{ prisma }, { persistentRateLimitKey }] = await Promise.all([import("@/lib/prisma"), import("@/lib/failban")]);
  return {
    db: prisma as unknown as TarjetaDb,
    allow: (key, limit, windowSec) => persistentRateLimitKey(key, limit, windowSec),
    loadView: (db, a) => loadStarsView(db, a),
  };
}
