import { NextRequest, NextResponse } from "next/server";
import { origenPublicoDe } from "@/lib/url-publica";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { clienteAdminSupabase } from "@/lib/admin/supabase-admin";
import { estadoSuplantacionDe } from "@/lib/admin/suplantacion";
import { createClient as crearClienteDeSesion } from "@/lib/supabase/server";
import { BARBER_BRANCH_COOKIE } from "@/lib/barber/branch-cookie";
import {
  COOKIE_VER_COMO_PREVIA,
  RUTA_COOKIE_VER_COMO_PREVIA,
  SQL_VER_COMO_BARBERIA,
  VER_COMO_DESTINO,
  VER_COMO_DURACION_MS,
  VIDA_VER_COMO_PREVIA_S,
  decidirEntrada,
  empacarPreviaBarber,
  limpiarNota,
  queHacerConLaPreviaBarber,
  sessionIdDelToken,
  subDelToken,
  type SesionPreviaBarber,
} from "@/lib/barber/ver-como-core";
import { cerrarVerComo, estadoVerComoDe, registrarVerComo, tablaVerComoLista } from "@/lib/barber/ver-como";

/**
 * «Ver como barbería» (ws6-t1, 16-nov-2026): el «Ver como clínica» del dental
 * (POST /api/admin/impersonate, que NO se toca) para el panel /barber.
 *
 *   · solo POST (el middleware exige Origin de esta web en /api/admin) y solo
 *     con sesión de admin de plataforma (getAdminSession: la misma que pide el
 *     dental; ya pasó por su TOTP). Sin ella, 403 y no se genera nada;
 *   · un clic, sin motivo: se registra «Entrada de soporte»;
 *   · la sesión de Supabase del dueño nace AQUÍ y se registra por su
 *     session_id en barber_admin_impersonation_sessions con vencimiento de 2 h;
 *     sin la tabla (SQL sin pegar) contesta 503 y no abre nada;
 *   · la sesión que ya hubiera en el navegador (la del propio admin) no se
 *     revoca: se guarda en COOKIE_VER_COMO_PREVIA y la salida vuelve a ella;
 *   · abre el panel en la sede pedida (cookie dcb_branch): la ficha de una
 *     sucursal entra a esa sucursal.
 */

function pagina(titulo: string, texto: string, barbershopId: string | null, status: number): NextResponse {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const volver = barbershopId
    ? `<a href="/admin/barberias/${encodeURIComponent(barbershopId)}" style="color:#3b82f6;text-decoration:none">← Volver a la ficha de la barbería</a>`
    : `<a href="/admin/barberias" style="color:#3b82f6;text-decoration:none">← Volver a Barberías</a>`;
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}</style></head>
<body><div style="text-align:center;max-width:480px;padding:24px"><h2 style="color:#f59e0b">${esc(titulo)}</h2><p style="color:#94a3b8">${esc(texto)}</p>${volver}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return pagina(
    "Usa el botón «Ver como barbería»",
    "Entrar como una barbería se hace con el botón «Ver como barbería» de su ficha en /admin.",
    id,
    405,
  );
}

async function leerNota(req: NextRequest): Promise<unknown> {
  const tipo = req.headers.get("content-type") ?? "";
  try {
    if (tipo.includes("application/json")) return ((await req.json()) as { nota?: unknown }).nota;
    return (await req.formData()).get("nota");
  } catch {
    return null;
  }
}

