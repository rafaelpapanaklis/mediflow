/**
 * «Ver como barbería» (ws6-t1, 16-nov-2026) — parte PURA: sin base, sin Next.
 *
 * Es el «Ver como clínica» del dental (@/lib/admin/suplantacion-core) para el
 * panel /barber: un admin de plataforma abre, en otra pestaña, el panel de UNA
 * barbería como su dueño. Mismas reglas que el dental:
 *   · la sesión de Supabase nace en el servidor y se registra por su
 *     `session_id` (tabla PROPIA barber_admin_impersonation_sessions: la del
 *     dental exige clinicId y todo lo que la lee da por hecho que es una
 *     clínica);
 *   · dura lo mismo que la del dental (DURACION_SUPLANTACION_MS, 2 h): vencida
 *     o cerrada, getBarberContext la trata como SIN sesión en cada petición;
 *   · al salir, el navegador vuelve a la sesión que tenía antes de entrar.
 *
 * Lo que vive aquí: la vida de la sesión, qué se hace con la sesión previa,
 * la decisión de si se puede entrar y la lista de lo que se BLOQUEA mientras
 * se inspecciona.
 */
import { DURACION_SUPLANTACION_MS, GRACIA_REVOCACION_MS } from "@/lib/admin/suplantacion-core";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";

export { limpiarNota, sessionIdDelToken, subDelToken } from "@/lib/admin/suplantacion-core";

/** La misma duración que «Ver como clínica» (2 h): si el dental la cambia, ésta la sigue. */
export const VER_COMO_DURACION_MS = DURACION_SUPLANTACION_MS;
export const VER_COMO_GRACIA_REVOCACION_MS = GRACIA_REVOCACION_MS;

export const SQL_VER_COMO_BARBERIA = "sql/barber_admin_ver_como.sql";

/** A dónde entra el admin (el enrutador del panel decide Inicio o Suscripción). */
export const VER_COMO_DESTINO = "/barber";

/**
 * Copia de la sesión que había en el navegador antes de entrar (la del propio
 * admin en su clínica o en su barbería). httpOnly, solo viaja a /api (la usan
 * «Salir y volver a /admin» y «Cerrar sesión» del panel). Nombre propio: la
 * del dental es df_sesion_previa y no se toca.
 */
export const COOKIE_VER_COMO_PREVIA = "dcb_ver_como_previa";
export const RUTA_COOKIE_VER_COMO_PREVIA = "/api";
/** Vive más que la sesión (2 h) para poder volver aunque ésta haya vencido sola. */
export const VIDA_VER_COMO_PREVIA_S = 12 * 60 * 60;

export interface FilaVerComo {
  id: string;
  adminUserId: string;
  adminEmail: string;
  barbershopId: string;
  targetBarberUserId: string;
  expiresAt: Date;
  endedAt: Date | null;
}

export type EstadoVerComo =
  | { tipo: "normal" }
  | { tipo: "activa"; fila: FilaVerComo }
  | { tipo: "terminada"; fila: FilaVerComo };

/** Vence por tiempo o por cierre; lo que no está en la tabla es una sesión normal. */
export function estadoVerComo(fila: FilaVerComo | null, ahora: number = Date.now()): EstadoVerComo {
  if (!fila) return { tipo: "normal" };
  if (fila.endedAt) return { tipo: "terminada", fila };
  if (new Date(fila.expiresAt).getTime() <= ahora) return { tipo: "terminada", fila };
  return { tipo: "activa", fila };
}

/** ¿Ya toca revocar en Supabase esta sesión terminada? (vencida: sí; cerrada a mano: tras la gracia). */
export function revocarVerComoYa(fila: FilaVerComo, ahora: number = Date.now()): boolean {
  if (!fila.endedAt) return true;
  return ahora - new Date(fila.endedAt).getTime() >= VER_COMO_GRACIA_REVOCACION_MS;
}

// ─────────────── La sesión previa del navegador ───────────────

export interface SesionPreviaBarber {
  /** refresh token de Supabase de la sesión previa. */
  rt: string;
  /** Su usuario de Supabase (`sub`): al canjear, si no coincide no se usa. */
  sub: string;
  /** La sede que tenía elegida en el selector del panel /barber (dcb_branch), o null. */
  sede: string | null;
}

export function empacarPreviaBarber(s: SesionPreviaBarber): string {
  return Buffer.from(JSON.stringify({ rt: s.rt, sub: s.sub, sede: s.sede }), "utf8").toString("base64url");
}

export function desempacarPreviaBarber(raw: string | null | undefined): SesionPreviaBarber | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof o.rt !== "string" || !o.rt || typeof o.sub !== "string" || !o.sub) return null;
    return { rt: o.rt, sub: o.sub, sede: typeof o.sede === "string" && o.sede ? o.sede : null };
  } catch {
    return null;
  }
}

/**
 * Al entrar, ¿qué pasa con la sesión que ya había en el navegador?
 *   · "guardar": una sesión normal (la del propio admin): NO se cierra ni se
 *     revoca; se guarda para volver a ella al salir.
 *   · "conservar": era otro «Ver como barbería» (se cierra): la copia guardada
 *     sigue siendo la de antes de la PRIMERA entrada.
 *   · "borrar": no había sesión: al salir no hay a dónde volver.
 * Un «Ver como clínica» del dental abierto en este navegador NO llega aquí:
 * la ruta pide salir de él primero (no se toca nada del dental).
 */
