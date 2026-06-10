import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { triggerAutoRechargeIfNeeded } from "@/lib/ai-billing/recharge";
import { GRACE_OVERDRAFT_CENTS } from "@/lib/ai-billing/types";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Umbral de alerta por defecto (centavos MXN) cuando la clínica no configuró
// auto-recarga con su propio umbral. 50 MXN.
const LOW_BALANCE_ALERT_CENTS = 5_000;
// No re-avisar más de una vez por ventana: evita spam en corridas horarias.
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;

function fmtMXN(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

// GET /api/cron/ai-wallet
// Mantenimiento horario del monedero de IA por clínica:
//  (a) backstop de auto-recarga (por si el disparo inline falló tras un cobro),
//  (b) alerta de saldo bajo (WhatsApp best-effort + lowBalanceNotifiedAt durable),
//  (c) pausa del monedero sin saldo (status=PAUSED ⇒ canSpend=false ⇒ el bot cae
//      a handoff; la FAQ por reglas sigue gratis) y reactivación al recuperar saldo.
// Idempotente, por lotes, con errores aislados por clínica.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/ai-wallet] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let scanned = 0, recharged = 0, paused = 0, reactivated = 0;
  let alerted = 0, waSent = 0, waFailed = 0, cleared = 0, errors = 0;

  // Monederos (1 por clínica, filas pequeñas): se traen todos y se decide en
  // memoria, porque el umbral de alerta/recarga es POR monedero y no se puede
  // comparar columna-contra-columna en el WHERE de Prisma.
  const wallets = await prisma.aiWallet.findMany({
    select: {
      clinicId: true,
      balanceCents: true,
      autoRecharge: true,
      autoRechargeThresholdCents: true,
      stripePaymentMethodId: true,
      status: true,
      lowBalanceNotifiedAt: true,
    },
  });

  // AiWallet NO tiene relación Prisma con Clinic (la FK vive en SQL), así que se
  // cargan los datos de contacto en una sola query y se unen en memoria.
  const clinicIds = wallets.map((w) => w.clinicId);
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({
        where: { id: { in: clinicIds } },
        select: {
          id: true, name: true, phone: true,
          waConnected: true, waPhoneNumberId: true, waAccessToken: true,
        },
      })
    : [];
  const clinicById = new Map(clinics.map((c) => [c.id, c]));

  for (const w of wallets) {
    scanned++;
    try {
      let balance = w.balanceCents;
      let status = w.status;

      // (a) Backstop de auto-recarga. triggerAutoRechargeIfNeeded se auto-protege
      // (no hace nada si falta config, el monedero está pausado, el saldo ya
      // supera el umbral o hay una recarga Stripe reciente — respeta el mismo
      // cooldown anti doble-cobro), así que es seguro llamarlo. Releemos el
      // saldo después.
      if (w.autoRecharge && balance < w.autoRechargeThresholdCents) {
        await triggerAutoRechargeIfNeeded(w.clinicId);
        const fresh = await prisma.aiWallet.findUnique({
          where: { clinicId: w.clinicId },
          select: { balanceCents: true, status: true },
        });
        if (fresh) {
          if (fresh.balanceCents > balance) recharged++;
          balance = fresh.balanceCents;
          status = fresh.status;
        }
      }

      const data: Prisma.AiWalletUpdateInput = {};

      // (c) Pausa / reactivación según saldo.
      const shouldPause =
        balance <= -GRACE_OVERDRAFT_CENTS ||
        (!w.autoRecharge && balance <= 0);
      if (shouldPause && status !== "PAUSED") {
        data.status = "PAUSED";
        status = "PAUSED";
        paused++;
      } else if (status === "PAUSED" && balance > 0) {
        data.status = "ACTIVE";
        status = "ACTIVE";
        reactivated++;
      }

      // (b) Alerta de saldo bajo. Umbral = el de auto-recarga si está configurado;
      // si no, el piso por defecto.
      const alertThreshold =
        w.autoRecharge && w.autoRechargeThresholdCents > 0
          ? w.autoRechargeThresholdCents
          : LOW_BALANCE_ALERT_CENTS;

      if (balance < alertThreshold) {
        const last = w.lowBalanceNotifiedAt ? w.lowBalanceNotifiedAt.getTime() : 0;
        const stale = now.getTime() - last >= RENOTIFY_AFTER_MS;
        if (stale) {
          data.lowBalanceNotifiedAt = now;
          alerted++;

          // WhatsApp best-effort a la clínica (si conectó su número). El aviso
          // durable es lowBalanceNotifiedAt (lo muestra el panel de Saldo de IA);
          // el WhatsApp es un extra que jamás debe romper la corrida.
          const c = clinicById.get(w.clinicId);
          if (c?.waConnected && c.waPhoneNumberId && c.waAccessToken && c.phone) {
            const msg =
              status === "PAUSED"
                ? `⚠️ *${c.name}*: tu asistente de IA se pausó por falta de saldo (${fmtMXN(balance)}). Recarga en tu panel, en *Saldo de IA*, para que el bot de WhatsApp vuelva a responder solo.`
                : `⚠️ *${c.name}*: el saldo de tu asistente de IA está bajo (${fmtMXN(balance)}). Recárgalo en tu panel, en *Saldo de IA*, para que el bot de WhatsApp siga respondiendo automáticamente.`;
            try {
              await sendWhatsAppMessage(c.waPhoneNumberId, c.waAccessToken, c.phone, msg);
              waSent++;
              await new Promise((r) => setTimeout(r, 150)); // ritmo amable con Meta
            } catch (e) {
              waFailed++;
              console.error(`[cron/ai-wallet] WhatsApp falló para clínica ${w.clinicId}:`, e);
            }
          }
        }
      } else if (w.lowBalanceNotifiedAt) {
        // Saldo recuperado: rearma la alerta para el próximo bajón.
        data.lowBalanceNotifiedAt = null;
        cleared++;
      }

      if (Object.keys(data).length > 0) {
        await prisma.aiWallet.update({ where: { clinicId: w.clinicId }, data });
      }
    } catch (e) {
      errors++;
      console.error(`[cron/ai-wallet] error en clínica ${w.clinicId}:`, e);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned, recharged, paused, reactivated,
    alerted, waSent, waFailed, cleared, errors,
    timestamp: now.toISOString(),
  });
}
