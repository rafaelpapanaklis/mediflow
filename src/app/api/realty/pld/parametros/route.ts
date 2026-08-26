// POST /api/realty/pld/parametros — SIEMBRA la captura inicial de los
// umbrales antilavado.
//
// ── 🔴 ESTA RUTA NO ES DEL CLIENTE ────────────────────────────────────
// La guarda `getAdminSession()`, la sesión del panel de PLATAFORMA, no
// getRealtyContext(). Los umbrales de la LFPIORPI son parámetros de
// plataforma —la tabla realty_calc_params ni siquiera tiene accountId— así
// que una inmobiliaria NO puede moverlos. Si pudiera, bajarse su propio
// umbral sería la forma más simple de no tener que avisar nunca.
//
// Vive bajo /api/realty/pld/** y no bajo /api/admin/** porque esa carpeta
// es de otra terminal de la ola. El corte de acceso es el mismo.
//
// ── QUÉ HACE, EXACTAMENTE ─────────────────────────────────────────────
// Escribe el bloque `pld` dentro del `meta` de las filas UMA que no lo
// tengan, y crea la fila del año si no hay ninguna. Es IDEMPOTENTE y
// ADITIVO: una fila que ya trae el bloque se deja INTACTA. Si alguien
// corrigió un umbral a mano contra el texto de la ley, volver a sembrar NO
// puede devolverle el número de fábrica.
//
// Después de sembrar, la edición fina se hace en
// /admin/inmobiliarias/parametros como cualquier otro parámetro, sin
// desplegar nada.
import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { getPldParamRows, sembrarParametrosPld } from "@/lib/realty/pld/parametros";
import { resolvePldParams } from "@/lib/realty/pld/umbrales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await sembrarParametrosPld();
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });

  logAdminGlobalEvent({
    req,
    admin: { id: session.user.id, email: session.user.email },
    entity: "realty-pld-params",
    entityId: "UMA/MX",
    action: "update",
    before: null,
    after: res,
  });

  // Se devuelve el estado RESUELTO, no solo el conteo: quien siembra tiene
  // que poder ver de inmediato si ya quedó completo o si sigue faltando algo.
  const resueltos = resolvePldParams(await getPldParamRows());
  return NextResponse.json({
    ok: true,
    ...res,
    listo: resueltos.ok,
    faltantes: resueltos.faltantes,
    avisos: resueltos.avisos,
  });
}

/** GET — diagnóstico: ¿ya están capturados los umbrales? */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resueltos = resolvePldParams(await getPldParamRows());
  return NextResponse.json({
    listo: resueltos.ok,
    faltantes: resueltos.faltantes,
    avisos: resueltos.avisos,
    params: resueltos.ok ? resueltos.params : null,
  });
}
