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
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import { AiQuotaBanner, type AiUsageSnapshot } from "@/components/dashboard/ai-quota-banner";
// El id sale del MISMO sitio que consume /api/ai: este badge decía
// "claude-sonnet-4-6" mientras el chat corría en Haiku.
import { AI_CHAT_MODEL } from "@/lib/ai/models";
import styles from "./ai-assistant.module.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  streaming?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
  group: "clinico" | "admin" | "pacientes";
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

const STORAGE_KEY = "mf:ai-conversations:v1";

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {/* silent */}
}

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

export default function AIAssistantPage() {
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [search, setSearch] = useState("");
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

  // Hydrate from localStorage
  useEffect(() => {
    const stored = loadConversations();
    setConversations(stored);
    if (stored.length > 0) setActiveId(stored[0].id);
  }, []);

  // Persist on changes
  useEffect(() => {
    if (conversations.length > 0) saveConversations(conversations);
  }, [conversations]);

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

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = activeConv?.messages ?? [];

  const filteredConvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [conversations, search]);

  const grouped = useMemo(() => {
    const groups: Record<Conversation["group"], Conversation[]> = {
      clinico: [], admin: [], pacientes: [],
    };
    for (const c of filteredConvs) groups[c.group].push(c);
    return groups;
  }, [filteredConvs]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = useCallback(() => {
    const newConv: Conversation = {
      id: makeId(),
      title: t("pages.aiAssistant.newConversation"),
      updatedAt: Date.now(),
      messages: [],
      group: "clinico",
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
    setInput("");
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [t]);

  const sendMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    setError(null);

    // Asegura que hay conversación activa
    let convId = activeId;
    if (!convId) {
      const newConv: Conversation = {
        id: makeId(),
        title: text.slice(0, 60),
        updatedAt: Date.now(),
        messages: [],
        group: "clinico",
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(newConv.id);
      convId = newConv.id;
    }

    const userMsg: Message = {
      id: makeId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const placeholderId = makeId();
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const isFirst = c.messages.length === 0;
        return {
          ...c,
          title: isFirst ? text.slice(0, 60) : c.title,
          updatedAt: Date.now(),
          messages: [
            ...c.messages,
            userMsg,
            { id: placeholderId, role: "assistant", content: "", timestamp: Date.now(), streaming: true },
          ],
        };
      }),
    );

    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages,
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

      const reply = String(data.reply ?? "");
      // Streaming visual: revela char por char
      let revealed = "";
      const chunkSize = Math.max(2, Math.ceil(reply.length / 80));
      for (let i = 0; i < reply.length; i += chunkSize) {
        revealed = reply.slice(0, i + chunkSize);
        await new Promise((r) => setTimeout(r, 18));
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === placeholderId ? { ...m, content: revealed, streaming: true } : m,
              ),
            };
          }),
        );
      }
      // Cierra streaming
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === placeholderId ? { ...m, content: reply, streaming: false } : m,
            ),
          };
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("pages.aiAssistant.errorQuery");
      setError(msg);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          return { ...c, messages: c.messages.filter((m) => m.id !== placeholderId) };
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [activeId, input, loading, messages, t, applyQuota]);

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
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.convItem} ${c.id === activeId ? styles.convItemActive : ""}`}
                    onClick={() => {
                      setActiveId(c.id);
                      // Cierra el drawer en mobile al elegir una conversación.
                      setMobileSidebarOpen(false);
                    }}
                  >
                    <span className={styles.convItemTitle}>{c.title}</span>
                    <span className={styles.convItemTime}>{formatRelative(c.updatedAt, t)}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {filteredConvs.length === 0 && (
            <div style={{ padding: "20px 12px" }}>
              {search ? (
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
            {messages.length === 0 ? (
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
                disabled={loading}
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
                  disabled={!input.trim() || loading}
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
