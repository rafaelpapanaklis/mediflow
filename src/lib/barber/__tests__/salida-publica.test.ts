/**
 * AUDITORÍA DE FUGA DE DATOS — qué sale de verdad a las superficies públicas.
 *
 * Correr:
 *   npx tsx --test src/lib/barber/__tests__/salida-publica.test.ts
 *
 * El producto dental tuvo una fuga REAL en su superficie pública: se mandó la
 * fila entera de la barbería-equivalente al navegador, con el token de
 * WhatsApp dentro. La defensa aquí no es "acordarse de no hacerlo", es una
 * lista blanca: se le pasa una fila ENTERA (con todos los secretos que el
 * schema pueda tener hoy y mañana) y se comprueba que del otro lado salen
 * exactamente los campos permitidos y ni uno más.
 *
 * Si alguien agrega una columna secreta a Barbershop, esta prueba sigue
 * pasando y el secreto sigue sin salir — que es justo la propiedad que se
 * quiere. Si alguien mete un campo secreto EN la lista blanca, la prueba de
 * "nada que huela a credencial" lo tumba.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_SHOP_FIELDS, pickPublicShop } from "../booking-core";
import { PORTAL_SHOP_FIELDS, pickPortalShop } from "../portal-core";

/** Una fila de Barbershop tal cual sale de la base, secretos incluidos. */
const FILA_COMPLETA = {
  id: "shop_1",
  name: "Barbería El Filo",
  slug: "el-filo",
  phone: "5512345678",
  email: "hola@elfilo.mx",
  address: "Av. Reforma 100",
  city: "CDMX",
  state: "CDMX",
  timezone: "America/Mexico_City",
  locale: "es",
  logoUrl: "https://cdn/logo.png",
  teamSize: "2-3",
  plan: "PROFESIONAL",
  subscriptionStatus: "active",
  stripeCustomerId: "cus_SECRETO",
  stripeSubscriptionId: "sub_SECRETO",
  parentId: null,
  isActive: true,
  branchName: "Centro",
  isMainBranch: true,
  whatsappSenderMode: "OWN_WABA",
  wabaId: "waba_SECRETO",
  phoneNumberId: "pnid_SECRETO",
  whatsappToken: "EAAG_TOKEN_SUPER_SECRETO",
  whatsappVerifiedAt: new Date(),
  messagesUsedPeriod: 42,
  messagesPeriodStart: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Cualquier llave que HUELA a credencial no puede estar en una lista blanca. */
const OLOR_A_SECRETO = /token|secret|password|apikey|api_key|stripe|waba|phonenumberid|supabase/i;

const CASOS = [
  { nombre: "reserva pública", fields: PUBLIC_SHOP_FIELDS, pick: pickPublicShop },
  { nombre: "portal del cliente", fields: PORTAL_SHOP_FIELDS, pick: pickPortalShop },
] as const;

for (const caso of CASOS) {
  test(`${caso.nombre}: solo salen los campos de la lista blanca`, () => {
    const salida = caso.pick(FILA_COMPLETA) as unknown as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(salida).sort(),
      [...caso.fields].sort(),
      "la salida tiene EXACTAMENTE los campos declarados",
    );
  });

  test(`${caso.nombre}: ni un secreto de la fila llega al navegador`, () => {
    const salida = caso.pick(FILA_COMPLETA) as unknown as Record<string, unknown>;
    const serializado = JSON.stringify(salida);
    for (const prohibido of [
      "whatsappToken", "wabaId", "phoneNumberId", "stripeCustomerId",
      "stripeSubscriptionId", "subscriptionStatus", "plan", "isActive",
      "email", "teamSize", "messagesUsedPeriod", "parentId",
    ]) {
      assert.equal(prohibido in salida, false, `${prohibido} NO puede salir`);
    }
    for (const valor of [
      "EAAG_TOKEN_SUPER_SECRETO", "cus_SECRETO", "sub_SECRETO",
      "waba_SECRETO", "pnid_SECRETO", "hola@elfilo.mx",
    ]) {
      assert.equal(serializado.includes(valor), false, `el valor ${valor} NO puede salir`);
    }
  });

  test(`${caso.nombre}: la lista blanca no contiene nada que huela a credencial`, () => {
    for (const key of caso.fields) {
      assert.equal(
        OLOR_A_SECRETO.test(key),
        false,
        `"${key}" parece una credencial y está en una lista de salida pública`,
      );
    }
  });

  test(`${caso.nombre}: una columna nueva del schema NO se cuela sola`, () => {
    const conColumnaNueva = { ...FILA_COMPLETA, nuevoSecretoDelFuturo: "AAAA-BBBB" };
    const salida = caso.pick(conColumnaNueva) as unknown as Record<string, unknown>;
    assert.equal("nuevoSecretoDelFuturo" in salida, false);
    assert.equal(JSON.stringify(salida).includes("AAAA-BBBB"), false);
  });

  test(`${caso.nombre}: un campo declarado que falta en la fila sale como null, no undefined`, () => {
    // Un undefined desaparece al serializar a JSON y el cliente ve un hueco
    // sin explicación; null es un "no hay" explícito.
    const salida = caso.pick({ id: "x", name: "y", slug: "z" }) as unknown as Record<string, unknown>;
    assert.equal(salida.logoUrl, null);
    assert.equal(salida.branchName, null);
    assert.equal("logoUrl" in JSON.parse(JSON.stringify(salida)), true);
  });
}

test("el teléfono que sale es el de la BARBERÍA, no el de ningún cliente", () => {
  // La barbería publica su propio teléfono a propósito (es su negocio). Lo
  // que jamás sale por estas funciones es el de otra persona: la fila que
  // entra es de Barbershop y no tiene forma de traer un cliente dentro.
  const salida = pickPublicShop(FILA_COMPLETA) as unknown as Record<string, unknown>;
  assert.equal(salida.phone, FILA_COMPLETA.phone);
  assert.equal(Object.keys(salida).some((k) => /client|cliente/i.test(k)), false);
});
