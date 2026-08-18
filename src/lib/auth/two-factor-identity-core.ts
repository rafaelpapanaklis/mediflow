/* ============================================================
   LA REGLA: EL SEGUNDO FACTOR ES DE LA PERSONA, NO DE LA FILA.

   PURO A PROPÓSITO: ni prisma, ni react, ni cookies. Solo la decisión,
   para poder fijarla en __tests__/two-factor-identity.test.ts sin montar
   Postgres — es la regla que decide si alguien entra o no entra. El lado
   con base de datos vive en two-factor-identity.ts.

   Mismo reparto que ya tienen two-factor-core.ts (puro) y
   two-factor-cookie.ts (con I/O).

   ── EL AGUJERO QUE CIERRA (EQ-02) ─────────────────────────────
   El schema es @@unique([supabaseId, clinicId]): una persona tiene UNA
   fila `User` POR clínica, y /api/clinics crea cada sucursal con el
   supabaseId del dueño. Pero `totpEnabled`, `totpSecret` y
   `recoveryCodes` son columnas de esa FILA, y los endpoints de 2FA
   escribían con `where: { id: actor.user.id }` — una sola.

   Resultado: el dueño con dos sedes activa el 2FA en la principal y la
   segunda se queda con totpEnabled=false y totpSecret=null. Al entrar
   ahí, el gate lee la fila activa, contesta que no hace falta nada y el
   panel deja de pedir el código: con la contraseña sola se ve el
   expediente de esa sede.

   La exención de /api/switch-clinic en el gate de 2FA se justificaba
   diciendo que "la clínica de destino vuelve a pedir su propio reto".
   La cookie df_2fa SÍ está atada al par persona+clínica —eso es cierto,
   isTwoFactorTokenValidFor lo comprueba— pero da igual: si la fila de
   destino no tiene el 2FA puesto, el destino no pide NADA.

   Y no hace falta ni el switcher: si alguien enroló el 2FA en su
   SEGUNDA sede, un login nuevo aterriza en la primera (candidates[0],
   ordenado por createdAt) y entra directo.

   ── LA REGLA ──────────────────────────────────────────────────
   La contraseña vive en Supabase Auth y es global. El segundo factor
   protege esa misma identidad, así que también lo es. Es exactamente el
   criterio que este repo ya aplicó a la contraseña temporal en
   lib/auth/must-change-password.ts: `updateMany({ where: { supabaseId } })`,
   sin filtro de clínica y a propósito.
   ============================================================ */

/** Lo que el 2FA de una persona sabe, mirando TODAS sus sedes activas. */
export interface DosFactoresDeLaPersona {
  /** Alguna de sus filas tiene el segundo factor puesto. */
  enrolado: boolean;
  /** El secret con el que se validan sus códigos. Uno solo para todas. */
  totpSecret: string | null;
  /** Los hashes de sus códigos de recuperación, de un solo uso. */
  recoveryCodes: string[];
  /** Alguna de sus clínicas EXIGE 2FA por política. */
  algunaClinicaLoExige: boolean;
}

/** Una fila `User` con lo justo para decidir el 2FA de su dueño. */
export interface FilaDeDosFactores {
  totpEnabled: boolean;
  totpSecret: string | null;
  recoveryCodes: string[];
  clinic?: { require2fa?: boolean | null } | null;
}

/**
 * Qué sabe el 2FA de una persona a partir de TODAS sus filas.
 *
 * Las dos mitades importan y por motivos opuestos:
 *   · si `enrolado` se queda corto, el agujero sigue abierto;
 *   · si `totpSecret` se queda corto, el dueño recibe el reto en una sede y NO
 *     puede contestarlo — nadie tiene contra qué validar su código y se queda
 *     encerrado fuera de su propia clínica.
 */
export function resolverDosFactores(filas: FilaDeDosFactores[]): DosFactoresDeLaPersona {
  // El secret de la fila ENROLADA manda. El de una fila sin enrolar es un
  // enrolamiento a medias (POST /setup guarda el secret con totpEnabled aún en
  // false) y solo sirve si no hay ninguna enrolada — que es justo el caso en el
  // que /enable tiene que poder validarlo.
  const enrolada = filas.find(f => f.totpEnabled && f.totpSecret);
  const pendiente = filas.find(f => f.totpSecret);
  const fuente = enrolada ?? pendiente ?? null;

  return {
    enrolado: filas.some(f => f.totpEnabled),
    totpSecret: fuente?.totpSecret ?? null,
    recoveryCodes: fuente?.recoveryCodes ?? [],
    algunaClinicaLoExige: filas.some(f => !!f.clinic?.require2fa),
  };
}
