import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { almacenMenuPersonal } from "@/lib/menu-personalizado/almacen";
import { fusionarOcultas, normalizarDiseno } from "@/lib/menu-personalizado/diseno";

export const dynamic = "force-dynamic";

/**
 * El menú que cada persona se armó a mano («Personalizar», en su tarjeta).
 *
 *   GET    → { disponible, diseno, revision }
 *   PUT    → guarda { diseno, revision } · 409 si otra pestaña guardó en medio
 *   DELETE → volver al menú de fábrica (borra la fila)
 *
 * · userId y clinicId salen SIEMPRE de la sesión (getAuthContext), nunca del
 *   cuerpo. Toda consulta filtra por los dos.
 * · Solo para las clínicas con el menú de dos niveles encendido: sin él esta
 *   API responde 404 y no existe para nadie.
 * · Esto NO da acceso a nada: guarda dónde se pinta cada opción. Lo que cada
 *   persona VE lo sigue decidiendo el filtro de permisos en cada carga.
 */

const LIMITE_CUERPO = 32_000; // el diseño más grande imaginable no llega a 4 KB

function sinCache(cuerpo: unknown, status = 200) {
  return NextResponse.json(cuerpo, {
    status,
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return sinCache({ error: "Unauthorized" }, 401);
  if (!(await menuDosNivelesEncendido(ctx.clinicId))) return sinCache({ error: "No disponible" }, 404);

  const lectura = await almacenMenuPersonal.leer(ctx.userId, ctx.clinicId);
  return sinCache(lectura);
}

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return sinCache({ error: "Unauthorized" }, 401);
  if (!(await menuDosNivelesEncendido(ctx.clinicId))) return sinCache({ error: "No disponible" }, 404);

  const texto = await req.text().catch(() => "");
  if (texto.length > LIMITE_CUERPO) return sinCache({ error: "Diseño demasiado grande" }, 413);
  let cuerpo: { diseno?: unknown; revision?: unknown };
  try {
    cuerpo = JSON.parse(texto || "{}");
  } catch {
    return sinCache({ error: "JSON inválido" }, 400);
  }
  if (!cuerpo || typeof cuerpo !== "object") return sinCache({ error: "JSON inválido" }, 400);

  // Se sanea SIEMPRE en el servidor: ids desconocidos fuera, sin repetidos,
  // nombres recortados, topes aplicados. Lo que se guarda es esto, no lo que llegó.
  const borrador = normalizarDiseno(cuerpo.diseno);
  if (!borrador) return sinCache({ error: "Diseño inválido" }, 400);
  const revision = typeof cuerpo.revision === "string" && cuerpo.revision !== "" ? cuerpo.revision : null;

  // Lo que esta persona NO ve (le quitaron un permiso, su plan cambió) no
  // aparece en el editor y por tanto no viene en el borrador: se conserva en su
  // sitio para que vuelva donde estaba si le devuelven el permiso.
  const previo = await almacenMenuPersonal.leer(ctx.userId, ctx.clinicId);
  if (!previo.disponible) return sinCache({ error: "No disponible" }, 503);
  const aGuardar = fusionarOcultas(previo.diseno, borrador);

  const resultado = await almacenMenuPersonal.guardar(ctx.userId, ctx.clinicId, aGuardar, revision);
  if (resultado.ok === true) return sinCache({ ok: true, diseno: aGuardar, revision: resultado.revision });
  // Otra pestaña guardó en medio: se devuelve lo que hay ahora y decide la persona.
  if (resultado.motivo === "conflicto") return sinCache({ error: "conflicto", actual: resultado.actual }, 409);
  if (resultado.motivo === "no-disponible") return sinCache({ error: "No disponible" }, 503);
  return sinCache({ error: "No se pudo guardar" }, 500);
}

export async function DELETE() {
  const ctx = await getAuthContext();
  if (!ctx) return sinCache({ error: "Unauthorized" }, 401);
  if (!(await menuDosNivelesEncendido(ctx.clinicId))) return sinCache({ error: "No disponible" }, 404);

  const resultado = await almacenMenuPersonal.borrar(ctx.userId, ctx.clinicId);
  if (resultado.ok) return sinCache({ ok: true });
  if (resultado.motivo === "no-disponible") return sinCache({ error: "No disponible" }, 503);
  return sinCache({ error: "No se pudo restablecer" }, 500);
}
