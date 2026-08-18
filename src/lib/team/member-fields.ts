/* ============================================================
   QUÉ DE UN MIEMBRO DEL EQUIPO PUEDE VIAJAR AL NAVEGADOR.

   Una LISTA BLANCA, no una lista negra. La diferencia importa: con una
   lista de campos prohibidos, la siguiente columna secreta que alguien
   le añada a `User` sale al cliente por default y nadie se entera. Con
   esta, sale solo lo que está escrito aquí.

   Es el mismo criterio con el que se cerró la fuga de la mini-web
   (0424d5ab), donde `stripClinicSecrets` —que sí es lista negra— se
   cambió por un `select` explícito.

   ── LO QUE ESTABA PASANDO (EQ-05) ─────────────────────────────
   GET y PATCH /api/team/[id] devolvían la fila COMPLETA del usuario:
   `findFirst`/`update` sin `select` y `NextResponse.json({...updated})`.
   Ahí dentro viajaban:

     · totpSecret     — el secret base32 del segundo factor, EN CLARO.
                        Con eso se generan sus códigos de 6 dígitos y su
                        2FA deja de valer para nada.
     · recoveryCodes  — los hashes bcrypt de los códigos de rescate.
     · cajaPinHash    — el hash del PIN de Caja.
     · googleRefreshToken / googleCalendarToken — su calendario.
     · stripeAccountId — su cuenta de cobro de teleconsulta.

   Un ADMIN de la clínica abría Equipo → Editar en el dueño, pulsaba
   "Guardar" y la respuesta traía el secret TOTP de esa persona. En la
   pestaña Red, en el caché y a la vista de cualquier extensión.

   ── POR QUÉ HAY DOS FORMAS Y NO UNA ───────────────────────────
   `MIEMBRO_SELECT` es para las lecturas: el secreto ni siquiera sale de
   Postgres. `camposPublicosDeMiembro` es para el PATCH, donde la fila
   completa SÍ hace falta en el servidor —logMutation la usa para sacar
   el diff de la bitácora, y un cambio de identidad de login tiene que
   quedar rastreable— pero no puede salir de ahí. Las dos leen la MISMA
   lista, así que no se pueden separar.
   ============================================================ */

/**
 * Los campos de `User` que la clínica puede ver de un miembro.
 *
 * Van uno por uno a propósito. Si mañana el esquema estrena una columna,
 * que haya que venir aquí a añadirla es justamente el punto: obliga a
 * decidir si es pública en vez de asumirlo.
 *
 * NO están, y no es olvido:
 *   · totpSecret, recoveryCodes, cajaPinHash, googleCalendarToken,
 *     googleRefreshToken, stripeAccountId — credenciales.
 *   · supabaseId — el identificador de la cuenta de autenticación. No es
 *     una credencial, pero tampoco tiene por qué andar circulando: nadie
 *     en el panel lo lee.
 */
export const MIEMBRO_SELECT = {
  id: true,
  clinicId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  specialty: true,
  avatarUrl: true,
  phone: true,
  isActive: true,
  mustChangePassword: true,
  cedulaProfesional: true,
  especialidad: true,
  cedulaEspecialidad: true,
  color: true,
  agendaActive: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  googleCalendarEmail: true,
  googleCalendarEnabled: true,
  services: true,
  stripeOnboarded: true,
  teleconsultPrice: true,
  permissionsOverride: true,
  sidebarCollapsed: true,
  // El interruptor, no el PIN. Saber que alguien tiene acceso a Caja es
  // parte de la pantalla de Equipo; el hash del PIN no.
  canAccessCaja: true,
  // Igual: que tenga el segundo factor puesto es un estado que el panel
  // enseña. El secret con el que se generan los códigos, no.
  totpEnabled: true,
} as const;

/** Las claves de la lista blanca, para proyectar una fila ya leída. */
export const MIEMBRO_CAMPOS = Object.keys(MIEMBRO_SELECT) as Array<keyof typeof MIEMBRO_SELECT>;

/**
 * Deja de una fila de `User` solo lo que puede salir al navegador.
 *
 * Para cuando la fila completa hizo falta en el servidor (la bitácora del
 * PATCH necesita el antes y el después enteros para sacar el diff) y aun
 * así no puede viajar entera de vuelta.
 *
 * Copia por lista, no por descarte: lo que no esté nombrado arriba no
 * sale, aunque venga en la fila.
 */
export function camposPublicosDeMiembro<T extends Record<string, unknown>>(
  fila: T,
): Partial<T> {
  const fuera: Record<string, unknown> = {};
  for (const campo of MIEMBRO_CAMPOS) {
    if (campo in fila) fuera[campo] = fila[campo];
  }
  return fuera as Partial<T>;
}
