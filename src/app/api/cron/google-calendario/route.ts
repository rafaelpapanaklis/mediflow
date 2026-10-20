// Cron: Google Calendar → agenda (WS1-T9). Corre cada 5 min (vercel.json).
//
// Es el RESPALDO del canal de avisos: aunque un aviso de Google se pierda, en
// ≤5 min la agenda refleja el calendario. Además:
//   · crea o renueva el canal de avisos de cada clínica antes de que caduque;
//   · retira (no borra) los bloqueos de Google de las clínicas sin la bandera
//     (apagada o con la fila borrada), que desconectaron Google, o que llevan
//     un día sin sincronizar bien por la causa que sea (y sigue intentándolo:
//     al volver, la pasada completa repone lo que siga ocupado);
//   · vuelve a copiar a Google las citas convertidas cuya copia no llegó.
// Solo clínicas con la bandera encendida; sin el SQL aplicado no hace nada.
// Idempotente: correrlo dos veces seguidas no cambia nada la segunda. Un fallo
// en una clínica no tumba la pasada de las demás.

import { NextRequest, NextResponse } from "next/server";
import {
  asegurarCanalDeAvisos,
  bloqueosDeGoogleSinMantener,
  clinicasConGoogleEntrante,
  clinicasSinBanderaConBloqueos,
  retirarBloqueosDeGoogle,
  sincronizarCalendarioEntrante,
} from "@/lib/google/entrante.server";
import { clinicasConConvertidas, reintentarSalidaDeConvertidas } from "@/lib/google/convertir.server";
import { sincronizarCitaConGoogle } from "@/lib/agenda/google-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PRESUPUESTO_MS = 240_000;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/google-calendario] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limite = Date.now() + PRESUPUESTO_MS;
  const resumen = { clinicas: 0, sincronizadas: 0, fallidas: 0, canales: 0, retirados: 0, pendientes: 0, reintentadas: 0 };

  const conBandera = await clinicasConGoogleEntrante();
  for (const clinicId of conBandera) {
    if (Date.now() >= limite) { resumen.pendientes++; continue; }
    resumen.clinicas++;
    try {
      const m = await bloqueosDeGoogleSinMantener(clinicId);
      if (m.retirar) resumen.retirados += await retirarBloqueosDeGoogle(clinicId);
      if (m.desconectada) continue;
      const canal = await asegurarCanalDeAvisos(clinicId);
      if (canal === "creado" || canal === "renovado") resumen.canales++;
      const restante = Math.max(5_000, Math.min(40_000, limite - Date.now()));
      const r = await sincronizarCalendarioEntrante(clinicId, { presupuestoMs: restante });
      if (r.estado === "ok") resumen.sincronizadas++;
      else if (r.estado === "fallo") resumen.fallidas++;
      // Sin conexión (caída) no se martilla a Google: se reintenta al volver.
      if (r.estado !== "sin_conexion" && Date.now() < limite) {
        resumen.reintentadas += await reintentarSalidaDeConvertidas(clinicId, sincronizarCitaConGoogle, limite);
      }
    } catch (e) {
      resumen.fallidas++;
      console.error(`[cron/google-calendario] clínica ${clinicId}:`, (e as any)?.message ?? e);
    }
  }

  try {
    for (const clinicId of await clinicasSinBanderaConBloqueos()) {
      if (Date.now() >= limite) break;
      try {
        resumen.retirados += await retirarBloqueosDeGoogle(clinicId);
      } catch (e) {
        console.error(`[cron/google-calendario] retirar (clínica ${clinicId}):`, (e as any)?.message ?? e);
      }
    }
  } catch (e) {
    console.error("[cron/google-calendario] clínicas sin bandera:", (e as any)?.message ?? e);
  }

  // Las convertidas de clínicas que ya no tienen la bandera también se reponen.
  try {
    const ya = new Set(conBandera);
    for (const clinicId of await clinicasConConvertidas()) {
      if (Date.now() >= limite) break;
      if (ya.has(clinicId)) continue;
      resumen.reintentadas += await reintentarSalidaDeConvertidas(clinicId, sincronizarCitaConGoogle, limite);
    }
  } catch (e) {
    console.error("[cron/google-calendario] convertidas sin bandera:", (e as any)?.message ?? e);
  }

  return NextResponse.json(resumen);
}
