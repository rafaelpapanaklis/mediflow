import { getLoyaltyRule, type LoyaltyDb } from "@/lib/barber/loyalty-core";
import { cardPath, cardVersion, firstNameOf, signCardToken } from "@/lib/barber/stars-core";
import { barberClientOptedOut } from "@/lib/barber/whatsapp-core";
import {
  TARJETA_PHONE_DAY_LIMIT,
  TARJETA_PHONE_LIMIT,
  claveFrenoTarjeta,
  sitioDeTarjeta,
  type CanalTarjeta,
} from "@/lib/barber/tarjeta-web-core";

/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» — la capa con base y WhatsApp (ws6-t2).

   Todo lo que toca el mundo (base, Meta, freno de intentos) entra por
   `TarjetaDeps`: la ruta usa `depsDeTarjeta()` y las pruebas pasan dobles,
   así que ninguna prueba manda un WhatsApp ni toca Meta.

   🔒 Lo que esta capa garantiza:
     · NUNCA devuelve la tarjeta ni el enlace a quien pregunta: el enlace
       solo viaja por WhatsApp al número que está guardado en el cliente.
     · La respuesta es la MISMA exista o no el cliente, esté bloqueado, se
       haya dado de baja o se haya pasado del tope: `canal: "whatsapp"`.
     · El envío NO se espera: se devuelve como `enviar` para que la ruta lo
       corra después de responder. Así el tiempo de respuesta tampoco delata
       quién es cliente (el WhatsApp tarda; el «no existe», no).
   ═══════════════════════════════════════════════════════════════════════ */

/** El cliente de base (prisma, o el doble de las pruebas). */
export type TarjetaDb = LoyaltyDb;

export interface TarjetaDeps {
  db: TarjetaDb;
  /** ¿WhatsApp conectado y plantilla aprobada? Nunca lanza. */
  sendable(barbershopId: string): Promise<boolean>;
  /** Manda el enlace. true = Meta lo aceptó. Nunca lanza. */
  send(args: { barbershopId: string; phone: string; firstName: string; url: string }): Promise<boolean>;
  /** Freno por clave (número). true = pasa. */
  allow(key: string, limit: number, windowSec: number): Promise<boolean>;
  /** Dominio público, sin barra final. */
  siteUrl: string;
}

/**
 * ¿Por dónde le llega la tarjeta al cliente de ESTA barbería?
 * Sin estrellas encendidas no hay nada que mandar: «barberia».
 */
export async function canalDeTarjeta(
  deps: Pick<TarjetaDeps, "db" | "sendable">,
  barbershopId: string,
): Promise<CanalTarjeta> {
  if (!barbershopId) return "barberia";
  const rule = await getLoyaltyRule(deps.db, barbershopId);
  if (!rule.enabled) return "barberia";
  return (await deps.sendable(barbershopId)) ? "whatsapp" : "barberia";
}

export interface PedidoDeTarjeta {
  canal: CanalTarjeta;
  /**
   * El envío pendiente, o null si no hay nada que mandar. La ruta lo corre
   * DESPUÉS de responder. Nunca lanza.
   */
  enviar: (() => Promise<void>) | null;
}

/**
 * El cliente pidió su tarjeta con este teléfono (ya normalizado como se
 * guarda: 10 dígitos de México o «+E.164»).
 */
export async function pedirTarjeta(
  deps: TarjetaDeps,
  args: { shop: { id: string; slug: string }; phone: string },
): Promise<PedidoDeTarjeta> {
  const { shop, phone } = args;
  const canal = await canalDeTarjeta(deps, shop.id);
  if (canal === "barberia") return { canal, enviar: null };

  // Los frenos y la consulta se hacen SIEMPRE, en el mismo orden, exista o no
  // el cliente: lo único que cambia entre un caso y otro es `enviar`.
  const [porHora, porDia] = await Promise.all([
    deps.allow(claveFrenoTarjeta(shop.id, phone, "hora"), TARJETA_PHONE_LIMIT.limit, TARJETA_PHONE_LIMIT.windowSec),
    deps.allow(claveFrenoTarjeta(shop.id, phone, "dia"), TARJETA_PHONE_DAY_LIMIT.limit, TARJETA_PHONE_DAY_LIMIT.windowSec),
  ]);
  const pasa = porHora && porDia;
  const client = await deps.db.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true, name: true, preferences: true, blockedAt: true },
  });

  if (!pasa || !client || client.blockedAt || barberClientOptedOut(client.preferences)) {
    return { canal, enviar: null };
  }

  const token = signCardToken(shop.id, client.id, cardVersion(client.preferences));
  const url = `${deps.siteUrl}${cardPath(shop.slug, token)}`;
  const firstName = firstNameOf(client.name);
  return {
    canal,
    enviar: async () => {
      try {
        await deps.send({ barbershopId: shop.id, phone, firstName, url });
      } catch (err) {
        console.error(`[barber/tarjeta] no se pudo mandar la tarjeta (${shop.id}):`, err instanceof Error ? err.message : err);
      }
    },
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

/** Las dependencias de verdad. Import perezoso: whatsapp.ts es «server-only». */
export async function depsDeTarjeta(): Promise<TarjetaDeps> {
  const [{ prisma }, wa, { persistentRateLimitKey }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/barber/whatsapp"),
    import("@/lib/failban"),
  ]);
  return {
    db: prisma as unknown as TarjetaDb,
    sendable: (id) => wa.barberMiTarjetaSendable(id),
    send: (a) => wa.sendBarberMiTarjeta(a),
    allow: (key, limit, windowSec) => persistentRateLimitKey(key, limit, windowSec),
    siteUrl: sitioDeTarjeta(process.env),
  };
}
