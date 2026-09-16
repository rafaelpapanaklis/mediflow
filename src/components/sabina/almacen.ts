/**
 * EL ALMACÉN DE SABINA — una sola conversación, dos puertas.
 *
 * Desde ws1-t1 («Sabina en todas partes») Sabina se abre de dos maneras: su
 * pantalla (`/dashboard/sabina`) y un cajón lateral que sale sobre cualquier
 * pantalla del panel. La regla que manda es la 3 del encargo: **tiene que ser
 * la MISMA conversación**. Si el doctor pregunta algo en el cajón y luego entra
 * a la pantalla de Sabina, encuentra lo que preguntó, no una hoja en blanco.
 *
 * Por eso el estado del chat NO vive en un componente. Vive aquí, en el módulo:
 * un módulo se carga UNA vez por pestaña del navegador y sobrevive a la
 * navegación del App Router, que es exactamente la vida que tiene que tener
 * esta conversación. El cajón y la pantalla se suscriben con
 * `useSyncExternalStore` y ven el mismo objeto; si los dos están montados a la
 * vez, se mueven a la vez.
 *
 * ¿Por qué no un React Context en `dashboard/layout.tsx`? Porque habría que
 * envolver `{children}`, y ese archivo lo está tocando el PR #265 (el menú de
 * dos niveles). Así el enganche del layout es UNA línea al lado del FAB de
 * chat, en una zona que ese PR no toca.
 *
 * 🔴 NO SE COBRA POR ABRIR. Aquí no hay nada que llame al modelo: abrir el
 * cajón no dispara ninguna petición. Solo `preguntar` y `reintentar` llaman a
 * `POST /api/sabina`, que es lo único que cobra al monedero. `hidratar` y
 * `cargarHistorial` son GET de solo lectura y no pasan por Anthropic.
 */

import {
  classifySabinaError,
  sanitizeQuestion,
  titleFromQuestion,
  type SabinaErrorKind,
} from "./sabina-core";
// La tarjeta de propuesta y su lógica siguen viviendo en la carpeta de la
// pantalla. Se importan, no se mueven: hay otras terminales trabajando sobre
// Sabina a la vez y un archivo movido es un choque garantizado para ellas.
import {
  actualizarPropuesta,
  desfaseReloj,
  leerPropuestas,
  leerRespuestaPropuesta,
  marcarReemplazadas,
  repartirPropuestas,
  type SabinaPropuestaVista,
} from "@/app/dashboard/sabina/propuesta-core";
import type { ContextoPantalla } from "./contexto-pantalla";

export interface SabinaMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  pending?: boolean;
  herramientasUsadas?: string[];
  modelo?: string;
  /** Solo cuando role === "system": por qué falló ESTA pantalla al preguntar. */
  errorKind?: SabinaErrorKind;
  /** Lo que Sabina propuso hacer en este turno (tarjetas de confirmación). */
  propuestas?: SabinaPropuestaVista[];
}

