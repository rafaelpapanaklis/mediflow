// GET /api/realty/pld/bitacora — quién consultó qué y cuándo.
//
// La mitad auditable de la bóveda. `?fileId=` acota a un expediente; sin él
// devuelve los últimos accesos de la cuenta.
//
// Pide pld.view, no pld.manage: revisar la bitácora es exactamente lo que
// hace un auditor, y un auditor no debería poder escribir nada.
import { NextResponse } from "next/server";
import { leerBitacora } from "@/lib/realty/pld/bitacora";
import { errorPld, gatePld } from "../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await gatePld("pld.view");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const url = new URL(req.url);
    const fileId = url.searchParams.get("fileId");
    const take = Number(url.searchParams.get("take") ?? "");

    // El fileId llega del navegador, así que leerBitacora lo mete en un
    // where que SIEMPRE lleva también el accountId. Un fileId de otra
    // inmobiliaria devuelve una lista vacía, no la bitácora ajena.
    const renglones = await leerBitacora(ctx, {
      fileId: fileId || null,
      take: Number.isFinite(take) && take > 0 ? take : undefined,
    });
    return NextResponse.json({ renglones });
  } catch (e) {
    return errorPld("bitacora", e);
  }
}
