import { google } from "googleapis";
import crypto from "crypto";
import { rfc3339InTz } from "@/lib/agenda/legacy-helpers";

// FIX: openid + email required so Google returns id_token with user email
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",        // create/manage calendars
  "https://www.googleapis.com/auth/calendar.events", // create/update events
];

const STATE_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "mediflow-gcal-state";

/** Tope de CADA llamada a Google: sin él una Google lenta deja colgada la función. */
export const TIMEOUT_GOOGLE_MS = 8_000;

export function getOAuthClient(opts?: { timeoutMs?: number }) {
  return new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/google/callback`,
    transporterOptions: { timeout: opts?.timeoutMs ?? TIMEOUT_GOOGLE_MS },
  });
}

/** Sign the userId so the callback can verify it without needing a session cookie */
export function signState(userId: string): string {
  const hmac = crypto.createHmac("sha256", STATE_SECRET).update(userId).digest("hex").slice(0, 16);
  return `${userId}.${hmac}`;
}

/** Verify and extract userId from signed state */
export function verifyState(state: string): string | null {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const userId = state.substring(0, dotIdx);
  const hmac = state.substring(dotIdx + 1);
  if (!userId || !hmac) return null;
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(userId).digest("hex").slice(0, 16);
  if (hmac !== expected) return null;
  return userId;
}

export function getAuthUrl(userId: string) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt:      "consent",
    scope:       SCOPES,
    state:       signState(userId),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente de Calendar y operaciones sueltas sobre él.
//
// Todo lo de abajo recibe el cliente (`ClienteCalendar`) en vez de tokens: el
// núcleo de sincronización (`agenda/google-sync-nucleo.ts`) lo abre una vez por
// operación y las pruebas le pasan uno falso que imita a Google.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo de `calendar_v3.Calendar` que usamos (los falsos de las pruebas lo cumplen). */
export interface ClienteCalendar {
  events: {
    insert(p: { calendarId: string; sendUpdates?: string; requestBody: Record<string, any> }): Promise<{ data: { id?: string | null } }>;
    patch(p: { calendarId: string; eventId: string; sendUpdates?: string; requestBody: Record<string, any> }): Promise<{ data: { id?: string | null } }>;
    delete(p: { calendarId: string; eventId: string; sendUpdates?: string }): Promise<unknown>;
  };
  calendarList: {
    list(p?: { pageToken?: string; maxResults?: number }): Promise<{ data: { items?: EntradaCalendario[] | null; nextPageToken?: string | null } }>;
    patch(p: { calendarId: string; requestBody: Record<string, any> }): Promise<unknown>;
  };
  calendars: {
    insert(p: { requestBody: Record<string, any> }): Promise<{ data: { id?: string | null } }>;
    patch(p: { calendarId: string; requestBody: Record<string, any> }): Promise<unknown>;
    /** Solo para quitar un calendario duplicado que acabamos de crear nosotros. */
    delete(p: { calendarId: string }): Promise<unknown>;
  };
}

export interface EntradaCalendario {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
}

/**
 * Abre un cliente de Calendar con los tokens de la clínica.
 *
 * `alRenovarToken` se dispara cuando Google entrega un access token nuevo
 * (porque el guardado ya caducó o no había): el llamador lo guarda, así la
 * siguiente operación no paga un 401 + renovación. Google no rota el refresh
 * token, por eso solo viaja el de acceso.
 */
export function crearClienteCalendar(cred: {
  accessToken: string | null;
  refreshToken: string;
  alRenovarToken?: (accessToken: string) => void;
  timeoutMs?: number;
}): ClienteCalendar {
  const timeout = cred.timeoutMs ?? TIMEOUT_GOOGLE_MS;
  const oauth2Client = getOAuthClient({ timeoutMs: timeout });
  oauth2Client.setCredentials({
    ...(cred.accessToken ? { access_token: cred.accessToken } : {}),
    refresh_token: cred.refreshToken,
  });
  if (cred.alRenovarToken) {
    const avisar = cred.alRenovarToken;
    oauth2Client.on("tokens", (t) => {
      if (t.access_token) avisar(t.access_token);
    });
  }
  return google.calendar({ version: "v3", auth: oauth2Client, timeout }) as unknown as ClienteCalendar;
}

// ── Errores de Google ────────────────────────────────────────────────────────

/** Código HTTP del error de googleapis/gaxios, o null si no vino de una respuesta (red, tiempo). */
export function estadoHttpDeError(err: unknown): number | null {
  const e = err as any;
  const n = Number(e?.response?.status ?? e?.status ?? e?.code);
  return Number.isInteger(n) && n >= 100 && n < 600 ? n : null;
}

/** `reason` de Google (accessNotConfigured, insufficientPermissions, rateLimitExceeded…). */
export function razonDeError(err: unknown): string | null {
  const e = err as any;
  const r = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason ?? e?.response?.data?.error?.status;
  return typeof r === "string" ? r : null;
}

const esNoExiste = (err: unknown) => {
  const s = estadoHttpDeError(err);
  return s === 404 || s === 410;
};

// ── Identificación de lo nuestro en Google ──────────────────────────────────

/**
 * Id del evento de una cita. Determinista: insertar dos veces la misma cita da
 * 409 en vez de un duplicado, y un reintento (o el botón «Sincronizar citas
 * futuras») reconoce lo que ya está. Google exige base32hex (a-v, 0-9) de 5 a
 * 1024 caracteres: el hex de un hash lo cumple. Lleva la clínica dentro del
 * hash, así dos clínicas no pueden chocar aunque compartan cuenta de Google.
 */
export function idEventoDeCita(clinicId: string, appointmentId: string): string {
  return "dc" + crypto.createHash("sha256").update(`${clinicId}:${appointmentId}`).digest("hex").slice(0, 40);
}

/** Marca en la descripción del calendario: de qué clínica es. */
export function marcaCalendarioDeClinica(clinicId: string): string {
  return `DaleControl-clinic:${clinicId}`;
}

const MARCA_ANTIGUA = /DaleControl-clinic(?!:)/;
const MARCA_CUALQUIERA = /DaleControl-clinic:/;

// ── Calendario de la clínica ─────────────────────────────────────────────────

/**
 * Busca el calendario de ESTA clínica en la cuenta de Google y, si no existe,
 * lo crea. Lanza si Google falla (antes se tragaba el error y las citas caían
 * al calendario personal del admin sin avisar).
 *
 * Reconoce por la marca con el id de la clínica. Un calendario de otra clínica
 * de DaleControl en la misma cuenta NO se adopta. Los creados antes de la marca
 * (descripción «…DaleControl-clinic» a secas) se adoptan solo si el nombre
 * coincide, y se les añade la marca.
 */
export async function buscarOCrearCalendarioDeClinica(
  cal: ClienteCalendar,
  opts: { clinicId: string; clinicName: string; timezone: string },
): Promise<{ id: string; creado: boolean }> {
  const marca = marcaCalendarioDeClinica(opts.clinicId);

  const items: EntradaCalendario[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    const r = await cal.calendarList.list({ maxResults: 250, ...(pageToken ? { pageToken } : {}) });
    items.push(...(r.data.items ?? []));
    pageToken = r.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  const propio = items.find((c) => c.id && c.description?.includes(marca));
  if (propio?.id) return { id: propio.id, creado: false };

  const antiguo = items.find(
    (c) => c.id && c.summary === opts.clinicName && MARCA_ANTIGUA.test(c.description ?? "") && !MARCA_CUALQUIERA.test(c.description ?? ""),
  );
  if (antiguo?.id) {
    try {
      await cal.calendars.patch({
        calendarId: antiguo.id,
        requestBody: { description: `Agenda de ${opts.clinicName} — ${marca}` },
      });
    } catch (err) {
      console.error("Google Calendar: no se pudo marcar el calendario existente:", err);
    }
    return { id: antiguo.id, creado: false };
  }

  const nuevo = await cal.calendars.insert({
    requestBody: {
      summary: opts.clinicName,
      description: `Agenda de ${opts.clinicName} — ${marca}`,
      timeZone: opts.timezone || "America/Mexico_City",
    },
  });
  const id = nuevo.data.id;
  if (!id) throw new Error("Google no devolvió el id del calendario creado");

  // El color es cosmético: si falla, el calendario sigue siendo válido.
  try {
    await cal.calendarList.patch({ calendarId: id, requestBody: { colorId: "9" } }); // azul
  } catch (err) {
    console.error("Google Calendar: no se pudo colorear el calendario:", err);
  }
  return { id, creado: true };
}

// ── Eventos ──────────────────────────────────────────────────────────────────

/** Lo que viaja a Google de una cita (lo arma `google-calendar-contenido`). */
export interface ContenidoEvento {
  summary: string;
  description: string;
  location?: string | null;
  attendees: { email: string }[];
}

export interface DatosEvento {
  calendarId: string;
  eventId: string;
  contenido: ContenidoEvento;
  startsAt: Date;
  endsAt: Date;
  /** Zona de la clínica (rfc3339 con su desfase; Google la usa para repetir/mostrar). */
  timeZone: string;
  clinicId: string;
  appointmentId: string;
}

const cuerpoBase = (d: DatosEvento) => ({
  summary: d.contenido.summary,
  description: d.contenido.description,
  location: d.contenido.location ?? undefined,
  start: { dateTime: rfc3339InTz(d.startsAt, d.timeZone), timeZone: d.timeZone },
  end: { dateTime: rfc3339InTz(d.endsAt, d.timeZone), timeZone: d.timeZone },
  // Para reconocer en Google de qué clínica y cita es cada evento.
  extendedProperties: { private: { dalecontrolClinicId: d.clinicId, dalecontrolAppointmentId: d.appointmentId } },
});

/**
 * Cambia un evento ya existente con `events.patch`: solo toca lo que va en el
 * cuerpo. (Antes usaba `events.update`, que reemplaza el evento ENTERO: al
 * mover una cita el paciente y el doctor dejaban de ser invitados y los
 * recordatorios volvían a los de Google.) Aquí NUNCA van `attendees` ni
 * `reminders`. `status: confirmed` además resucita un evento que alguien borró
 * en Google o que se canceló y la cita volvió a activarse.
 *
 * `no_existe` = Google ya no tiene ese evento (404/410): el llamador lo vuelve a crear.
 */
export async function parcharEvento(cal: ClienteCalendar, d: DatosEvento): Promise<"ok" | "no_existe"> {
  try {
    await cal.events.patch({
      calendarId: d.calendarId,
      eventId: d.eventId,
      sendUpdates: "none",
      requestBody: { ...cuerpoBase(d), status: "confirmed" },
    });
    return "ok";
  } catch (err) {
    if (esNoExiste(err)) return "no_existe";
    throw err;
  }
}

/**
 * Crea el evento con el id determinista de la cita. Si ya existe (409: un
 * reintento, o un alta cuyo guardado del id falló) no duplica: lo pone al día
 * con `parcharEvento` y devuelve `reanudado`.
 *
 * `avisarInvitados`: false en la sincronización en bloque, para no mandar a
 * cada paciente un correo de invitación por cita de golpe.
 */
export async function insertarEvento(
  cal: ClienteCalendar,
  d: DatosEvento,
  opts: { avisarInvitados: boolean },
): Promise<"creado" | "reanudado"> {
  try {
    await cal.events.insert({
      calendarId: d.calendarId,
      sendUpdates: opts.avisarInvitados && d.contenido.attendees.length > 0 ? "all" : "none",
      requestBody: {
        id: d.eventId,
        ...cuerpoBase(d),
        attendees: d.contenido.attendees,
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 30 },
          ],
        },
        colorId: "2", // sage green
      },
    });
    return "creado";
  } catch (err) {
    if (estadoHttpDeError(err) !== 409) throw err;
    const r = await parcharEvento(cal, d);
    if (r === "no_existe") throw err;
    return "reanudado";
  }
}

/**
 * Borra el evento. Que Google ya no lo tenga (404/410) cuenta como borrado:
 * el resultado que se quería ya está.
 */
export async function borrarEvento(
  cal: ClienteCalendar,
  d: { calendarId: string; eventId: string },
  opts: { avisarInvitados: boolean },
): Promise<"borrado" | "no_existia"> {
  try {
    await cal.events.delete({
      calendarId: d.calendarId,
      eventId: d.eventId,
      sendUpdates: opts.avisarInvitados ? "all" : "none",
    });
    return "borrado";
  } catch (err) {
    if (esNoExiste(err)) return "no_existia";
    throw err;
  }
}