/** El dueño con el que se entra: OWNER activo de la sede; si es sucursal sin dueño propio, el de su matriz. */
async function duenoDe(shop: { id: string; parentId: string | null }) {
  const sel = { id: true, supabaseId: true, email: true } as const;
  const propio = await prisma.barberUser.findFirst({
    where: { barbershopId: shop.id, role: "OWNER", isActive: true },
    select: sel,
    orderBy: { createdAt: "asc" },
  });
  if (propio || !shop.parentId) return propio;
  return prisma.barberUser.findFirst({
    where: { barbershopId: shop.parentId, role: "OWNER", isActive: true },
    select: sel,
    orderBy: { createdAt: "asc" },
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  // 1. Solo admins de plataforma (el mismo nivel que «Ver como clínica»).
  const admin = await getAdminSession();
  if (!admin) {
    return pagina("Solo administradores de DaleControl", "Entra a /admin con tu cuenta de administrador.", null, 403);
  }

  const { id } = await props.params;
  const barbershopId = String(id ?? "").trim();
  if (!barbershopId) return pagina("Falta la barbería", "No llegó el id de la barbería.", null, 400);
  const nota = limpiarNota(await leerNota(req));

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return pagina(
      "Falta una variable de entorno",
      "«Ver como barbería» necesita SUPABASE_SERVICE_ROLE_KEY en Vercel, igual que «Ver como clínica».",
      barbershopId,
      500,
    );
  }

  // 2. Sin registro no se entra: la tabla tiene que existir ANTES de abrir nada.
  if (!(await tablaVerComoLista())) {
    return pagina(
      "Falta un paso en la base",
      `«Ver como barbería» necesita su tabla. Pega ${SQL_VER_COMO_BARBERIA} en Supabase y vuelve a intentarlo.`,
      barbershopId,
      503,
    );
  }

  // 3. La barbería, su dueño y la regla de entrada.
  const shop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: { id: true, name: true, parentId: true, isActive: true, subscriptionStatus: true },
  });
  // Una sucursal hereda la suscripción de su matriz.
  const raiz = shop?.parentId
    ? await prisma.barbershop.findUnique({ where: { id: shop.parentId }, select: { subscriptionStatus: true } })
    : null;
  const owner = shop ? await duenoDe(shop) : null;
  const ownerEsTambienDental = owner
    ? !!(await prisma.user.findFirst({ where: { supabaseId: owner.supabaseId }, select: { id: true } }))
    : false;
  const decision = decidirEntrada({
    shop: shop ? { ...shop, subscriptionStatus: raiz?.subscriptionStatus ?? shop.subscriptionStatus } : null,
    owner,
    ownerEsTambienDental,
  });
  // (sin strict, `!decision.ok` no estrecha la unión: se pregunta por el campo)
  if ("titulo" in decision) return pagina(decision.titulo, decision.texto, shop ? barbershopId : null, decision.status);

  // 4. La sesión que ya hay en este navegador.
  const supabase = await crearClienteDeSesion();
  // Un «Ver como clínica» abierto aquí es del dental: no se toca. Primero se sale de él.
  const dental = (await estadoSuplantacionDe(supabase)).tipo;
  if (dental === "activa") {
    return pagina(
      "Ya estás viendo como una clínica",
      "En este navegador hay un «Ver como clínica» abierto. Sal de él con «Salir y volver a /admin» y vuelve a intentarlo.",
      barbershopId,
      409,
    );
  }
  const previa = await estadoVerComoDe(supabase);
  const sesionActual = (await supabase.auth.getSession()).data.session as
    | { access_token?: string; refresh_token?: string }
    | null;
  const subActual = subDelToken(sesionActual?.access_token);
  // Un «Ver como clínica» ya vencido no es una sesión a la que volver: no se guarda.
  const queHacer = dental === "terminada"
    ? "borrar"
    : queHacerConLaPreviaBarber(previa.tipo, !!(sesionActual?.refresh_token && subActual));
  const guardada: SesionPreviaBarber | null = queHacer === "guardar"
    ? { rt: sesionActual!.refresh_token!, sub: subActual!, sede: req.cookies.get(BARBER_BRANCH_COOKIE)?.value || null }
    : null;
  if (previa.tipo === "activa") await cerrarVerComo(previa.fila.id, "reemplazada");
  if (previa.tipo !== "normal" || dental === "terminada") {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
  }
  const deshacer = async () => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* nada que cerrar */ }
    if (guardada) {
      try { await supabase.auth.refreshSession({ refresh_token: guardada.rt }); } catch { /* queda sin sesión */ }
    }
  };

  // 5. Enlace de un solo uso del dueño, canjeado AQUÍ: conocemos su session_id.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  const { data, error } = await clienteAdminSupabase(serviceRoleKey).auth.admin.generateLink({
    type: "magiclink",
    email: owner!.email,
    options: { redirectTo: `${origenPublicoDe(req, req.url)}${VER_COMO_DESTINO}` },
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[barber-ver-como] generateLink falló:", error?.message);
    return pagina("No se pudo entrar", "Supabase no generó el acceso temporal. Inténtalo de nuevo.", barbershopId, 500);
  }
  const canje = await supabase.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  const sessionId = sessionIdDelToken(canje.data?.session?.access_token);
  if (canje.error || !sessionId) {
    console.error("[barber-ver-como] verifyOtp falló:", canje.error?.message);
    if (canje.data?.session) await deshacer();
    return pagina("No se pudo entrar", "No se pudo abrir la sesión temporal. Inténtalo de nuevo.", barbershopId, 500);
  }

  // 6. Registro. Si no queda escrito, se cierra lo abierto y no se entra.
  const expiresAt = new Date(Date.now() + VER_COMO_DURACION_MS);
  try {
    await registrarVerComo({
      adminUserId: admin.user.id,
      adminEmail: admin.user.email,
      barbershopId,
      targetBarberUserId: owner!.id,
      targetSupabaseId: owner!.supabaseId,
      supabaseSessionId: sessionId,
      nota,
      ip,
      userAgent: ua,
      expiresAt,
    });
  } catch (e) {
    console.error("[barber-ver-como] registro falló:", e instanceof Error ? e.message : e);
    await deshacer();
    return pagina("No se pudo registrar la sesión", "No se abre la sesión sin su registro. Inténtalo de nuevo.", barbershopId, 503);
  }
  console.warn("[barber-ver-como]", JSON.stringify({ barbershopId, admin: admin.user.email, ip, expiresAt: expiresAt.toISOString() }));

  // 303: el navegador sigue con GET al panel. Las cookies de Supabase las
  // escribió el cliente SSR de arriba en esta misma respuesta.
  const res = NextResponse.redirect(`${origenPublicoDe(req, req.url)}${VER_COMO_DESTINO}`, 303);
  // La sede pedida (una sucursal cerrada no se opera: el panel se queda en la propia).
  res.cookies.set(BARBER_BRANCH_COOKIE, barbershopId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(VER_COMO_DURACION_MS / 1000),
  });
  if (guardada) {
    res.cookies.set(COOKIE_VER_COMO_PREVIA, empacarPreviaBarber(guardada), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: RUTA_COOKIE_VER_COMO_PREVIA,
      maxAge: VIDA_VER_COMO_PREVIA_S,
    });
  } else if (queHacer === "borrar") {
    res.cookies.set(COOKIE_VER_COMO_PREVIA, "", { path: RUTA_COOKIE_VER_COMO_PREVIA, maxAge: 0 });
  }
  return res;
}