export interface HistoryRow {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * La pista de dónde está quien pregunta. La arma `./contexto-pantalla` y viaja
 * tal cual en el cuerpo del POST; el servidor la vuelve a comprobar entera
 * antes de creérsela.
 */
export type { ContextoPantalla } from "./contexto-pantalla";

export interface EstadoSabina {
  /** La clínica de la sesión. Al cambiar de sede, la conversación se reinicia. */
  clinicaId: string | null;
  /** El Super Admin apagó a Sabina para este usuario. */
  apagada: boolean;
  messages: SabinaMessage[];
  conversationId: string | null;
  conversationTitle: string | null;
  input: string;
  sending: boolean;
  retryingId: string | null;
  lastQuestion: string | null;
  /** Conversación abierta desde el historial que no se pudo cargar. */
  activeFailed: boolean;
  openingConv: boolean;
  historyList: HistoryRow[];
  historyLoading: boolean;
  historyNotice: string | null;
  /** Desfase entre el reloj del servidor y el del navegador (cuenta atrás de la tarjeta). */
  desfase: number;
  trabajando: { id: string; tipo: "confirmar" | "descartar" | "consultar" } | null;
  /** Propuestas cuyo «confirmar» se cortó sin respuesta: hay que preguntar en qué quedó. */
  dudosas: string[];
  /** Ya se intentó recuperar la conversación guardada de esta pestaña. */
  hidratado: boolean;
  /**
   * Contador de «pon el cursor en la caja de texto». Sube cuando el marco de
   * una de las dos puertas lo pide (abrir una conversación nueva). Es un número
   * y no un booleano porque el que enfoca es otro componente —el que tiene el
   * `ref` del textarea— y necesita distinguir dos peticiones seguidas.
   */
  foco: number;
}

function estadoInicial(clinicaId: string | null): EstadoSabina {
  return {
    clinicaId,
    apagada: false,
    messages: [],
    conversationId: null,
    conversationTitle: null,
    input: "",
    sending: false,
    retryingId: null,
    lastQuestion: null,
    activeFailed: false,
    openingConv: false,
    historyList: [],
    historyLoading: false,
    historyNotice: null,
    desfase: 0,
    trabajando: null,
    dudosas: [],
    hidratado: false,
    foco: 0,
  };
}

/**
 * 🔴 ESTO ES UN SINGLETON DE MÓDULO, Y EN EL SERVIDOR TAMBIÉN EXISTE.
 *
 * `panel.tsx` es un componente cliente que el layout del panel renderiza, así
 * que este módulo se evalúa TAMBIÉN en el proceso de Node durante el SSR, donde
 * el objeto es uno solo para todas las peticiones y todas las clínicas.
 *
 * Hoy no hay fuga posible porque NADIE escribe aquí durante el render: los dos
 * puntos de arranque (`usarClinica`) viven en `useEffect`, que no corre en el
 * servidor, y `useSyncExternalStore` solo lee. El margen es de una línea: si
 * alguien llamara a `fijar`, `escribir` o `usarClinica` desde el cuerpo de un
 * componente, el HTML que se le sirve a la clínica B llevaría la conversación
 * de la clínica A. **Todo lo que escriba aquí va dentro de un efecto o de un
 * manejador de evento.**
 */
let estado: EstadoSabina = estadoInicial(null);
const oyentes = new Set<() => void>();
let historialCargado = false;

function emitir() {
  for (const o of oyentes) o();
}

/** Escribe un parche y avisa. El objeto se reemplaza entero: `useSyncExternalStore` compara por referencia. */
function fijar(parche: Partial<EstadoSabina>) {
  estado = { ...estado, ...parche };
  emitir();
}

function conMensajes(fn: (previos: SabinaMessage[]) => SabinaMessage[]) {
  fijar({ messages: fn(estado.messages) });
}

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function leerEstado(): EstadoSabina {
  return estado;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA CONVERSACIÓN QUE SOBREVIVE A UN F5
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El id de la conversación abierta, guardado POR CLÍNICA en el navegador.
 *
 * El módulo sobrevive a la navegación del App Router, pero no a una recarga
 * dura ni a abrir el panel en otra pestaña. Esto la recupera.
 *
 * 🔴 Que sea del navegador no lo vuelve una llave: `GET
 * /api/sabina/conversations/:id` filtra por clínica Y por usuario de la SESIÓN.
 * Si el equipo comparte la computadora y entra otra persona, el id guardado no
 * es suyo, el servidor contesta 404 y Sabina arranca en blanco — que es lo
 * correcto.
 */
function claveGuardada(clinicaId: string | null): string | null {
  return clinicaId ? `mf:sabina:conversacion:${clinicaId}` : null;
}

function recordarConversacion(id: string | null) {
  const clave = claveGuardada(estado.clinicaId);
  if (!clave) return;
  try {
    if (id) window.localStorage.setItem(clave, id);
    else window.localStorage.removeItem(clave);
  } catch {
    /* modo privado o almacenamiento lleno: se pierde el hilo al recargar, nada más */
  }
}

function conversacionRecordada(): string | null {
  const clave = claveGuardada(estado.clinicaId);
  if (!clave) return null;
  try {
    const v = window.localStorage.getItem(clave);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * La clínica de la sesión. Si cambia (el switcher de sedes), TODO se reinicia:
 * el historial de Sabina vive aislado por clínica y arrastrar la conversación
 * de la sede anterior es justo lo que evita el `key={user.clinicId}` de la
 * página.
 */
export function usarClinica(clinicaId: string, apagada?: boolean) {
  if (estado.clinicaId === clinicaId) {
    if (typeof apagada === "boolean" && apagada !== estado.apagada) fijar({ apagada });
    return;
  }
  historialCargado = false;
  estado = estadoInicial(clinicaId);
  if (typeof apagada === "boolean") estado.apagada = apagada;
  emitir();
}

/* ═══════════════════════════════════════════════════════════════════════
   LECTURA DE LAS RESPUESTAS DEL SERVIDOR
   ═══════════════════════════════════════════════════════════════════════ */

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Fila cruda de /api/sabina/conversations → fila de la barra de historial. */
export function toHistoryRow(raw: unknown): HistoryRow | null {
  const row = raw as { id?: unknown; title?: unknown; updatedAt?: unknown };
  if (typeof row?.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    title: typeof row.title === "string" && row.title ? row.title : "Consulta a Sabina",
    updatedAt: typeof row.updatedAt === "number" && isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
  };
}

/** Turno crudo de /api/sabina/conversations/:id → mensaje pintable. */
export function toSabinaMessage(raw: unknown): SabinaMessage | null {
  const row = raw as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
    herramientasUsadas?: unknown;
    modelo?: unknown;
  };
  if (typeof row?.content !== "string") return null;
  return {
    id: typeof row.id === "string" && row.id ? row.id : makeId(),
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    timestamp: typeof row.timestamp === "number" && isFinite(row.timestamp) ? row.timestamp : Date.now(),
    herramientasUsadas: Array.isArray(row.herramientasUsadas)
      ? row.herramientasUsadas.filter((t): t is string => typeof t === "string")
      : undefined,
    modelo: typeof row.modelo === "string" ? row.modelo : undefined,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   ACCIONES
   ═══════════════════════════════════════════════════════════════════════ */

export function escribir(texto: string) {
  fijar({ input: texto });
}

export function apagar(apagada: boolean) {
  if (estado.apagada !== apagada) fijar({ apagada });
}

/**
 * GET /api/sabina/conversations — el historial del usuario. Fail-open: si el
 * endpoint no está, el chat sigue funcionando y lo que no hay es historial.
 */
export async function cargarHistorial(): Promise<void> {
  fijar({ historyLoading: true });
  try {
    const res = await fetch("/api/sabina/conversations");
    if (!res.ok) {
      fijar({ historyNotice: "No se pudo cargar tu historial." });
      return;
    }
    const data = await res.json().catch(() => null);
    const rows = (Array.isArray(data?.conversations) ? data.conversations : [])
      .map(toHistoryRow)
      .filter((r: HistoryRow | null): r is HistoryRow => r !== null);
    fijar({ historyList: rows, historyNotice: null });
  } catch {
    fijar({ historyNotice: "No se pudo cargar tu historial." });
  } finally {
    fijar({ historyLoading: false });
  }
}

/** Carga el historial la PRIMERA vez que alguien abre el cajón de conversaciones. */
export function cargarHistorialUnaVez(): void {
  if (historialCargado) return;
  historialCargado = true;
  void cargarHistorial();
}

/** Pide a la puerta que esté pintando el hilo que enfoque su caja de texto. */
export function pedirFoco(): void {
  fijar({ foco: estado.foco + 1 });
}

/**
 * 🔴 CON UNA PREGUNTA EN VUELO NO SE CAMBIA DE HILO.
 *
 * Vaciar `messages` mientras un `POST /api/sabina` está en el aire hace que la
 * respuesta llegue a un mensaje que ya no existe: se descarta en silencio
 * DESPUÉS de haberse cobrado al monedero (los tokens ya se los quedó
 * Anthropic). Así que las dos puertas que cambian de hilo —«nueva
 * conversación» y abrir una del historial— no hacen nada mientras se espera.
 * La pantalla además deja los botones deshabilitados, para que se vea por qué.
 */
export function cambiandoDeHilo(): boolean {
  return estado.sending || estado.openingConv;
}

export function nuevaConversacion(): void {
  if (cambiandoDeHilo()) return;
  recordarConversacion(null);
  fijar({
    conversationId: null,
    conversationTitle: null,
    messages: [],
    activeFailed: false,
    lastQuestion: null,
    hidratado: true,
    // Igual que en main: tras «Nueva conversación» el cursor queda listo.
    foco: estado.foco + 1,
  });
}

/** GET /api/sabina/conversations/:id — abre un hilo guardado. No llama al modelo. */
export async function abrirConversacion(row: { id: string; title?: string }): Promise<void> {
  if (cambiandoDeHilo()) return;
  fijar({
    conversationId: row.id,
    conversationTitle: row.title ?? null,
    activeFailed: false,
    openingConv: true,
    messages: [],
    hidratado: true,
  });
  recordarConversacion(row.id);
  try {
    const res = await fetch(`/api/sabina/conversations/${encodeURIComponent(row.id)}`);
    if (!res.ok) {
      fijar({ activeFailed: true });
      return;
    }
    const data = await res.json().catch(() => null);
    const msgs = (Array.isArray(data?.messages) ? data.messages : [])
      .map(toSabinaMessage)
      .filter((m: SabinaMessage | null): m is SabinaMessage => m !== null);
    const meta = toHistoryRow(data?.conversation);
    fijar({
      desfase: desfaseReloj(data?.ahora, Date.now()),
      messages: repartirPropuestas(msgs, leerPropuestas(data?.propuestas)),
      ...(meta ? { conversationTitle: meta.title } : {}),
    });
  } catch {
    fijar({ activeFailed: true });
  } finally {
    fijar({ openingConv: false });
  }
}

/**
 * Recupera la conversación de esta clínica tras una recarga dura. Se llama al
 * abrir el cajón o al entrar a la pantalla — nunca al montar el panel, para
 * que estar en el dashboard no cueste ni una petición.
 *
 * Si el hilo guardado ya no es suyo (otra persona en la misma computadora) el
 * servidor contesta 404 y se arranca en blanco, sin ruido.
 */
export async function hidratar(): Promise<void> {
  if (estado.hidratado) return;
  fijar({ hidratado: true });
  if (estado.conversationId || estado.messages.length > 0) return;
  const id = conversacionRecordada();
  if (!id) return;
  await abrirConversacion({ id });
  // 404 (el hilo es de otra persona de la misma computadora, o ya no está):
  // se olvida y se arranca en blanco, sin cartel de error. Un hilo que no se
  // puede abrir no es un fallo que contarle a nadie.
  if (leerEstado().activeFailed) {
    recordarConversacion(null);
    fijar({ conversationId: null, conversationTitle: null, activeFailed: false, messages: [] });
  }
}

/** En qué quedó una propuesta, por GET (solo lectura). */
export async function consultarPropuesta(id: string, silencioso = false): Promise<void> {
  if (!silencioso) fijar({ trabajando: { id, tipo: "consultar" } });
  try {
    const res = await fetch(`/api/sabina/propuestas/${encodeURIComponent(id)}`);
    const lectura = leerRespuestaPropuesta(res.status, await res.json().catch(() => null), Date.now());
    if (lectura.tipo === "propuesta") {
      fijar({
        desfase: lectura.desfase,
        messages: actualizarPropuesta(estado.messages, lectura.propuesta),
        dudosas: estado.dudosas.filter((d) => d !== id),
      });
    }
  } catch {
    /* sin red: la tarjeta sigue como estaba (dudosa, si lo era) */
  } finally {
    if (!silencioso) fijar({ trabajando: null });
  }
}

/**
 * Confirmar o descartar UNA propuesta. Es la fase 2: la única forma de que lo
 * que Sabina propuso se haga es este botón. El servidor decide.
 */
export async function actuar(id: string, tipo: "confirmar" | "descartar"): Promise<void> {
  if (estado.trabajando || estado.sending) return;
  fijar({ trabajando: { id, tipo } });
  let status: number | null = null;
  let cuerpo: unknown = null;
  try {
    const res = await fetch(`/api/sabina/propuestas/${encodeURIComponent(id)}/${tipo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    status = res.status;
    cuerpo = await res.json().catch(() => null);
  } catch {
    status = null;
  }
  const lectura = leerRespuestaPropuesta(status, cuerpo, Date.now());
  if (lectura.tipo === "propuesta") {
    fijar({
      desfase: lectura.desfase,
      messages: actualizarPropuesta(estado.messages, lectura.propuesta),
      dudosas: estado.dudosas.filter((d) => d !== id),
    });
  } else if (lectura.tipo === "sin_propuesta") {
    conMensajes((prev) =>
      prev.map((m) =>
        m.propuestas?.some((p) => p.id === id)
          ? {
              ...m,
              propuestas: m.propuestas.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      // Sin propuesta en la respuesta no se sabe su estado: si
                      // era descartar o una 404, ya no se puede usar; si fue un
                      // corte al confirmar, se dice tal cual.
                      estado: lectura.resultado.tipo === "no_encontrada" ? "caducada" : p.estado,
                      resultado: lectura.resultado,
                    }
                  : p,
              ),
            }
          : m,
      ),
    );
    if (tipo === "confirmar" && lectura.resultado.tipo === "error") {
      if (!estado.dudosas.includes(id)) fijar({ dudosas: [...estado.dudosas, id] });
    }
  } else if (tipo === "confirmar") {
    if (!estado.dudosas.includes(id)) fijar({ dudosas: [...estado.dudosas, id] });
  }
  fijar({ trabajando: null });
}

/** Manda la pregunta y actualiza EL MISMO mensaje (placeholder o reintento). */
async function correrPeticion(
  question: string,
  targetId: string,
  contexto: ContextoPantalla | null,
): Promise<void> {
  fijar({ sending: true });
  try {
    const res = await fetch("/api/sabina", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pregunta: question,
        conversacionId: estado.conversationId ?? undefined,
        // La pista de dónde está. Si no hay nada que decir, no viaja: una
        // pregunta sin contexto cuesta lo que costaba antes.
        ...(contexto && Object.keys(contexto).length > 0 ? { contexto } : {}),
      }),
    });
    let data: {
      respuesta?: unknown;
      herramientasUsadas?: unknown;
      conversacionId?: unknown;
      modelo?: unknown;
      propuestas?: unknown;
      ahora?: unknown;
    } | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const kind = classifySabinaError(res.status, data);
      if (kind === "apagada") fijar({ apagada: true });
      conMensajes((prev) =>
        prev.map((m) =>
          m.id === targetId ? { ...m, role: "system", content: "", pending: false, errorKind: kind } : m,
        ),
      );
      return;
    }

    const respuesta = typeof data?.respuesta === "string" ? data.respuesta : "";
    const herramientasUsadas = Array.isArray(data?.herramientasUsadas)
      ? data.herramientasUsadas.filter((t): t is string => typeof t === "string")
      : [];
    const modelo = typeof data?.modelo === "string" ? data.modelo : undefined;
    const convId = typeof data?.conversacionId === "string" ? data.conversacionId : null;
    const propuestas = leerPropuestas(data?.propuestas);
    if (propuestas.length > 0) fijar({ desfase: desfaseReloj(data?.ahora, Date.now()) });

    if (convId && convId !== estado.conversationId) {
      const title = titleFromQuestion(question);
      const already = estado.historyList.find((r) => r.id === convId);
      const entry: HistoryRow = { id: convId, title: already?.title ?? title, updatedAt: Date.now() };
      fijar({
        conversationId: convId,
        conversationTitle: estado.conversationTitle ?? title,
        historyList: [entry, ...estado.historyList.filter((r) => r.id !== convId)],
      });
      recordarConversacion(convId);
    } else if (convId) {
      const idx = estado.historyList.findIndex((r) => r.id === convId);
      if (idx !== -1) {
        const next = [...estado.historyList];
        next[idx] = { ...next[idx], updatedAt: Date.now() };
        fijar({ historyList: next });
      }
      recordarConversacion(convId);
    }

    if (propuestas.length > 0) {
      // Las que la pantalla va a dar por sustituidas: que el servidor confirme
      // en qué quedaron (pudieron confirmarse desde otra pestaña).
      const nuevos = propuestas.map((p) => p.id);
      estado.messages
        .flatMap((m) => m.propuestas ?? [])
        .filter((p) => p.estado === "pendiente" && !nuevos.includes(p.id))
        .forEach((p) => void consultarPropuesta(p.id, true));
    }
    conMensajes((prev) =>
      marcarReemplazadas(
        prev.map((m) =>
          m.id === targetId
            ? {
                ...m,
                role: "assistant",
                content: respuesta,
                pending: false,
                herramientasUsadas,
                modelo,
                errorKind: undefined,
                propuestas: propuestas.length > 0 ? propuestas : undefined,
              }
            : m,
        ),
        propuestas.map((p) => p.id),
      ),
    );
  } catch {
    conMensajes((prev) =>
      prev.map((m) =>
        m.id === targetId ? { ...m, role: "system", content: "", pending: false, errorKind: "network" } : m,
      ),
    );
  } finally {
    fijar({ sending: false, retryingId: null });
  }
}

/** Preguntar. Es lo ÚNICO que llama al modelo, y por tanto lo único que cobra. */
export function preguntar(raw: string, contexto: ContextoPantalla | null): void {
  const clean = sanitizeQuestion(raw);
  // 🔴 `openingConv` está en la lista por una razón nueva de esta pantalla: al
  // abrir el cajón se recupera la conversación guardada (`hidratar`) y la caja
  // de texto se enfoca sola. Sin esta guarda, escribir en esos milisegundos
  // mandaba la pregunta, el GET volvía después y PISABA los mensajes —incluido
  // el turno en vuelo—, así que la respuesta llegaba a un mensaje que ya no
  // existía y se descartaba en silencio... después de haberse cobrado al
  // monedero. La pantalla también deshabilita el composer mientras tanto.
  if (!clean || estado.sending || estado.openingConv || estado.activeFailed || estado.apagada) return;

  const now = Date.now();
  const userMsg: SabinaMessage = { id: makeId(), role: "user", content: clean, timestamp: now };
  const placeholderId = makeId();
  fijar({
    input: "",
    lastQuestion: clean,
    hidratado: true,
    messages: [
      ...estado.messages,
      userMsg,
      { id: placeholderId, role: "assistant", content: "", timestamp: now, pending: true },
    ],
  });

  void correrPeticion(clean, placeholderId, contexto);
}

export function reintentar(failedId: string, contexto: ContextoPantalla | null): void {
  if (!estado.lastQuestion || estado.sending || estado.openingConv) return;
  const pregunta = estado.lastQuestion;
  fijar({
    retryingId: failedId,
    messages: estado.messages.map((m) =>
      m.id === failedId
        ? { ...m, role: "assistant", content: "", pending: true, timestamp: Date.now(), errorKind: undefined }
        : m,
    ),
  });
  void correrPeticion(pregunta, failedId, contexto);
}

/** Solo para las pruebas: deja el almacén como recién cargado. */
export function reiniciarParaPruebas(): void {
  historialCargado = false;
  estado = estadoInicial(null);
  emitir();
}
