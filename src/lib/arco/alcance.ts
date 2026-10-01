// ─────────────────────────────────────────────────────────────────────────────
// Alcance de las solicitudes ARCO (LFPDPPP).
//
// Dos dueños, nunca mezclados (A3, auditoría 30-sep-2026):
//   · con `clinicId`  → las atiende ESA clínica, desde Ajustes → Solicitudes ARCO.
//   · sin `clinicId`  (anónimas, `POST /api/arco/request` sin patientId) → las
//     atiende el equipo de privacidad de la PLATAFORMA, desde /admin
//     (AdminUser). Ningún usuario de clínica las ve ni las edita, tampoco el
//     SUPER_ADMIN: ese rol lo recibe TODO dueño de clínica al registrarse.
// ─────────────────────────────────────────────────────────────────────────────

export const ESTADOS_ARCO = ["PENDING", "IN_PROGRESS", "RESOLVED", "REJECTED"] as const;
export type EstadoArco = (typeof ESTADOS_ARCO)[number];

/**
 * ¿Puede un usuario de la clínica `clinicaUsuario` ver/editar una solicitud con
 * `clinicaSolicitud`? Solo si la solicitud es de SU clínica. Una anónima
 * (null) o un usuario sin clínica resuelta dan false: nunca se compara
 * `undefined === undefined`.
 */
export function arcoEsDeMiClinica(
  clinicaSolicitud: string | null | undefined,
  clinicaUsuario: string | null | undefined,
): boolean {
  if (!clinicaSolicitud || !clinicaUsuario) return false;
  return clinicaSolicitud === clinicaUsuario;
}

/**
 * Cambio validado de una solicitud: `{ data }`, o `{ error }` con el código a
 * devolver (400). Se distingue con `"error" in r`: el repo corre con
 * `strict: false` y el estrechamiento por un `ok: boolean` no funciona.
 */
export type CambioArco =
  | { data: { status?: EstadoArco; resolvedAt?: Date | null; resolvedNotes?: string | null } }
  | { error: "invalid_status" };

/** Arma el `data` del update desde el body del PATCH (mismo para clínica y admin). */
export function armarCambioArco(
  body: { status?: unknown; resolvedNotes?: unknown },
  ahora: Date = new Date(),
): CambioArco {
  const data: { status?: EstadoArco; resolvedAt?: Date | null; resolvedNotes?: string | null } = {};
  if (body.status !== undefined) {
    const status = String(body.status).toUpperCase();
    if (!(ESTADOS_ARCO as readonly string[]).includes(status)) {
      return { error: "invalid_status" };
    }
    data.status = status as EstadoArco;
    if (status === "RESOLVED" || status === "REJECTED") data.resolvedAt = ahora;
    if (status === "PENDING" || status === "IN_PROGRESS") data.resolvedAt = null;
  }
  if (body.resolvedNotes !== undefined) {
    data.resolvedNotes =
      typeof body.resolvedNotes === "string" ? body.resolvedNotes.slice(0, 4000) : null;
  }
  return { data };
}
