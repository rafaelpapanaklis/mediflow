// ═══════════════════════════════════════════════════════════════════════
// POST   /api/barber/whatsapp/connect  → cierra el Embedded Signup de Meta
// DELETE /api/barber/whatsapp/connect  → desconecta (sin borrar historial)
//
// Mismo flujo que el del dental (src/app/api/whatsapp/embedded/exchange),
// que YA está aprobado por Meta: el popup devuelve un `code`, aquí se
// cambia por un token de negocio server-side, se suscribe NUESTRA app al
// WABA de la barbería (sin eso los mensajes no llegan al webhook) y se
// guardan las credenciales CIFRADAS por barbershopId.
//
// El archivo del dental NO se toca: esto es una copia propia con las
// credenciales de la barbería. Comparte con él solo el App ID / App Secret
// (son de la misma app de Meta) y su propio config_id de Embedded Signup.
//
// VERIFICACIÓN DE NEGOCIO: no se exige. Un número sin verificar puede
// escribirle a 250 clientes únicos cada 24 h, de sobra para una barbería.
// Se guarda si Meta la reporta y si no, el estado es "sin verificar", que
// la pantalla explica como una nota, no como un error.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  barberWabaOwnsPhone,
  disconnectBarberWa,
  listBarberWabaPhones,
  sharedBarberWabaIds,
  provisionBarberTemplates,
  saveBarberWaConnection,
  subscribeBarberWaba,
} from "@/lib/barber/whatsapp";
import { asString, jsonError, openWaGate, readJson } from "../_server";
import { pickBarberSignupNumber, type WabaListing } from "@/lib/barber/wa-signup-core";

/** Cuántas cuentas compartidas se revisan como mucho al buscar el número. */
const MAX_WABAS_TO_SEARCH = 5;

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

