"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sparkles,
  Plus,
  Search,
  ChartLine,
  Calendar,
  Users,
  Send,
  Mic,
  Paperclip,
  Share2,
  MoreHorizontal,
  Download,
  AlertCircle,
  RotateCcw,
  Stethoscope,
  Pill,
  FileText,
  ClipboardList,
  Receipt,
  X,
  Menu,
  Zap,
  Pencil,
  Trash2,
  Check,
  CloudOff,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { AiQuotaBanner, type AiUsageSnapshot } from "@/components/dashboard/ai-quota-banner";
// El id sale del MISMO sitio que consume /api/ai: este badge decía
// "claude-sonnet-4-6" mientras el chat corría en Haiku.
import { AI_CHAT_MODEL } from "@/lib/ai/models";
import {
  AI_MESSAGE_MAX_CHARS,
  AI_MIGRATION_MAX_CONVERSATIONS,
  AI_MIGRATION_MAX_MESSAGES,
  AI_TITLE_MAX,
  chunk,
  normalizeGroup,
  titleFromMessage,
  type AiConversationGroup,
} from "@/lib/ai-assistant/conversation-core";
import styles from "./ai-assistant.module.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
}

/** Lo que la barra lateral necesita saber de una conversación. Sin turnos. */
interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: number;
  group: AiConversationGroup;
}

const SUGGESTIONS = [
  {
    icon: Stethoscope,
    titleKey: "pages.aiAssistant.suggestDdxTitle",
    descKey: "pages.aiAssistant.suggestDdxDesc",
    textKey: "pages.aiAssistant.suggestDdxText",
  },
  {
    icon: Pill,
    titleKey: "pages.aiAssistant.suggestDoseTitle",
    descKey: "pages.aiAssistant.suggestDoseDesc",
    textKey: "pages.aiAssistant.suggestDoseText",
  },
  {
    icon: FileText,
    titleKey: "pages.aiAssistant.suggestSoapTitle",
    descKey: "pages.aiAssistant.suggestSoapDesc",
    textKey: "pages.aiAssistant.suggestSoapText",
  },
  {
    icon: ClipboardList,
    titleKey: "pages.aiAssistant.suggestStudiesTitle",
    descKey: "pages.aiAssistant.suggestStudiesDesc",
    textKey: "pages.aiAssistant.suggestStudiesText",
  },
];

const SLASH_COMMANDS = [
  { cmd: "/paciente", nameKey: "pages.aiAssistant.slashPatientName", descKey: "pages.aiAssistant.slashPatientDesc", icon: Users },
  { cmd: "/soap",     nameKey: "pages.aiAssistant.slashSoapName", descKey: "pages.aiAssistant.slashSoapDesc", icon: FileText },
  { cmd: "/receta",   nameKey: "pages.aiAssistant.slashRxName", descKey: "pages.aiAssistant.slashRxDesc", icon: Pill },
  { cmd: "/odontograma", nameKey: "pages.aiAssistant.slashOdontogramName", descKey: "pages.aiAssistant.slashOdontogramDesc", icon: ClipboardList },
  { cmd: "/cotizar",  nameKey: "pages.aiAssistant.slashQuoteName", descKey: "pages.aiAssistant.slashQuoteDesc", icon: Receipt },
];

const QUICK_ACTIONS = [
  { label: "/soap", labelKey: null, icon: FileText },
  { label: "Resumir historia", labelKey: "pages.aiAssistant.quickSummarizeHistory", icon: ClipboardList },
  { label: "Preguntar sobre xray", labelKey: "pages.aiAssistant.quickAskXray", icon: Sparkles },
  { label: "/receta", labelKey: null, icon: Pill },
  { label: "WhatsApp paciente", labelKey: "pages.aiAssistant.quickWhatsappPatient", icon: Send },
];

/**
 * Clave del historial VIEJO, el que vivía en el navegador. Global: sin usuario
 * y sin clínica. Ya no se escribe nunca; solo se lee una vez para subir lo que
 * quedara dentro a la cuenta actual, y acto seguido se borra.
 */
const LEGACY_STORAGE_KEY = "mf:ai-conversations:v1";

/**
 * Dónde queda el historial viejo DESPUÉS de subirlo. No se borra: se archiva.
 *
 * Es la red de seguridad del bug que esto arregla. Esas conversaciones no
 * traían dueño, así que se atribuyen a la sesión que las sube — y en un equipo
 * compartido (la computadora de recepción) eso significa que quien abra el
 * asistente primero se queda con el historial clínico de quien lo escribió. Con
 * la copia archivada, lo que se subió a la cuenta equivocada sigue siendo
 * recuperable desde este navegador en vez de perderse para siempre.
 *
 * La clave ORIGINAL sí se limpia: es la que leía el código viejo, y mientras
 * exista el historial sigue estando expuesto a cualquiera que abra el panel.
 */
const LEGACY_BACKUP_KEY = "mf:ai-conversations:v1:migrado";

/**
 * Prefijo de las conversaciones que aún NO están en la base: nacen así cuando
 * el doctor manda el primer mensaje y se renombran al id real en cuanto el
 * servidor responde. Si el servidor no responde (503 sin SQL aplicado, red
 * caída), se quedan con este id y viven solo en esta pestaña — el chat sigue,
 * lo que no hay es dónde guardarlo.
 */
const LOCAL_ID_PREFIX = "local_";
const isLocalId = (id: string) => id.startsWith(LOCAL_ID_PREFIX);

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Number finito o null. Los endpoints de IA pueden mandar el cupo como null
 * (lectura fallida en el server) o no mandarlo, y el medidor jamás debe pintar
 * NaN: todo lo que no sea un número real se descarta aquí.
 */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && isFinite(value) ? value : null;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatRelative(ts: number, t: TFunction): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("pages.aiAssistant.relativeNow");
  if (min < 60) return t("pages.aiAssistant.relativeMin", { min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("pages.aiAssistant.relativeHour", { h });
  const d = Math.floor(h / 24);
  if (d < 7) return t("pages.aiAssistant.relativeDay", { d });
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(ts));
}

/** Fila cruda del API → metadato de la barra lateral. */
function toMeta(raw: unknown): ConversationMeta | null {
  const row = raw as { id?: unknown; title?: unknown; updatedAt?: unknown; group?: unknown };
  if (typeof row?.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    title: typeof row.title === "string" && row.title ? row.title : "—",
    updatedAt: typeof row.updatedAt === "number" && isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
    group: normalizeGroup(row.group),
  };
}

/** Turno crudo del API → mensaje pintable. */
function toMessage(raw: unknown): Message | null {
  const row = raw as { id?: unknown; role?: unknown; content?: unknown; timestamp?: unknown };
  if (typeof row?.content !== "string") return null;
  return {
    id: typeof row.id === "string" && row.id ? row.id : makeId(),
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    timestamp: typeof row.timestamp === "number" && isFinite(row.timestamp) ? row.timestamp : Date.now(),
  };
}

