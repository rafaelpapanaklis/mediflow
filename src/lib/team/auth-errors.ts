/* ============================================================
   QUÉ LE PASÓ A SUPABASE AUTH cuando el panel le pidió tocar una cuenta.

   Antes, PATCH /api/team/[id] separaba UN solo caso ("el correo ya existe") y
   todo lo demás salía como «No se pudo actualizar el correo de acceso. No se
   guardó ningún cambio.» — sin causa. Así se vio en BEVADENT (28-sep-2026): la
   fila de la doctora apuntaba a una cuenta de Auth que el reinicio de la clínica
   ya había borrado, Supabase contestó `user_not_found` (404) y el cliente no
   supo si era el correo, la cédula o la conexión.

   Puro (sin red, sin Prisma) para poder probarlo con errores reales de
   supabase-js: `AuthApiError` trae `status`, `code` y `message`.
   ============================================================ */

export type CausaErrorAuth =
  | "cuenta-no-existe" // el supabaseId de la fila ya no está en auth.users
  | "correo-ya-registrado" // el correo es de otra cuenta de la plataforma
  | "correo-invalido" // Supabase rechazó el formato o el dominio
  | "limite" // rate limit / servicio ocupado: reintentar en un rato
  | "otro";

interface ErrorAuthLike {
  message?: string;
  code?: string;
  status?: number;
}

export function clasificarErrorAuth(err: unknown): CausaErrorAuth {
  const e = (err ?? {}) as ErrorAuthLike;
  const code = String(e.code ?? "").toLowerCase();
  const msg = String(e.message ?? "").toLowerCase();
  const status = typeof e.status === "number" ? e.status : 0;

  if (code === "user_not_found" || /user not found|user_not_found/.test(msg)) return "cuenta-no-existe";
  if (code === "email_exists" || /already been registered|already exists|email_exists/.test(msg)) {
    return "correo-ya-registrado";
  }
  if (code === "email_address_invalid" || code === "validation_failed" || /invalid.*email|email.*invalid/.test(msg)) {
    return "correo-invalido";
  }
  if (status === 429 || /rate.?limit|too many/.test(code + " " + msg)) return "limite";
  // Un 404 pelado sin código también es "no existe" (versiones viejas de GoTrue).
  if (status === 404) return "cuenta-no-existe";
  return "otro";
}

/**
 * ¿Este supabaseId tiene forma de usuario de Auth (UUID)?
 *
 * Importa porque supabase-js valida el UUID ANTES de salir a la red y, si no lo
 * es, LANZA una excepción en vez de devolver `{ error }`: la ruta terminaba en un
 * 500 sin cuerpo. Las filas sin acceso real (demos, muestras de QA:
 * «demo-sb-…», «sin-acceso-…») nunca tuvieron cuenta; hay que tratarlas como
 * «sin cuenta» sin preguntarle nada a Auth.
 */
export function esUuid(id: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id ?? ""));
}

/** El error que se le simula a una fila cuyo supabaseId ni siquiera es un UUID. */
export const ERROR_SIN_CUENTA = { status: 404, code: "user_not_found", message: "User not found" } as const;

/** Marcador que dejó el reinicio de una clínica en el correo de quien se desactivó. */
export const DOMINIO_MARCADOR = "@invalid.dalecontrol";

/** ¿Este correo es un relleno interno (no se puede iniciar sesión con él)? */
export function esCorreoMarcador(email: string | null | undefined): boolean {
  return String(email ?? "").trim().toLowerCase().endsWith(DOMINIO_MARCADOR);
}
