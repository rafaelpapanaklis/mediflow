/**
 * Google Calendar — estado de la conexión DE LA CLÍNICA y su ajuste de
 * privacidad («enviar invitación por correo al paciente»).
 *
 * Vive en la tabla `clinic_google_status` (sql/ws1-t12-google-calendar-estado.sql,
 * que se aplica a mano y puede ir por detrás del deploy). Se lee y escribe con
 * SQL directo, no con el modelo `Clinic`: así ninguna consulta existente de la
 * clínica depende de esa tabla.
 *
 * 🔴 Cómo falla, que es lo que importa:
 *  · Esta capa NUNCA rompe a quien la llama. El sync de citas la usa desde un
 *    catch: una cita se guarda siempre, pase lo que pase con Google.
 *  · La tabla no existe todavía → se comporta como antes de ella:
 *    `invitarPaciente = true` y la conexión caída se deduce de `clinics`
 *    (`googleCalendarEnabled = false` con el refresh token aún guardado, que es
 *    justo lo que deja `marcarGoogleCaido`; una desconexión normal borra ambos).
 *
 * Sin `server-only`: las pruebas la importan con un doble de base.
 */

/** La rendija de base que hace falta (un PrismaClient la cumple). */
export interface DbEstadoGoogle {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  clinic: {
    updateMany(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

async function baseReal(): Promise<DbEstadoGoogle> {
  return (await import("@/lib/prisma")).prisma as unknown as DbEstadoGoogle;
}

export interface AjustesGoogle {
  /** ¿Se invita al paciente por correo desde el evento de Google? Default true. */
  invitarPaciente: boolean;
  /** Cuándo se detectó que Google ya no acepta la conexión; null = sin problema. */
  caidoDesde: Date | null;
  /** Motivo corto de la caída, o null. */
  motivo: string | null;
  /** ¿Existe la tabla? Si no, el ajuste de invitación no se puede guardar. */
  tablaDisponible: boolean;
}

export const AJUSTES_GOOGLE_POR_DEFECTO: AjustesGoogle = {
  invitarPaciente: true,
  caidoDesde: null,
  motivo: null,
  tablaDisponible: false,
};

/** ¿El error es «la tabla todavía no existe»? Solo eso abre; lo demás cierra. */
export function esTablaDeGoogleAusente(e: unknown): boolean {
  const x = e as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown } | null;
  if (!x) return false;
  if (x.code === "P2021" || x.code === "42P01") return true;
  if (x.meta?.code === "42P01") return true;
  const msg = typeof x.message === "string" ? x.message : "";
  return /clinic_google_status/.test(msg) && /does not exist|no existe/i.test(msg);
}

/**
 * ¿Este error de Google significa que la CONEXIÓN ya no sirve (token revocado,
 * caducado, cliente inválido, permisos quitados) y no un fallo pasajero
 * (timeout, 5xx, límite de cuota)? Solo lo primero se marca como «caído».
 *
 * 403 es ambiguo en Google: también es «cuota» (rateLimitExceeded,
 * userRateLimitExceeded, quotaExceeded) y «no eres organizador». Solo cuentan
 * como conexión perdida los 403 de permisos/credenciales.
 */
export function esErrorDeAutorizacionGoogle(err: unknown): boolean {
  const e = err as any;
  if (!e) return false;

  const datos = e.response?.data ?? e.data;
  const codigoOAuth = typeof datos?.error === "string" ? datos.error : typeof e.error === "string" ? e.error : "";
  if (["invalid_grant", "invalid_client", "unauthorized_client", "invalid_token"].includes(codigoOAuth)) return true;

  const texto = [e.message, datos?.error_description, typeof datos?.error === "object" ? datos.error?.message : ""]
    .filter((s) => typeof s === "string")
    .join(" ");
  if (/invalid_grant|token has been (expired or )?revoked|invalid_client|unauthorized_client/i.test(texto)) return true;

  const status = Number(e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : NaN));
  if (status === 401) return true;
  if (status === 403) {
    const razones: string[] = [
      ...(Array.isArray(datos?.error?.errors) ? datos.error.errors.map((x: any) => String(x?.reason ?? "")) : []),
      ...(Array.isArray(e.errors) ? e.errors.map((x: any) => String(x?.reason ?? "")) : []),
    ];
    if (razones.some((r) => /^(insufficientPermissions|authError|insufficientScopes)$/i.test(r))) return true;
    if (/insufficient (authentication scopes|permission)/i.test(texto)) return true;
  }
  return false;
}

function idValido(clinicId: unknown): clinicId is string {
  return typeof clinicId === "string" && clinicId.trim().length > 0;
}

function textoCorto(motivo: unknown): string {
  const s = typeof motivo === "string" ? motivo.trim() : "";
  // El motivo es para la pantalla del dueño: una línea, sin tokens ni datos de pacientes.
  return (s || "Google ya no acepta la conexión").replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Google ya no acepta la conexión de esta clínica (invalid_grant, permiso
 * revocado…). La deja marcada como caída, con fecha y motivo, y APAGA el sync
 * (`googleCalendarEnabled = false`, conservando los tokens): no tiene sentido
 * que cada cita nueva gaste llamadas que ya sabemos que fallan. Reconectar
 * (`limpiarGoogleCaido` en el callback) lo vuelve a encender y borra la marca.
 *
 * NUNCA lanza. Conserva la PRIMERA fecha de la caída si ya estaba marcada.
 */
export async function marcarGoogleCaido(clinicId: string, motivo: string, db?: DbEstadoGoogle): Promise<void> {
  // Regla (c): sin clínica no se consulta (un id vacío filtraría mal).
  if (!idValido(clinicId)) return;
  try {
    const base = db ?? (await baseReal());
    const razon = textoCorto(motivo);
    try {
      await base.$executeRaw`
        INSERT INTO clinic_google_status ("clinicId", "lostAt", "lostReason", "updatedAt")
        VALUES (${clinicId}, NOW(), ${razon}, NOW())
        ON CONFLICT ("clinicId") DO UPDATE
          SET "lostAt" = COALESCE(clinic_google_status."lostAt", NOW()),
              "lostReason" = ${razon},
              "updatedAt" = NOW()`;
    } catch (e) {
      // Sin la tabla no hay fecha ni motivo, pero el apagado de abajo sí se hace.
      if (!esTablaDeGoogleAusente(e)) throw e;
    }
    // updateMany (no update): si la clínica ya no existe o ya se desconectó, no lanza.
    await base.clinic.updateMany({ where: { id: clinicId }, data: { googleCalendarEnabled: false } });
    console.error(`[google-calendar] conexión caída (clínica ${clinicId}): ${razon}`);
  } catch (e) {
    console.error("[google-calendar] no se pudo marcar la conexión como caída:", (e as any)?.message ?? e);
  }
}

/** Borra la marca de «caído» (al reconectar o al desconectar a propósito). Nunca lanza. */
export async function limpiarGoogleCaido(clinicId: string, db?: DbEstadoGoogle): Promise<void> {
  if (!idValido(clinicId)) return;
  try {
    const base = db ?? (await baseReal());
    await base.$executeRaw`
      UPDATE clinic_google_status
         SET "lostAt" = NULL, "lostReason" = NULL, "updatedAt" = NOW()
       WHERE "clinicId" = ${clinicId}`;
  } catch (e) {
    if (!esTablaDeGoogleAusente(e)) {
      console.error("[google-calendar] no se pudo limpiar la marca de caído:", (e as any)?.message ?? e);
    }
  }
}

/**
 * Lo guardado para la clínica. Nunca lanza: sin tabla, sin fila o con un fallo
 * pasajero devuelve los valores de siempre (se invita al paciente, sin caída),
 * que es el comportamiento de antes de este ajuste.
 */
export async function leerAjustesGoogle(clinicId: string, db?: DbEstadoGoogle): Promise<AjustesGoogle> {
  if (!idValido(clinicId)) return { ...AJUSTES_GOOGLE_POR_DEFECTO };
  try {
    const base = db ?? (await baseReal());
    const filas = (await base.$queryRaw`
      SELECT "lostAt", "lostReason", "invitePatient"
        FROM clinic_google_status
       WHERE "clinicId" = ${clinicId}
       LIMIT 1`) as { lostAt: Date | null; lostReason: string | null; invitePatient: boolean }[];
    const f = Array.isArray(filas) ? filas[0] : undefined;
    if (!f) return { ...AJUSTES_GOOGLE_POR_DEFECTO, tablaDisponible: true };
    return {
      invitarPaciente: f.invitePatient !== false,
      caidoDesde: f.lostAt ? new Date(f.lostAt) : null,
      motivo: f.lostReason ?? null,
      tablaDisponible: true,
    };
  } catch (e) {
    if (!esTablaDeGoogleAusente(e)) {
      console.error("[google-calendar] no se pudieron leer los ajustes:", (e as any)?.message ?? e);
    }
    return { ...AJUSTES_GOOGLE_POR_DEFECTO };
  }
}

/**
 * Guarda «enviar invitación por correo al paciente». A diferencia de las
 * lecturas SÍ avisa del fallo: devuelve `false` si la tabla aún no existe (la
 * pantalla dice que falta aplicar el SQL en vez de fingir que se guardó).
 */
export async function guardarInvitarPaciente(clinicId: string, invitar: boolean, db?: DbEstadoGoogle): Promise<boolean> {
  if (!idValido(clinicId)) throw new Error("sesion_invalida: falta la clínica");
  const base = db ?? (await baseReal());
  try {
    await base.$executeRaw`
      INSERT INTO clinic_google_status ("clinicId", "invitePatient", "updatedAt")
      VALUES (${clinicId}, ${invitar}, NOW())
      ON CONFLICT ("clinicId") DO UPDATE
        SET "invitePatient" = ${invitar}, "updatedAt" = NOW()`;
    return true;
  } catch (e) {
    if (esTablaDeGoogleAusente(e)) return false;
    throw e;
  }
}

export type EstadoConexionGoogle = "conectado" | "caido" | "no_conectado";

export interface ClinicaGoogleFila {
  googleCalendarEnabled?: boolean | null;
  /** Solo se pregunta si existe: el valor no sale de esta función. */
  googleRefreshToken?: string | null;
}

/**
 * El estado de la conexión de LA CLÍNICA (no la del usuario que mira).
 *  · conectado: sync encendido.
 *  · caído: sync apagado con marca de caída (con la tabla), o —sin tabla— con el
 *    refresh token aún guardado (lo que deja marcarGoogleCaido; una desconexión
 *    a propósito borra el token).
 *  · no conectado: lo demás.
 */
export function estadoConexionGoogle(clinica: ClinicaGoogleFila | null | undefined, ajustes: AjustesGoogle): EstadoConexionGoogle {
  if (!clinica) return "no_conectado";
  // Encendido gana: reconectar vuelve a encender y borra la marca; una marca
  // vieja que no se alcanzó a borrar no debe mostrar «caído» con el sync vivo.
  if (clinica.googleCalendarEnabled === true) return "conectado";
  return ajustes.caidoDesde || clinica.googleRefreshToken ? "caido" : "no_conectado";
}