/**
 * Lee el historial viejo del navegador y lo deja listo para /migrate.
 * Devuelve `[]` si no hay nada aprovechable (clave ausente, JSON roto, o solo
 * conversaciones vacías — la basura que dejó el comportamiento anterior, que
 * creaba una conversación al entrar escribiera el usuario o no).
 */
function readLegacyPayload(): Array<Record<string, unknown>> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return []; // navegador con almacenamiento bloqueado: no hay nada que migrar
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  // Bucles y no map+filter con predicado de tipo: con `strict: false` en
  // tsconfig los campos opcionales se colapsan y el predicado deja de ser
  // asignable al elemento. Empujar a arrays ya tipados es directo.
  //
  // NO se recorta el número de conversaciones: se devuelven TODAS y quien llama
  // las sube por tandas del tamaño que acepta el endpoint. Recortar aquí y
  // borrar después la clave destruiría lo que nunca llegó a subir.
  const out: Array<Record<string, unknown>> = [];
  for (const c of parsed) {
    const conv = c as { id?: unknown; title?: unknown; group?: unknown; updatedAt?: unknown; messages?: unknown };
    if (typeof conv?.id !== "string" || !conv.id) continue;

    const raw = Array.isArray(conv.messages) ? conv.messages : [];
    const messages: Array<Record<string, unknown>> = [];
    // Los ÚLTIMOS N: si una conversación pasa del tope del endpoint, lo que hay
    // que conservar es el final del hilo (lo reciente), no su arranque.
    for (const m of raw.slice(-AI_MIGRATION_MAX_MESSAGES)) {
      const msg = m as { role?: unknown; content?: unknown; timestamp?: unknown };
      if (typeof msg?.content !== "string" || !msg.content.trim()) continue;
      messages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        // Se recorta AQUÍ y no en el server: el endpoint valida el tamaño con
        // zod y un solo turno gigante tiraría la migración ENTERA con un 400,
        // en vez de subir las otras veinte conversaciones.
        content: msg.content.slice(0, AI_MESSAGE_MAX_CHARS),
        ...(typeof msg.timestamp === "number" && isFinite(msg.timestamp)
          ? { timestamp: msg.timestamp }
          : {}),
      });
    }
    if (!messages.length) continue;

    out.push({
      id: conv.id.slice(0, 80),
      ...(typeof conv.title === "string" && conv.title ? { title: conv.title.slice(0, AI_TITLE_MAX) } : {}),
      group: normalizeGroup(conv.group),
      ...(typeof conv.updatedAt === "number" && isFinite(conv.updatedAt) ? { updatedAt: conv.updatedAt } : {}),
      messages,
    });
  }
  return out;
}

/**
 * Archiva el historial viejo bajo la clave de respaldo y limpia la original.
 * Solo se llama cuando TODO lo que había se subió (o cuando no había nada
 * aprovechable): si una tanda falla, la clave original se queda para reintentar
 * en la próxima carga.
 */
function archiveLegacyStorage() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) window.localStorage.setItem(LEGACY_BACKUP_KEY, raw);
  } catch {
    // Cuota llena o almacenamiento bloqueado. Se sigue igual: lo que importaba
    // ya está en el servidor; el respaldo es un extra, no la fuente.
  }
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* almacenamiento bloqueado: nada que borrar */
  }
}