export async function POST(req: Request) {
  const body = await readJson(req);
  const gate = await openWaGate({
    permission: "settings.edit",
    branchId: asString(body?.branchId),
  });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  const code = asString(body?.code);
  // El navegador los manda si Meta le avisó (evento FINISH). Si no llegaron,
  // se buscan abajo con el token: ya no es motivo para rendirse.
  let wabaId = asString(body?.wabaId);
  let phoneNumberId = asString(body?.phoneNumberId);
  if (!code) {
    return jsonError("Faltan datos del onboarding de Meta.", 400, { code: "NO_CODE" });
  }

  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    return jsonError("El servidor no tiene configurado el acceso a Meta.", 503);
  }

  try {
    // 1) code → token de negocio (el secret NUNCA sale al navegador).
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson?.access_token) {
      return jsonError(
        `No se pudo obtener el permiso de Meta (${tokenJson?.error?.message ?? "código inválido"}).`,
        400,
      );
    }
    const token: string = tokenJson.access_token;
    const auth = { Authorization: `Bearer ${token}` };

    // 1a) Llegó el código pero NO el número del evento FINISH: se busca con
    //     el token. Las cuentas compartidas salen de debug_token (más la que
    //     mandó el navegador, si mandó una) y sus números de
    //     /{waba}/phone_numbers. Todo lo que se lee con el token es de quien
    //     autorizó: es la misma prueba de propiedad de 1b. Con varios números
    //     y nada que los distinga NO se adivina.
    if (!wabaId || !phoneNumberId) {
      const wabas = await sharedBarberWabaIds(token, { id: appId, secret: appSecret });
      if (wabaId && !wabas.includes(wabaId)) wabas.unshift(wabaId);
      const listings: WabaListing[] = [];
      for (const w of wabas.slice(0, MAX_WABAS_TO_SEARCH)) {
        const phones = await listBarberWabaPhones(w, token);
        if (phones) listings.push({ wabaId: w, phoneNumberIds: phones });
      }
      const pick = pickBarberSignupNumber({ clientWabaId: wabaId, clientPhoneNumberId: phoneNumberId, listings });
      console.warn(
        `[barber/whatsapp/connect] faltó ${!wabaId && !phoneNumberId ? "la cuenta y el número" : !wabaId ? "la cuenta" : "el número"} del navegador; ` +
          `cuentas compartidas: ${wabas.length}, revisadas: ${listings.length}, resultado: ${pick.ok === false ? pick.code : "encontrado"}`,
      );
      if (pick.ok === false) {
        return jsonError(
          pick.code === "NUMBER_AMBIGUOUS"
            ? "Tu cuenta de WhatsApp Business tiene varios números y Meta no nos dijo cuál elegiste. Vuelve a conectar y elige tu número al final."
            : "Meta no nos dijo qué número conectaste y no lo encontramos en tu cuenta. Vuelve a conectar y termina eligiendo tu número.",
          409,
          { code: pick.code },
        );
      }
      wabaId = pick.wabaId;
      phoneNumberId = pick.phoneNumberId;
    }

    // 1b) 🔴 El número tiene que ser de ESA cuenta, leído con el token que
    //     Meta acaba de dar. `wabaId` y `phoneNumberId` llegan del navegador
    //     y el webhook enruta por phoneNumberId: sin esta prueba, una
    //     barbería podía guardar el número de otro negocio y quedarse con
    //     lo que le escriben. Sin la prueba no se suscribe, no se registra y
    //     no se guarda nada. (Misma comprobación que el alta del dental.)
    if (!(await barberWabaOwnsPhone(wabaId, phoneNumberId, token))) {
      return jsonError(
        "Ese número no pertenece a la cuenta de WhatsApp Business que conectaste.",
        403,
        { code: "PHONE_NOT_IN_WABA" },
      );
    }

    // 1c) Un número ya conectado en OTRA cuenta de DaleControl no puede
    //     reasignarse solo: el webhook enruta por phoneNumberId y dos filas
    //     con el mismo valor harían que los mensajes cayeran en el negocio
    //     equivocado. Va DESPUÉS de la prueba de propiedad: antes, cualquiera
    //     con sesión podía preguntar si un número ajeno ya estaba conectado.
    //     Se mira también entre las clínicas: el webhook resuelve primero a
    //     la clínica, así que una barbería con ese mismo número se vería
    //     "conectada" y jamás recibiría un solo mensaje.
    const { prisma } = await import("@/lib/prisma");
    const [otherShop, otherClinic] = await Promise.all([
      prisma.barbershop.findFirst({
        where: { phoneNumberId, NOT: { id: shopId } },
        select: { id: true },
      }),
      prisma.clinic.findFirst({ where: { waPhoneNumberId: phoneNumberId }, select: { id: true } }),
    ]);
    if (otherShop || otherClinic) {
      return jsonError(
        "Ese número de WhatsApp ya está conectado en otra cuenta de DaleControl. " +
          "Desconéctalo ahí antes de conectarlo aquí.",
        409,
        { code: "PHONE_TAKEN" },
      );
    }

    // 2) Suscribir la app al WABA — REQUISITO para recibir los mensajes. Si
    //    falla NO se pierden las credenciales, pero se le dice a la pantalla:
    //    una conexión que manda y no recibe es media conexión (ni
    //    confirmaciones, ni bandeja, ni bot). La pantalla lo vuelve a
    //    intentar sola cada vez que se abre (ver probeBarberWa).
    const subscribed = await subscribeBarberWaba(wabaId, token);

    // 3) Registrar el número en la Cloud API. Best-effort: en coexistence
    //    (el número sigue viviendo en la app de WhatsApp Business del
    //    celular del dueño) Meta responde un error tolerable.
    try {
      const pin = (phoneNumberId.replace(/\D/g, "").slice(-6) || "000000").padStart(6, "0");
      await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      /* ya registrado / no aplica */
    }

    // 4) Nombre visible y si el negocio está verificado. Las dos cosas son
    //    informativas: sin verificar se opera igual (250 clientes / 24 h).
    let displayName: string | null = null;
    let verified = false;
    try {
      const meRes = await fetch(
        `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,code_verification_status`,
        { headers: auth, signal: AbortSignal.timeout(15000) },
      );
      const meJson: any = await meRes.json().catch(() => ({}));
      displayName = meJson?.verified_name ?? meJson?.display_phone_number ?? null;
      verified = String(meJson?.code_verification_status ?? "").toUpperCase() === "VERIFIED";
    } catch {
      /* informativo */
    }

    await saveBarberWaConnection({ barbershopId: shopId, wabaId, phoneNumberId, token, verified });

    // 5) Plantillas del catálogo dentro de la WABA recién conectada, en
    //    segundo plano: son varias llamadas a Meta y el onboarding no puede
    //    demorarse ni fallar por esto. El botón de la pantalla lo repite.
    void provisionBarberTemplates(shopId).catch((e) => {
      console.error(`[barber/whatsapp/connect] alta de plantillas (${shopId}):`, e);
    });

    return NextResponse.json({ ok: true, displayName, verified, subscribed });
  } catch (err) {
    console.error("[POST barber/whatsapp/connect]", err);
    return jsonError("No se pudo conectar con Meta. Intenta de nuevo.", 500);
  }
}

export async function DELETE(req: Request) {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openWaGate({ permission: "settings.edit", branchId });
  if (gate.response) return gate.response;

  try {
    // El historial de mensajes NO se borra: es de la barbería, no de la
    // conexión. Desconectar solo quita las credenciales.
    await disconnectBarberWa(gate.gate.shopId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE barber/whatsapp/connect]", err);
    return jsonError("No se pudo desconectar.", 500);
  }
}
