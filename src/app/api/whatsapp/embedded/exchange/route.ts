import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { encryptField } from "@/lib/crypto/envelope";
import { WA_GRAPH_VERSION } from "@/lib/whatsapp/embedded/types";
import { provisionClinicTemplates } from "@/lib/whatsapp/provision-templates";

const GRAPH = `https://graph.facebook.com/${WA_GRAPH_VERSION}`;

const Body = z.object({
  code: z.string().min(8),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
});

/**
 * Cierra el WhatsApp Embedded Signup: intercambia el `code` del popup por un
 * token de negocio, suscribe NUESTRA app al WABA de la clínica (sin esto los
 * mensajes no llegan al webhook), registra el número (best-effort; en
 * coexistence el número ya vive en la app de WhatsApp Business) y guarda las
 * credenciales cifradas por clinicId. El webhook existente enruta por
 * waPhoneNumberId.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const clinicId = ctx!.clinicId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Datos del onboarding incompletos" }, { status: 400 });
  }
  const { code, wabaId, phoneNumberId } = parsed.data;

  // Seguridad (auditoría «cloudflare», nº4): el número entra del cuerpo de la
  // petición y el webhook enruta por él. Si ya es de OTRA clínica dental, no se
  // toca (409) — antes de cambiar nada en Meta.
  const otraClinica = await prisma.clinic.findFirst({
    where: { waPhoneNumberId: phoneNumberId, id: { not: clinicId } },
    select: { id: true },
  });
  if (otraClinica) {
    return NextResponse.json(
      { success: false, error: "Ese número de WhatsApp ya está conectado a otra clínica." },
      { status: 409 },
    );
  }

  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ success: false, error: "Servidor sin META_APP_ID/META_APP_SECRET" }, { status: 503 });
  }

  try {
    // 1) code → token de negocio (server-side; el secret nunca sale al cliente).
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
    );
    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson?.access_token) {
      return NextResponse.json(
        { success: false, error: `No se pudo obtener el token (${tokenJson?.error?.message ?? "código inválido"})` },
        { status: 400 },
      );
    }
    const token: string = tokenJson.access_token;
    const auth = { Authorization: `Bearer ${token}` };

    // 1b) Seguridad (auditoría «cloudflare», nº4): el número tiene que ser de
    //     ESE WABA, leído con el token del intercambio. Antes solo se pedían a
    //     Meta llamadas «best-effort» cuyo resultado no se miraba, así que una
    //     clínica podía guardar el phone_number_id de otro negocio y quedarse
    //     con sus mensajes entrantes. Sin la prueba no se suscribe, no se
    //     registra y no se guarda nada.
    if (!(await wabaTieneElNumero(wabaId, phoneNumberId, auth))) {
      return NextResponse.json(
        { success: false, error: "Ese número no pertenece a la cuenta de WhatsApp Business que conectaste." },
        { status: 403 },
      );
    }

    // 2) Suscribir la app al WABA — REQUISITO para recibir mensajes en el webhook.
    let subscribed = false;
    try {
      const subRes = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: "POST",
        headers: auth,
      });
      subscribed = subRes.ok;
    } catch {
      /* se puede reintentar al reconectar; no perdemos las credenciales por esto */
    }

    // 3) Registrar el número en la Cloud API (best-effort; si el ES ya lo
    //    registró, es coexistence o ya tiene two-step, Meta responde error tolerable).
    try {
      const pin = (phoneNumberId.replace(/\D/g, "").slice(-6) || "000000").padStart(6, "0");
      await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
    } catch {
      /* ya registrado / no aplica */
    }

    // 4) Nombre para mostrar (opcional).
    let displayName: string | undefined;
    try {
      const meRes = await fetch(
        `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
        { headers: auth },
      );
      const meJson: any = await meRes.json().catch(() => ({}));
      displayName = meJson?.verified_name ?? meJson?.display_phone_number ?? undefined;
    } catch {
      /* opcional */
    }

    // 5) Guardar en la clínica (token CIFRADO en reposo).
    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        waPhoneNumberId: phoneNumberId,
        waBusinessAccountId: wabaId,
        waAccessToken: encryptField(token),
        waConnected: true,
        waConnMethod: "embedded",
      },
    });

    // 6) Plantillas del catálogo dentro de la WABA recién conectada, en segundo
    //    plano: son cinco llamadas a Meta y el onboarding no puede demorarse ni
    //    fallar por esto. El botón del panel y el cron son la red de respaldo.
    void provisionClinicTemplates(clinicId).catch((e) => {
      console.error(`[whatsapp/embedded] alta de plantillas (${clinicId}):`, e);
    });

    return NextResponse.json({ success: true, displayName, subscribed });
  } catch {
    return NextResponse.json({ success: false, error: "Error al conectar con Meta" }, { status: 500 });
  }
}

/**
 * ¿`GET /{wabaId}/phone_numbers`, con el token del intercambio, lista el
 * número? Sigue la paginación de Graph (pocas páginas: un WABA tiene pocos
 * números). Cualquier respuesta que no sea ok cuenta como «no».
 */
async function wabaTieneElNumero(
  wabaId: string,
  phoneNumberId: string,
  auth: Record<string, string>,
): Promise<boolean> {
  let url: string | null = `${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`;
  for (let pagina = 0; url && pagina < 5; pagina++) {
    const res: Response = await fetch(url, { headers: auth });
    if (!res.ok) return false;
    const json: any = await res.json().catch(() => null);
    const ids: string[] = Array.isArray(json?.data) ? json.data.map((n: any) => String(n?.id ?? "")) : [];
    if (ids.includes(phoneNumberId)) return true;
    const siguiente = json?.paging?.next;
    url = typeof siguiente === "string" && siguiente.startsWith(`${GRAPH}/`) ? siguiente : null;
  }
  return false;
}