export function AiAssistantClient() {
  const t = useT();

  // ── Historial (servidor) ────────────────────────────────────────────
  // `metaById` es un caché que solo CRECE: el título de la conversación abierta
  // tiene que seguir en el encabezado aunque el listado se recargue con una
  // búsqueda que no la incluya. `listIds` es lo único que decide qué pinta la
  // barra lateral, y ese sí se reemplaza en cada consulta.
  const [metaById, setMetaById] = useState<Record<string, ConversationMeta>>({});
  const [listIds, setListIds] = useState<string[]>([]);
  const [messagesById, setMessagesById] = useState<Record<string, Message[]>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /**
   * Conversaciones que NO se pudieron cargar. Sin esto, un fallo al abrirlas
   * las deja con cero mensajes en el mapa y la pantalla pinta la BIENVENIDA:
   * el doctor cree que está vacía, escribe, y la pregunta se manda a /api/ai
   * sin nada de contexto mientras el turno sí se anexa a la conversación real.
   */
  const [failedIds, setFailedIds] = useState<string[]>([]);
  /**
   * Aviso de PERSISTENCIA, no de chat. Aparece cuando el historial no se puede
   * leer o guardar (503 porque falta el SQL, red caída). Nunca bloquea:
   * preguntarle a la IA sigue funcionando, lo que no hay es dónde guardarlo.
   *
   * Guarda el TEXTO del servidor, no el ya traducido: si guardara `t(...)`, el
   * setter dependería de `t` y con él el efecto del listado, que se dispararía
   * en cada render. `text: null` = usar el error genérico del panel.
   */
  const [historyNotice, setHistoryNotice] = useState<{ text: string | null } | null>(null);

  // null = BORRADOR. Entrar al asistente abre siempre una conversación nueva y
  // vacía (pantalla de bienvenida); la conversación real nace en sendMessage con
  // el primer mensaje, así que salir sin escribir no deja rastro en el historial.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Renombrar / borrar desde la barra lateral. Solo uno a la vez.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Consumo de IA del mes (GET /api/ai/usage). Alimenta el medidor de arriba y
  // el aviso proactivo del banner sin que este último tenga que pedirlo otra vez.
  const [quota, setQuota] = useState<AiUsageSnapshot | null>(null);
  // Mobile drawer del sidebar (lista de conversaciones). En desktop el
  // aside ya está visible permanentemente; en mobile pasa a off-canvas.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  /**
   * Renombrados y borrados que el doctor hizo sobre una conversación que
   * TODAVÍA no tenía id de la base (el POST de creación en vuelo).
   *
   * Sin esto se pierden en silencio: renombrar una conversación local no puede
   * mandar PATCH porque no hay id, y `adoptServerId` la pisaría con el título
   * que devolvió el servidor; y borrarla solo la quita de la pantalla, mientras
   * la fila queda en la base y reaparece en la siguiente carga. `adoptServerId`
   * aplica lo pendiente en cuanto el id real llega.
   *
   * Va en un ref y no en estado: nadie lo pinta, y tiene que poder leerse desde
   * dentro de la promesa de guardado sin provocar un render.
   */
  const pendingIntentRef = useRef<Record<string, { title?: string; deleted?: boolean }>>({});

  /** Mete/actualiza metadatos en el caché sin tocar el orden del listado. */
  const rememberMeta = useCallback((...metas: ConversationMeta[]) => {
    if (!metas.length) return;
    setMetaById((prev) => {
      const next = { ...prev };
      for (const m of metas) next[m.id] = m;
      return next;
    });
  }, []);

  /**
   * Traduce el fallo de una llamada al historial en el aviso de arriba. El 503
   * de `storage_unavailable` trae un mensaje accionable del server (falta
   * aplicar el .sql); cualquier otro fallo cae al error genérico del panel.
   */
  const noteHistoryFailure = useCallback(async (res: Response | null) => {
    if (res) {
      const body = await res.json().catch(() => null as unknown);
      const message = (body as { message?: unknown } | null)?.message;
      if (typeof message === "string" && message) {
        setHistoryNotice({ text: message });
        return;
      }
    }
    setHistoryNotice({ text: null });
  }, []);

  // ── Migración de una sola vez desde localStorage ────────────────────
  // Corre ANTES del primer listado para que lo migrado ya salga en la barra
  // lateral. Si falla, la clave NO se borra y se reintenta en la próxima carga.
  const [migrationDone, setMigrationDone] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const payload = readLegacyPayload();
      if (!payload.length) {
        // Puede haber quedado una clave con puras conversaciones vacías o JSON
        // roto: se limpia igual, ya no la escribe nadie.
        archiveLegacyStorage();
        if (alive) setMigrationDone(true);
        return;
      }
      try {
        // POR TANDAS hasta agotar el historial. Un doctor con 140
        // conversaciones no puede perder 40 porque el endpoint acepte 100 por
        // llamada: se sube todo o no se limpia nada. El endpoint es idempotente
        // por legacyId, así que repetir una tanda es un no-op.
        let completo = true;
        for (const lote of chunk(payload, AI_MIGRATION_MAX_CONVERSATIONS)) {
          const res = await fetch("/api/ai-assistant/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversations: lote }),
          });
          if (!res.ok) {
            // 503 (falta el SQL), 429, red: se corta y la clave se queda donde
            // está para reintentar en la próxima carga.
            completo = false;
            break;
          }
        }
        if (completo) archiveLegacyStorage();
      } catch {
        /* red caída: se reintenta en la próxima carga */
      } finally {
        if (alive) setMigrationDone(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Debounce de la búsqueda: el filtro ya no es en memoria, cada tecla sería
  // una consulta al servidor.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // ── Listado del historial ───────────────────────────────────────────
  // Se recarga al cambiar la búsqueda. Las conversaciones locales (las que
  // todavía no llegaron a la base) se conservan arriba: si no, la que se está
  // escribiendo desaparecería de la barra lateral al teclear en el buscador.
  useEffect(() => {
    if (!migrationDone) return;
    let alive = true;
    (async () => {
      setHistoryLoading(true);
      try {
        const qs = debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : "";
        const res = await fetch(`/api/ai-assistant/conversations${qs}`);
        if (!res.ok) {
          if (alive) await noteHistoryFailure(res);
          return;
        }
        const data = await res.json();
        const metas = (Array.isArray(data?.conversations) ? data.conversations : [])
          .map(toMeta)
          .filter((m: ConversationMeta | null): m is ConversationMeta => m !== null);
        if (!alive) return;
        rememberMeta(...metas);
        setListIds((prev) => {
          const locals = prev.filter(isLocalId);
          return [...locals, ...metas.map((m: ConversationMeta) => m.id)];
        });
        setHistoryNotice(null);
      } catch {
        if (alive) await noteHistoryFailure(null);
      } finally {
        if (alive) setHistoryLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [debouncedSearch, migrationDone, noteHistoryFailure, rememberMeta]);

  // Lectura inicial del cupo. El medidor es SECUNDARIO: si el endpoint falla o
  // tarda, se traga el error y el chat sigue funcionando exactamente igual.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ai/usage");
        if (!res.ok) return;
        const data = (await res.json()) as AiUsageSnapshot;
        if (alive && data && finiteOrNull(data.limit) !== null) setQuota(data);
      } catch {
        /* silencioso: un medidor nunca debe tumbar la pantalla */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Fusiona en el medidor lo que devuelven los endpoints de IA. Ojo: el 200 de
   * /api/ai manda `tokensUsed` de ESA llamada (no el acumulado del mes), así
   * que `used` se DERIVA siempre de limit - remaining; el `used` del cuerpo 429
   * sí es acumulado y se usa como fallback. Barra, % y "restantes" salen todos
   * del mismo cálculo (idéntico al de /api/ai/usage) para que no se contradigan,
   * y con limit 0 (plan sin IA) el porcentaje es 0 — nunca una división por cero.
   */
  const applyQuota = useCallback(
    (patch: { limit?: unknown; remaining?: unknown; used?: unknown }) => {
      setQuota((prev) => {
        const nextLimit = finiteOrNull(patch.limit) ?? (prev ? finiteOrNull(prev.limit) : null);
        if (nextLimit === null) return prev; // sin límite conocido no hay medidor

        const limit = Math.max(0, nextLimit);
        const patchRemaining = finiteOrNull(patch.remaining);
        const rawUsed =
          patchRemaining !== null && limit > 0
            ? limit - patchRemaining
            : (finiteOrNull(patch.used) ?? (prev ? finiteOrNull(prev.used) : null));
        if (rawUsed === null) return prev;

        const used = Math.max(0, rawUsed);
        return {
          ...(prev ?? {}),
          limit,
          used,
          remaining: Math.max(0, limit - used),
          percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
        };
      });
    },
    [],
  );

  // Números ya saneados para pintar: se re-derivan del snapshot (venga del
  // fetch inicial o de applyQuota) para que el render sea imposible de romper.
  const meter = useMemo(() => {
    const limit = Math.max(0, finiteOrNull(quota?.limit) ?? 0);
    const used = Math.max(0, finiteOrNull(quota?.used) ?? 0);
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    };
  }, [quota]);

  const activeConv = activeId ? (metaById[activeId] ?? null) : null;
  const messages = useMemo(
    () => (activeId ? (messagesById[activeId] ?? []) : []),
    [activeId, messagesById],
  );

  /**
   * La conversación abierta no se pudo leer. Mientras esté así, el composer se
   * bloquea: escribir en un hilo que no cargó manda la pregunta a la IA sin
   * contexto y anexa el turno a una conversación que en pantalla parece vacía.
   */
  const activeFailed = !!activeId && failedIds.includes(activeId) && messages.length === 0;

  const listedConvs = useMemo(
    () => listIds.map((id) => metaById[id]).filter((m): m is ConversationMeta => !!m),
    [listIds, metaById],
  );

  const grouped = useMemo(() => {
    const groups: Record<AiConversationGroup, ConversationMeta[]> = {
      clinico: [], admin: [], pacientes: [],
    };
    for (const c of listedConvs) groups[c.group].push(c);
    return groups;
  }, [listedConvs]);

  // Scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-expand textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(240, el.scrollHeight)}px`;
  }, [input]);

  // Slash popover detection
  useEffect(() => {
    const open = input.startsWith("/") && !input.includes(" ");
    setSlashOpen(open);
    setSlashIndex(0);
  }, [input]);

  /**
   * Vuelve al BORRADOR: `activeId` en null pinta la pantalla de bienvenida y no
   * hay nada que guardar. Ya no crea ni persiste una conversación vacía — de eso
   * se encarga `sendMessage`, que la crea con el primer mensaje (y con él como
   * título). Así el historial nunca tiene conversaciones vacías.
   */
  const startNew = useCallback(() => {
    setActiveId(null);
    setInput("");
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // Cmd/Ctrl + K → nueva conversación
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        startNew();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [startNew]);

  /**
   * Abre una conversación del historial. Los turnos se piden la primera vez y
   * quedan cacheados: volver a una conversación ya leída no consulta de nuevo.
   */
  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    setMobileSidebarOpen(false);
    if (messagesById[id] || isLocalId(id)) return;

    setOpeningId(id);
    try {
      const res = await fetch(`/api/ai-assistant/conversations/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setFailedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        await noteHistoryFailure(res);
        return;
      }
      const data = await res.json();
      const meta = toMeta(data?.conversation);
      if (meta) rememberMeta(meta);
      const msgs = (Array.isArray(data?.messages) ? data.messages : [])
        .map(toMessage)
        .filter((m: Message | null): m is Message => m !== null);
      setMessagesById((prev) => ({ ...prev, [id]: msgs }));
      setFailedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
      setHistoryNotice(null);
    } catch {
      setFailedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      await noteHistoryFailure(null);
    } finally {
      setOpeningId((cur) => (cur === id ? null : cur));
    }
  }, [messagesById, noteHistoryFailure, rememberMeta]);

  /**
   * Sustituye el id local por el que devolvió la base, en las tres estructuras
   * a la vez, y aplica lo que el doctor hiciera mientras el POST volaba
   * (renombrar / borrar). Solo mueve `activeId` si sigue en esa conversación:
   * si ya se fue a otra, cambiársela debajo sería peor que dejar el id viejo.
   *
   * Devuelve el id vigente, o `null` si la conversación se descartó (la borró
   * mientras nacía): con null, quien llama sabe que no debe seguir escribiendo
   * en ella.
   */
  const adoptServerId = useCallback((localId: string, meta: ConversationMeta): string | null => {
    const intent = pendingIntentRef.current[localId];
    delete pendingIntentRef.current[localId];

    // Borrada mientras nacía. La fila YA está en la base: si no se borra ahora,
    // en pantalla parece que se fue pero reaparece en la próxima carga con el
    // texto que el doctor creía haber tirado.
    if (intent?.deleted) {
      void fetch(`/api/ai-assistant/conversations/${encodeURIComponent(meta.id)}`, { method: "DELETE" })
        .catch(() => {
          /* red caída: quedará en el historial y se podrá volver a borrar */
        });
      return null;
    }

    // Renombrada mientras nacía: el título escrito a mano MANDA sobre el que
    // derivó el servidor del primer mensaje, y ahora sí se puede persistir.
    const adopted = intent?.title ? { ...meta, title: intent.title } : meta;
    if (intent?.title) {
      void fetch(`/api/ai-assistant/conversations/${encodeURIComponent(meta.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: intent.title }),
      }).catch(() => {
        /* se queda con el título derivado; el doctor puede renombrar otra vez */
      });
    }

    setMetaById((prev) => {
      const next = { ...prev };
      delete next[localId];
      next[adopted.id] = adopted;
      return next;
    });
    // El `filter` de después no sobra: si mientras el POST volaba se recargó el
    // listado (basta teclear en el buscador), la conversación recién creada ya
    // entró con su id de la base y el `map` la dejaría DOS veces — misma `key`
    // de React, fila pintada por duplicado.
    setListIds((prev) => {
      const mapped = prev.map((id) => (id === localId ? adopted.id : id));
      return mapped.filter((id, i) => mapped.indexOf(id) === i);
    });
    setMessagesById((prev) => {
      if (!(localId in prev)) return prev;
      const next = { ...prev };
      next[adopted.id] = next[localId];
      delete next[localId];
      return next;
    });
    setActiveId((cur) => (cur === localId ? adopted.id : cur));
    return adopted.id;
  }, []);

  /**
   * Guarda el turno del doctor. Si la conversación aún no existe en la base la
   * crea (y adopta el id real); si ya existe, anexa.
   *
   * Devuelve el id del servidor, o `null` si no se pudo guardar. NUNCA lanza:
   * un historial que no se puede escribir no debe impedir preguntarle a la IA.
   */
  const persistUserTurn = useCallback(async (
    localConvId: string,
    serverConvId: string | null,
    text: string,
    priorTurns: Message[],
    title: string,
  ): Promise<string | null> => {
    try {
      if (serverConvId) {
        const res = await fetch(`/api/ai-assistant/conversations/${encodeURIComponent(serverConvId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text.slice(0, AI_MESSAGE_MAX_CHARS) }),
        });
        if (!res.ok) {
          await noteHistoryFailure(res);
          return null;
        }
        setHistoryNotice(null);
        return serverConvId;
      }

      // Turnos con los que nace la conversación. Casi siempre es uno solo (el
      // primer mensaje). Los `priorTurns` solo aparecen cuando la conversación
      // se quedó local porque un guardado anterior falló —típicamente el .sql
      // sin aplicar—: al recuperarse, el hilo sube con lo que ya llevaba en vez
      // de empezar desde el último mensaje. El tope de 10 lo impone el endpoint.
      const seed = [...priorTurns, { role: "user" as const, content: text }]
        .filter((m) => !("streaming" in m && m.streaming) && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, AI_MESSAGE_MAX_CHARS) }));

      // El título va explícito: si `seed` arrastra turnos previos, el primero
      // podría ser una RESPUESTA del asistente, y el servidor titularía la
      // conversación con ella. El que ya se ve en pantalla es el bueno.
      const res = await fetch("/api/ai-assistant/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: "clinico", title, messages: seed }),
      });
      if (!res.ok) {
        await noteHistoryFailure(res);
        return null;
      }
      const data = await res.json();
      const meta = toMeta(data?.conversation);
      if (!meta) return null;
      setHistoryNotice(null);
      // adoptServerId devuelve null si el doctor la borró mientras nacía: en
      // ese caso NO hay dónde guardar la respuesta del asistente.
      return adoptServerId(localConvId, meta);
    } catch {
      await noteHistoryFailure(null);
      return null;
    }
  }, [adoptServerId, noteHistoryFailure]);

  /** Guarda la respuesta del asistente. Silencioso: el aviso ya lo puso el turno del doctor. */
  const persistAssistantTurn = useCallback(async (serverConvId: string, reply: string) => {
    try {
      const res = await fetch(`/api/ai-assistant/conversations/${encodeURIComponent(serverConvId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: reply.slice(0, AI_MESSAGE_MAX_CHARS) }),
      });
      // El 404 se traga a propósito: significa que la conversación ya no está,
      // y el caso normal es que el doctor la borrara mientras se revelaba la
      // respuesta. Avisar de que "no se está guardando el historial" por algo
      // que él mismo acaba de pedir sería mentirle.
      if (!res.ok && res.status !== 404) await noteHistoryFailure(res);
    } catch {
      await noteHistoryFailure(null);
    }
  }, [noteHistoryFailure]);

  const sendMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    // `activeFailed`: la conversación abierta no se pudo leer. Mandar aquí
    // iría a /api/ai SIN contexto y anexaría el turno a un hilo que en pantalla
    // parece vacío. Mejor no dejar escribir hasta que cargue o se empiece otra.
    if (!text || loading || activeFailed) return;

    setError(null);

    // Historial que se le manda a /api/ai: los turnos ANTERIORES al que se está
    // escribiendo, igual que antes.
    const history = messages;

    // Id con el que se pinta AHORA. Si la conversación es nueva arranca local y
    // se cambia por el de la base en cuanto el POST responda; así el mensaje
    // aparece al instante en vez de esperar una ida al servidor.
    const serverConvId = activeId && !isLocalId(activeId) ? activeId : null;
    const localConvId = activeId ?? `${LOCAL_ID_PREFIX}${makeId()}`;
    const now = Date.now();
    // Título que ya se ve (o el que se va a ver). Se le pasa al servidor para
    // que no lo re-derive: si la conversación se quedó local por un fallo de
    // guardado, arrastra turnos previos y el primero podría ser una respuesta.
    const localTitle = metaById[localConvId]?.title ?? titleFromMessage(text);

    if (!activeId) {
      rememberMeta({ id: localConvId, title: localTitle, updatedAt: now, group: "clinico" });
      setListIds((prev) => [localConvId, ...prev]);
      setActiveId(localConvId);
    } else {
      setMetaById((prev) => {
        const cur = prev[localConvId];
        return cur ? { ...prev, [localConvId]: { ...cur, updatedAt: now } } : prev;
      });
      // Sube la conversación al principio de la barra lateral, igual que hace
      // el orderBy del listado.
      setListIds((prev) => [localConvId, ...prev.filter((id) => id !== localConvId)]);
    }

    const userMsg: Message = { id: makeId(), role: "user", content: text, timestamp: now };
    const placeholderId = makeId();
    setMessagesById((prev) => ({
      ...prev,
      [localConvId]: [
        ...(prev[localConvId] ?? []),
        userMsg,
        { id: placeholderId, role: "assistant", content: "", timestamp: now, streaming: true },
      ],
    }));

    setInput("");
    setLoading(true);

    // El guardado del turno del doctor va EN PARALELO con la llamada a la IA:
    // encadenarlos le sumaría una ida al servidor a cada pregunta. La promesa
    // nunca rechaza (persistUserTurn se traga todo), así que no hay unhandled.
    const persistPromise = persistUserTurn(localConvId, serverConvId, text, history, localTitle);

    // `patchMessages` trabaja SIEMPRE contra localConvId; si mientras tanto la
    // conversación adoptó el id de la base, adoptServerId ya movió la entrada
    // del mapa, así que se resuelve el id vigente en cada actualización.
    const patchMessages = (convId: string, fn: (msgs: Message[]) => Message[]) => {
      setMessagesById((prev) => {
        const key = convId in prev ? convId : null;
        if (!key) return prev;
        return { ...prev, [key]: fn(prev[key]) };
      });
    };

    // Id con el que se pinta el hilo, y el id ya guardado (null si no se pudo
    // guardar). Son distintos a propósito: la respuesta del asistente solo se
    // guarda si la PREGUNTA se guardó — si no, quedaría una respuesta huérfana
    // sin la pregunta que la provocó.
    let resolvedConvId = localConvId;
    let persistedConvId: string | null = null;
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: history,
        }),
      });
      const data = await res.json();
      // Medidor en vivo. El 200 trae tokensLimit/tokensRemaining y el 429 trae
      // used/limit: se aplica ANTES del throw para que, al toparse el cupo, la
      // barra ya se vea llena cuando aparezca el error.
      applyQuota({
        limit: data?.tokensLimit ?? data?.limit,
        remaining: data?.tokensRemaining,
        used: data?.used,
      });
      if (!res.ok) {
        throw new Error(data.error ?? t("pages.aiAssistant.errorQuery"));
      }

      // El id real ya está: a partir de aquí el mapa de mensajes está bajo él.
      persistedConvId = await persistPromise;
      resolvedConvId = persistedConvId ?? localConvId;

      const reply = String(data.reply ?? "");
      // Streaming visual: revela char por char
      let revealed = "";
      const chunkSize = Math.max(2, Math.ceil(reply.length / 80));
      for (let i = 0; i < reply.length; i += chunkSize) {
        revealed = reply.slice(0, i + chunkSize);
        await new Promise((r) => setTimeout(r, 18));
        patchMessages(resolvedConvId, (msgs) =>
          msgs.map((m) => (m.id === placeholderId ? { ...m, content: revealed, streaming: true } : m)),
        );
      }
      // Cierra streaming
      patchMessages(resolvedConvId, (msgs) =>
        msgs.map((m) => (m.id === placeholderId ? { ...m, content: reply, streaming: false } : m)),
      );

      // Guardar la respuesta va al final y sin bloquear el render: el doctor ya
      // la está leyendo.
      if (persistedConvId && reply.trim()) {
        void persistAssistantTurn(persistedConvId, reply);
      }
    } catch (err) {
      persistedConvId = await persistPromise;
      resolvedConvId = persistedConvId ?? localConvId;
      const msg = err instanceof Error ? err.message : t("pages.aiAssistant.errorQuery");
      setError(msg);
      patchMessages(resolvedConvId, (msgs) => msgs.filter((m) => m.id !== placeholderId));
    } finally {
      setLoading(false);
    }
  }, [activeFailed, activeId, applyQuota, input, loading, messages, metaById, persistAssistantTurn, persistUserTurn, rememberMeta, t]);

  // ── Renombrar / borrar ──────────────────────────────────────────────
  const startRename = useCallback((meta: ConversationMeta) => {
    setConfirmDeleteId(null);
    setRenamingId(meta.id);
    setRenameDraft(meta.title);
  }, []);

  const commitRename = useCallback(async (id: string) => {
    const title = renameDraft.trim().slice(0, AI_TITLE_MAX);
    setRenamingId(null);
    const current = metaById[id];
    if (!title || !current || title === current.title) return;

    // Optimista: el título nuevo se ve ya. Si el servidor lo rechaza se
    // devuelve al anterior.
    rememberMeta({ ...current, title });
    if (isLocalId(id)) {
      // Todavía no hay id que mandar en el PATCH. Se anota para que
      // adoptServerId lo aplique —y lo persista— en cuanto llegue el id real;
      // sin esta nota, el título del servidor pisaría el escrito a mano.
      pendingIntentRef.current[id] = { ...(pendingIntentRef.current[id] ?? {}), title };
      return;
    }

    try {
      const res = await fetch(`/api/ai-assistant/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        rememberMeta(current);
        await noteHistoryFailure(res);
        return;
      }
      const data = await res.json();
      const meta = toMeta(data?.conversation);
      if (meta) rememberMeta(meta);
      setHistoryNotice(null);
    } catch {
      rememberMeta(current);
      await noteHistoryFailure(null);
    }
  }, [metaById, noteHistoryFailure, rememberMeta, renameDraft]);

  const removeConversation = useCallback(async (id: string) => {
    setConfirmDeleteId(null);

    const forget = () => {
      setListIds((prev) => prev.filter((x) => x !== id));
      setMetaById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setMessagesById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFailedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
      setActiveId((cur) => (cur === id ? null : cur));
    };

    // Conversación sin id de la base todavía. Se quita de la pantalla y se
    // anota el borrado: si el POST de creación seguía en vuelo, adoptServerId
    // mandará el DELETE con el id real. Sin esa nota la fila se quedaría en la
    // base y reaparecería en la próxima carga.
    if (isLocalId(id)) {
      pendingIntentRef.current[id] = { ...(pendingIntentRef.current[id] ?? {}), deleted: true };
      forget();
      return;
    }

    try {
      const res = await fetch(`/api/ai-assistant/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      // Un 404 también borra en pantalla: si no es tuya o ya no existe, no
      // tiene por qué seguir en la barra lateral.
      if (!res.ok && res.status !== 404) {
        await noteHistoryFailure(res);
        return;
      }
      forget();
      setHistoryNotice(null);
    } catch {
      await noteHistoryFailure(null);
    }
  }, [noteHistoryFailure]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, SLASH_COMMANDS.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = SLASH_COMMANDS[slashIndex];
        if (cmd) setInput(`${cmd.cmd} `);
        return;
      }
      if (e.key === "Escape") {
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }, [slashOpen, slashIndex, sendMessage]);

  const toggleVoice = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "voice.webm");
        try {
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
          if (res.status === 429) {
            // Mismo endpoint (y mismo monedero de tokens) que el dictado de la
            // ficha: si el plan no incluye IA o se acabó el cupo, hay que
            // decirlo claro en vez de caer al mensaje genérico de abajo.
            const body = await res.json().catch(() => ({} as { limit?: number }));
            // El 429 trae used/limit acumulados: aprovecha para dejar el
            // medidor al día en vez de que se quede con el valor anterior.
            applyQuota({ limit: body?.limit, used: body?.used });
            toast.error(
              t(body && body.limit === 0
                ? "pages.aiAssistant.voiceNoPlan"
                : "pages.aiAssistant.voiceNoTokens"),
            );
            return;
          }
          if (!res.ok) {
            // Endpoint puede no existir todavía — degradación silenciosa
            toast(t("pages.aiAssistant.voicePending"), { icon: "🎙️" });
            return;
          }
          const data = await res.json();
          if (data.text) setInput((prev) => `${prev}${prev ? " " : ""}${data.text}`);
          // Feedback discreto del cobro del dictado. Los campos pueden llegar
          // null (lectura de cupo fallida en el server) o no llegar: en ese
          // caso se comporta exactamente como antes — ni toast ni medidor.
          const charged = finiteOrNull(data?.tokensCharged);
          const left = finiteOrNull(data?.tokensRemaining);
          if (charged !== null && left !== null) {
            applyQuota({ limit: data?.tokensLimit, remaining: left });
            toast(
              t("pages.aiAssistant.quotaDictation", {
                used: charged.toLocaleString(),
                remaining: left.toLocaleString(),
              }),
              { icon: "🎙️" },
            );
          }
        } catch {
          toast(t("pages.aiAssistant.voiceError"), { icon: "⚠️" });
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error(t("pages.aiAssistant.micError"));
    }
  }, [recording, t, applyQuota]);

  const insertCommand = useCallback((cmd: string) => {
    setInput((prev) => {
      if (prev.startsWith("/")) return cmd;
      return prev ? `${prev} ${cmd}` : `${cmd} `;
    });
    setSlashOpen(false);
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.page}
      data-mobile-sidebar-open={mobileSidebarOpen || undefined}
    >
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label={t("pages.aiAssistant.closeHistory")}
          className={styles.mobileBackdrop}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* ── Sidebar (drawer en mobile) ── */}
      <aside
        className={styles.sidebar}
        role={mobileSidebarOpen ? "dialog" : undefined}
        aria-modal={mobileSidebarOpen ? "true" : undefined}
        aria-label={t("pages.aiAssistant.conversationsHistory")}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.brandTitle}>
            <span className={styles.brandIcon}><Sparkles size={14} aria-hidden /></span>
            {t("pages.aiAssistant.brandTitle")}
          </div>
          <button type="button" className={styles.newConvBtn} onClick={startNew}>
            <Plus size={13} aria-hidden /> {t("pages.aiAssistant.newConversation")}
            <kbd>⌘K</kbd>
          </button>
          <div className={styles.searchWrap}>
            <Search size={13} aria-hidden className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder={t("pages.aiAssistant.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.convList}>
          {(["clinico", "admin", "pacientes"] as const).map((g) => {
            const items = grouped[g];
            if (items.length === 0) return null;
            const Icon = g === "clinico" ? ChartLine : g === "admin" ? Calendar : Users;
            const label = g === "clinico" ? t("pages.aiAssistant.groupClinical") : g === "admin" ? t("pages.aiAssistant.groupAdmin") : t("pages.aiAssistant.groupPatients");
            return (
              <div key={g}>
                <div className={styles.convGroupLabel}>
                  <Icon size={11} aria-hidden /> {label}
                </div>
                {items.map((c) => (
                  <div key={c.id} className={styles.convRow}>
                    {renamingId === c.id ? (
                      <div className={styles.convRename}>
                        <input
                          type="text"
                          className={styles.convRenameInput}
                          value={renameDraft}
                          maxLength={AI_TITLE_MAX}
                          autoFocus
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void commitRename(c.id); }
                            if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                          }}
                          aria-label={t("common.edit")}
                        />
                        <button
                          type="button"
                          className={styles.convAction}
                          onClick={() => void commitRename(c.id)}
                          title={t("common.save")}
                          aria-label={t("common.save")}
                        >
                          <Check size={12} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={styles.convAction}
                          onClick={() => setRenamingId(null)}
                          title={t("common.cancel")}
                          aria-label={t("common.cancel")}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.convItem} ${c.id === activeId ? styles.convItemActive : ""}`}
                          onClick={() => void openConversation(c.id)}
                        >
                          <span className={styles.convItemTitle}>{c.title}</span>
                          <span className={styles.convItemTime}>
                            {formatRelative(c.updatedAt, t)}
                            {isLocalId(c.id) && (
                              <>
                                {" · "}
                                <CloudOff size={9} aria-hidden style={{ display: "inline", verticalAlign: "-1px" }} />
                              </>
                            )}
                          </span>
                        </button>
                        <div className={styles.convActions}>
                          {confirmDeleteId === c.id ? (
                            <>
                              <button
                                type="button"
                                className={`${styles.convAction} ${styles.convActionDanger}`}
                                onClick={() => void removeConversation(c.id)}
                                title={t("common.delete")}
                                aria-label={t("common.delete")}
                              >
                                <Check size={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={styles.convAction}
                                onClick={() => setConfirmDeleteId(null)}
                                title={t("common.cancel")}
                                aria-label={t("common.cancel")}
                              >
                                <X size={12} aria-hidden />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={styles.convAction}
                                onClick={() => startRename(c)}
                                title={t("common.edit")}
                                aria-label={t("common.edit")}
                              >
                                <Pencil size={12} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className={`${styles.convAction} ${styles.convActionDanger}`}
                                onClick={() => { setRenamingId(null); setConfirmDeleteId(c.id); }}
                                title={t("common.delete")}
                                aria-label={t("common.delete")}
                              >
                                <Trash2 size={12} aria-hidden />
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {listedConvs.length === 0 && (
            <div style={{ padding: "20px 12px" }}>
              {historyLoading ? (
                <div className={styles.convListLoading}>
                  <Loader2 size={14} aria-hidden className={styles.spin} />
                  {t("common.loading")}
                </div>
              ) : search ? (
                <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
                  {t("pages.aiAssistant.noResultsFor", { search })}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "16px 8px" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--brand-softer)", border: "1px solid var(--border-brand)", display: "grid", placeItems: "center", color: "var(--brand)" }}>
                    <Sparkles size={20} strokeWidth={1.75} aria-hidden />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                    {t("pages.aiAssistant.noConversationsYet")}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, maxWidth: 220 }}>
                    {t("pages.aiAssistant.emptyHint")}
                  </div>
                  <button
                    type="button"
                    onClick={startNew}
                    className={styles.emptyStartBtn}
                  >
                    <Plus size={11} strokeWidth={1.75} aria-hidden /> {t("pages.aiAssistant.start")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.userBlock}>
          <div className={styles.userAvatar}>DR</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.userName}>{t("pages.aiAssistant.doctor")}</div>
            <div className={styles.userRole}>{t("pages.aiAssistant.activeSession")}</div>
          </div>
        </div>
      </aside>

      {/* ── Main chat ── */}
      <main className={styles.main}>
        <header className={styles.chatHeader}>
          {/* Hamburger sólo visible en mobile. */}
          <button
            type="button"
            className={styles.mobileMenuBtn}
            onClick={() => setMobileSidebarOpen(true)}
            aria-label={t("pages.aiAssistant.openHistory")}
          >
            <Menu size={16} aria-hidden />
          </button>
          <div className={styles.chatHeaderInfo}>
            <h1 className={styles.chatTitle}>
              <Sparkles size={14} aria-hidden style={{ color: "var(--brand)" }} />
              {activeConv?.title ?? t("pages.aiAssistant.clinicalAssistant")}
            </h1>
            <div className={styles.chatMeta}>
              {AI_CHAT_MODEL} · {t("pages.aiAssistant.messageCount", { count: messages.length })}
            </div>
          </div>
          <div className={styles.chatHeaderActions}>
            <button type="button" className={styles.iconBtn} title={t("pages.aiAssistant.share")} aria-label={t("pages.aiAssistant.shareConversation")}>
              <Share2 size={14} aria-hidden />
            </button>
            <button type="button" className={styles.iconBtn} title={t("common.export")} aria-label={t("pages.aiAssistant.exportConversation")}>
              <Download size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title={t("pages.aiAssistant.newConversation")}
              aria-label={t("pages.aiAssistant.startNewConversation")}
              onClick={startNew}
            >
              <RotateCcw size={14} aria-hidden />
            </button>
            <button type="button" className={styles.iconBtn} title={t("pages.aiAssistant.more")} aria-label={t("pages.aiAssistant.moreOptions")}>
              <MoreHorizontal size={14} aria-hidden />
            </button>
          </div>
        </header>

        {/* Aviso de PERSISTENCIA. No es un error del chat: preguntarle a la IA
            sigue funcionando, lo que falla es guardar o leer el historial
            (típicamente, el .sql todavía sin aplicar en Supabase). */}
        {historyNotice && (
          <div className={styles.historyNotice} role="status">
            <CloudOff size={13} aria-hidden style={{ flexShrink: 0 }} />
            <span>{historyNotice.text ?? t("common.genericError")}</span>
          </div>
        )}

        {/* ── Cupo de IA: aviso proactivo + medidor del mes ──
            Va en la columna principal (no en el aside, que en mobile es un
            drawer oculto) para que se vea igual en desktop y en teléfono.
            Sin snapshot no se pinta nada: ni banda vacía ni medidor a medias. */}
        {quota && (
          <div className={styles.quotaStrip}>
            <div className={styles.quotaInner}>
              <AiQuotaBanner usage={quota} />
              {meter.limit > 0 ? (
                <div>
                  <div className={styles.quotaHead}>
                    <span className={styles.quotaLabel}>
                      <Zap size={12} strokeWidth={2} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
                      <span className={styles.quotaLabelText}>{t("pages.aiAssistant.quotaTitle")}</span>
                    </span>
                    <span className={styles.quotaNumbers} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {meter.used.toLocaleString()} / {meter.limit.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: "var(--bg-elev-2)" }}
                    role="progressbar"
                    aria-label={t("pages.aiAssistant.quotaTitle")}
                    aria-valuenow={meter.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${meter.percent}%`,
                        background: meter.percent > 80 ? "var(--danger)" : meter.percent > 60 ? "var(--warning)" : "var(--brand)",
                        transition: "width var(--dur-2) var(--ease)",
                      }}
                    />
                  </div>
                  <div className={styles.quotaSubRow}>
                    <span className={styles.quotaSub} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t("pages.aiAssistant.quotaPercent", { percent: meter.percent })}
                    </span>
                    <span className={styles.quotaSubStrong} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {t("pages.aiAssistant.quotaRemaining", { count: meter.remaining.toLocaleString() })}
                    </span>
                  </div>
                </div>
              ) : (
                <div className={styles.quotaNoPlan}>
                  <Zap size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
                  {t("pages.aiAssistant.quotaNoPlan")}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.messagesScroll}>
          <div className={styles.messagesInner}>
            {openingId && openingId === activeId && messages.length === 0 ? (
              <div className={styles.convListLoading} style={{ padding: "40px 0" }}>
                <Loader2 size={16} aria-hidden className={styles.spin} />
                {t("common.loading")}
              </div>
            ) : activeFailed ? (
              /* No se pudo cargar esta conversación. NO se pinta la bienvenida:
                 parecería vacía, y escribir aquí mandaría la pregunta sin nada
                 de contexto mientras el turno sí se anexa a la de verdad. */
              <div className={styles.loadFailed}>
                <CloudOff size={20} strokeWidth={1.75} aria-hidden />
                <span>{historyNotice?.text ?? t("common.genericError")}</span>
                <button
                  type="button"
                  className={styles.emptyStartBtn}
                  onClick={() => void openConversation(activeId)}
                >
                  <RotateCcw size={11} strokeWidth={1.75} aria-hidden /> {t("common.retry")}
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className={styles.welcome}>
                <div className={styles.welcomeIcon}><Sparkles size={26} aria-hidden /></div>
                <h2 className={styles.welcomeTitle}>{t("pages.aiAssistant.clinicalAssistant")}</h2>
                <p className={styles.welcomeText}>
                  {t("pages.aiAssistant.welcomeText")}
                </p>
                <div className={styles.suggestionsGrid}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.titleKey}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => setInput(t(s.textKey))}
                    >
                      <span className={styles.suggestionIcon}><s.icon size={14} aria-hidden /></span>
                      <span className={styles.suggestionTitle}>{t(s.titleKey)}</span>
                      <span className={styles.suggestionDesc}>{t(s.descKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={styles.message}>
                  {m.role === "user" ? (
                    <div className={styles.avatarUser}>DR</div>
                  ) : (
                    <div className={`${styles.avatarAssistant} ${m.streaming ? styles.streaming : ""}`}>
                      <Sparkles size={14} aria-hidden />
                    </div>
                  )}
                  <div className={styles.messageRow}>
                    <div className={styles.messageMeta}>
                      <span className={styles.messageName}>
                        {m.role === "user" ? t("pages.aiAssistant.doctor") : t("pages.aiAssistant.aiAssistant")}
                      </span>
                      <span className={styles.messageTimestamp}>{formatTime(m.timestamp)}</span>
                      {m.role === "assistant" && (
                        <span className={styles.modelBadge}>{AI_CHAT_MODEL}</span>
                      )}
                    </div>
                    <div className={`${styles.messageContent} ${m.streaming ? styles.streamingCursor : ""}`}>
                      {m.content || (m.streaming ? "" : "—")}
                    </div>
                  </div>
                </div>
              ))
            )}

            {error && (
              <div className={styles.errorBubble}>
                <AlertCircle size={14} aria-hidden style={{ marginTop: 1, flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ── Composer ── */}
        <div className={styles.composerWrap}>
          <div className={styles.composerInner}>
            <div className={styles.quickActions}>
              {QUICK_ACTIONS.map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  className={styles.quickAction}
                  onClick={() => {
                    if (qa.label.startsWith("/")) insertCommand(qa.label);
                    else setInput((prev) => (prev ? `${prev} ${qa.label}` : qa.label));
                  }}
                >
                  <qa.icon size={11} aria-hidden />
                  {qa.label.startsWith("/") ? <code>{qa.label}</code> : (qa.labelKey ? t(qa.labelKey) : qa.label)}
                </button>
              ))}
            </div>

            <div className={styles.composerBox}>
              {/* Slash popover */}
              <div className={styles.slashPopover} data-open={slashOpen}>
                {SLASH_COMMANDS.map((c, i) => (
                  <button
                    key={c.cmd}
                    type="button"
                    className={`${styles.slashItem} ${i === slashIndex ? styles.slashItemActive : ""}`}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => insertCommand(c.cmd)}
                  >
                    <span className={styles.slashItemIcon}><c.icon size={13} aria-hidden /></span>
                    <span className={styles.slashItemBody}>
                      <span className={styles.slashItemCmd}>{c.cmd}</span>
                      <span className={styles.slashItemName}>{t(c.nameKey)}</span>
                      <span className={styles.slashItemDesc}>{t(c.descKey)}</span>
                    </span>
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                className={styles.composerTextarea}
                placeholder={t("pages.aiAssistant.composerPlaceholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={loading || activeFailed}
                rows={1}
              />
              <div className={styles.composerBar}>
                <button type="button" className={styles.composerActionBtn} title={t("pages.aiAssistant.attach")} aria-label={t("pages.aiAssistant.attachFile")}>
                  <Paperclip size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${styles.composerActionBtn} ${recording ? styles.recording : ""}`}
                  onClick={toggleVoice}
                  title={recording ? t("pages.aiAssistant.stopRecording") : t("pages.aiAssistant.voice")}
                  aria-label={recording ? t("pages.aiAssistant.stopVoiceRecording") : t("pages.aiAssistant.recordVoiceMessage")}
                  aria-pressed={recording}
                >
                  <Mic size={15} aria-hidden />
                </button>
                {input && (
                  <span className={styles.contextPill}>
                    {input.slice(0, 24)}{input.length > 24 ? "…" : ""}
                    <button
                      type="button"
                      className={styles.contextPillRemove}
                      onClick={() => setInput("")}
                      aria-label={t("pages.aiAssistant.clearText")}
                    >
                      <X size={10} aria-hidden />
                    </button>
                  </span>
                )}
                <span className={styles.composerBarSpacer} />
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading || activeFailed}
                  title={t("common.send")}
                  aria-label={t("pages.aiAssistant.sendMessage")}
                >
                  <Send size={14} aria-hidden />
                </button>
              </div>
            </div>

            <div className={styles.composerHint}>
              <kbd>↵</kbd> {t("pages.aiAssistant.hintSend")} · <kbd>⇧↵</kbd> {t("pages.aiAssistant.hintNewLine")} · <kbd>/</kbd> {t("pages.aiAssistant.hintCommands")} · <kbd>⌘K</kbd> {t("pages.aiAssistant.hintNewChat")}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
