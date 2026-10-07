/**
 * «Último acceso» y «quién hizo esto» del panel /admin, en UN solo sitio.
 *
 * ── El fallo ────────────────────────────────────────────────────────────────
 * La ficha de clínica (pestaña Actividad), /admin › Clientes y /admin › Churn
 * leían `User.lastLogin`. Nadie escribe esa columna (el login es de Supabase y
 * no pasa por Prisma), así que salía «nunca» para usuarios que entran a diario.
 * La fuente real es `analytics_sessions` con `surface = "dashboard"`: el tracker
 * guarda `userId`, `clinicId` y `lastSeenAt` de cada sesión de panel.
 * `/admin/clinics`, la portada y `/admin/clientes` (lista nueva) ya la usaban;
 * esta pestaña, el detalle del cliente y churn se quedaron atrás.
 *
 * ── La barra sin nombre ─────────────────────────────────────────────────────
 * `audit_logs.userId` es NULL para quien no es del equipo (paciente en su
 * portal, reserva web pública, bot de WhatsApp: `actorType` patient|public|bot).
 * La pestaña pintaba `row.userId` → `null` → barra sin nombre. Y un id que ya no
 * existe en `users` (usuario eliminado) pintaba el id crudo.
 *
 * PURO: sin Prisma ni React, salvo `cargarUltimoAcceso*` que recibe el cliente.
 */

export type FechaEntrada = Date | string | null | undefined;

export function masReciente(...fechas: FechaEntrada[]): Date | null {
  let mejor: Date | null = null;
  for (const f of fechas) {
    if (!f) continue;
    const d = f instanceof Date ? f : new Date(f);
    if (Number.isNaN(d.getTime())) continue;
    if (!mejor || d.getTime() > mejor.getTime()) mejor = d;
  }
  return mejor;
}

export interface SesionPanel { userId: string | null; lastSeenAt: FechaEntrada }

/** Último acceso por usuario: la sesión de panel más reciente, o `lastLogin` si es más nueva. */
export function ultimoAccesoPorUsuario<U extends { id: string; lastLogin?: FechaEntrada }>(
  usuarios: U[],
  sesiones: SesionPanel[],
): Array<U & { ultimoAcceso: string | null }> {
  const porUsuario = new Map<string, Date>();
  for (const s of sesiones) {
    if (!s.userId) continue;
    const d = masReciente(porUsuario.get(s.userId), s.lastSeenAt);
    if (d) porUsuario.set(s.userId, d);
  }
  return usuarios
    .map((u) => ({
      ...u,
      ultimoAcceso: masReciente(porUsuario.get(u.id), u.lastLogin)?.toISOString() ?? null,
    }))
    .sort((a, b) => (b.ultimoAcceso ?? "").localeCompare(a.ultimoAcceso ?? ""));
}

export interface EtiquetaActor { clave: string; etiqueta: string }

/**
 * Quién es el actor de una fila de bitácora. `usuario` es el `User` resuelto (o
 * null si el id ya no existe). Nunca devuelve vacío.
 */
export function etiquetaActor(opts: {
  userId: string | null;
  actorType?: string | null;
  usuario?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
}): EtiquetaActor {
  const { userId, actorType, usuario } = opts;
  if (actorType === "admin") return { clave: "admin", etiqueta: "Soporte DaleControl" };
  if (!userId) {
    switch (actorType) {
      case "bot": return { clave: "bot", etiqueta: "Bot de WhatsApp" };
      case "patient": return { clave: "patient", etiqueta: "Paciente (portal)" };
      case "public": return { clave: "public", etiqueta: "Reserva web pública" };
      default: return { clave: "sistema", etiqueta: "Sistema" };
    }
  }
  if (!usuario) return { clave: `eliminado:${userId}`, etiqueta: "Usuario eliminado" };
  const nombre = `${usuario.firstName ?? ""} ${usuario.lastName ?? ""}`.trim();
  return { clave: userId, etiqueta: nombre || usuario.email || "Usuario sin nombre" };
}

export interface FilaActividad { userId: string | null; actorType: string | null; count: number }

/** Junta filas con la misma etiqueta (p. ej. varios usuarios eliminados) y ordena por conteo. */
export function agruparActividad(
  filas: FilaActividad[],
  usuarios: Record<string, { firstName?: string | null; lastName?: string | null; email?: string | null }>,
): Array<{ clave: string; etiqueta: string; count: number; userId: string | null }> {
  const acc = new Map<string, { clave: string; etiqueta: string; count: number; userId: string | null }>();
  for (const f of filas) {
    const { clave, etiqueta } = etiquetaActor({
      userId: f.userId,
      actorType: f.actorType,
      usuario: f.userId ? usuarios[f.userId] ?? null : null,
    });
    const k = clave.startsWith("eliminado:") ? "eliminado" : clave;
    const previo = acc.get(k);
    if (previo) previo.count += f.count;
    else acc.set(k, { clave: k, etiqueta, count: f.count, userId: f.userId });
  }
  return [...acc.values()].sort((a, b) => b.count - a.count);
}

// ── Lectura (recibe el cliente para poder probarse sin base) ────────────────

interface PrismaSesiones {
  analyticsSession: {
    groupBy: (args: any) => Promise<Array<{ clinicId?: string | null; userId?: string | null; _max: { lastSeenAt: Date | null } }>>;
  };
}

/** clinicId → último `lastSeenAt` de panel de cualquier usuario. Falla suave: {} si no hay tabla. */
export async function ultimoAccesoPorClinica(prisma: PrismaSesiones, clinicIds: string[]): Promise<Map<string, Date>> {
  const salida = new Map<string, Date>();
  const ids = clinicIds.filter(Boolean);
  if (ids.length === 0) return salida;
  try {
    const filas = await prisma.analyticsSession.groupBy({
      by: ["clinicId"],
      where: { surface: "dashboard", clinicId: { in: ids } },
      _max: { lastSeenAt: true },
    });
    for (const f of filas) if (f.clinicId && f._max.lastSeenAt) salida.set(f.clinicId, f._max.lastSeenAt);
  } catch {
    /* sin analítica: el llamador cae a lastLogin */
  }
  return salida;
}