export function queHacerConLaPreviaBarber(
  tipoPrevia: EstadoVerComo["tipo"],
  haySesion: boolean,
): "guardar" | "conservar" | "borrar" {
  if (tipoPrevia !== "normal") return "conservar";
  return haySesion ? "guardar" : "borrar";
}

// ─────────────── ¿Se puede entrar? ───────────────

export interface EntradaInfo {
  /** La barbería pedida (matriz o sucursal), o null si no existe. */
  shop: { id: string; name: string; parentId: string | null; isActive: boolean; subscriptionStatus: string } | null;
  /** El dueño con el que se entra (OWNER activo de la sede o de su matriz), o null. */
  owner: { id: string; supabaseId: string; email: string } | null;
  /**
   * ¿Esa misma cuenta de Supabase entra también al panel DENTAL? Entonces la
   * sesión que se abriera valdría en /dashboard sin el vencimiento de 2 h (el
   * dental solo mira su propia tabla): no se entra.
   */
  ownerEsTambienDental: boolean;
}

export type DecisionEntrada =
  | { ok: true; aviso: "suspendida" | "pendiente" | "sucursal_cerrada" | null }
  | { ok: false; status: number; titulo: string; texto: string };

/**
 * Regla de entrada. Una barbería suspendida o con el pago pendiente SÍ se
 * inspecciona (es justo cuando soporte hace falta): el admin ve lo mismo que
 * vería el dueño —el panel recortado a Suscripción y Soporte— y pagar sigue
 * bloqueado. Lo único que no se abre: una barbería que no existe, una sin
 * dueño activo y un dueño cuya cuenta también es de una clínica dental.
 */
export function decidirEntrada(info: EntradaInfo): DecisionEntrada {
  if (!info.shop) {
    return { ok: false, status: 404, titulo: "Barbería no encontrada", texto: "Esa barbería ya no existe." };
  }
  if (!info.owner) {
    return {
      ok: false,
      status: 404,
      titulo: "Barbería sin dueño",
      texto: "Esta barbería no tiene un usuario dueño activo (rol Dueño) con el que entrar.",
    };
  }
  if (info.ownerEsTambienDental) {
    return {
      ok: false,
      status: 409,
      titulo: "Esta cuenta también es de una clínica",
      texto:
        "El dueño de esta barbería entra con la misma cuenta a una clínica dental. Una sesión de «Ver como barbería» valdría también en el panel dental sin su límite de 2 h, así que no se abre. Usa «Ver como clínica» desde la ficha de esa clínica.",
    };
  }
  if (info.shop.parentId && !info.shop.isActive) return { ok: true, aviso: "sucursal_cerrada" };
  // Una sucursal hereda la suscripción de su matriz: la ruta pasa aquí el estado de la matriz.
  if (isBarbershopSubscriptionActive(info.shop)) return { ok: true, aviso: null };
  return { ok: true, aviso: info.shop.subscriptionStatus === "pending_payment" ? "pendiente" : "suspendida" };
}

// ─────────────── Lo que se BLOQUEA mientras se inspecciona ───────────────

/**
 * Acciones que NO se hacen desde «Ver como barbería» (403 VER_COMO_BLOQUEADO).
 * Son las que deciden de quién es la cuenta o a dónde va el dinero: eso no es
 * soporte. El dental hoy solo bloquea conectar la cuenta de cobro de Stripe
 * (src/app/api/stripe/connect/route.ts); aquí se cubre la lista que pidió
 * Rafael. Cada ruta de la lista llama a respuestaSiVerComo (ver-como.ts) y la
 * prueba ver-como-barberia.test.ts lo comprueba archivo por archivo.
 */
export const BLOQUEOS_VER_COMO: ReadonlyArray<{ ruta: string; metodos: string[]; que: string }> = [
  { ruta: "src/app/api/barber/auth/contrasena/route.ts", metodos: ["POST"], que: "cambiar la contraseña del dueño" },
  { ruta: "src/app/api/barber/billing/checkout/route.ts", metodos: ["POST"], que: "pagar o contratar el plan" },
  { ruta: "src/app/api/barber/billing/change-plan/route.ts", metodos: ["POST"], que: "cambiar de plan" },
  { ruta: "src/app/api/barber/billing/cancel/route.ts", metodos: ["POST"], que: "cancelar la suscripción" },
  { ruta: "src/app/api/barber/billing/resume/route.ts", metodos: ["POST"], que: "reanudar la suscripción" },
  { ruta: "src/app/api/barber/billing/portal/route.ts", metodos: ["POST"], que: "abrir el portal de pagos de Stripe (tarjeta, facturas)" },
  { ruta: "src/app/api/barber/mercadopago/oauth/conectar/route.ts", metodos: ["GET"], que: "conectar Mercado Pago (a dónde llegan los cobros)" },
  { ruta: "src/app/api/barber/mercadopago/disconnect/route.ts", metodos: ["POST"], que: "desconectar Mercado Pago" },
  { ruta: "src/app/api/barber/whatsapp/connect/route.ts", metodos: ["POST", "DELETE"], que: "conectar o desconectar WhatsApp" },
];

export const VER_COMO_BLOQUEADO_CODE = "VER_COMO_BLOQUEADO";

export function textoBloqueo(locale: string | null | undefined): string {
  return locale === "en"
    ? "Not available while viewing as this barbershop from DaleControl admin."
    : "No disponible en «Ver como barbería» desde el admin de DaleControl.";
}
