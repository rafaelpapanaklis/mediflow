// Núcleo del tracker (cliente). Framework-agnóstico: lo maneja el componente
// <AnalyticsTracker/>. Captura pageviews, clicks (heatmap), scroll depth,
// rage clicks y tiempo en página. Envía en batches a /api/track.
//
// PRIVACIDAD (crítico, app médica / NOM-024):
//  - NUNCA captura valores ni texto de inputs/textarea/select/password.
//  - El TEXTO de un click sólo se captura en superficies PÚBLICAS (landing) y
//    sólo cuando el click cayó en un elemento accionable real
//    (a/button/[role=button]/[data-track]); jamás en /dashboard ni /paciente,
//    ni sobre elementos genéricos → evita persistir PII/PHI (nombres, teléfonos,
//    diagnósticos) en analytics_events.text.
//  - La identidad (clínica/usuario) la resuelve el SERVIDOR desde cookies.

import {
  TRACK_ENDPOINT,
  VISITOR_KEY,
  SESSION_KEY,
  SESSION_TS_KEY,
  SESSION_TIMEOUT_MS,
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  surfaceFromPath,
} from "./constants";
import type { TrackEvent, TrackPayload } from "./types";

let started = false;
let vid = "";
let sid = "";
let queue: TrackEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let attribution: Partial<TrackPayload> = {};

let curPath = "";
let curEnteredAt = 0;
let pageOpen = false; // hay un segmento de tiempo-en-página activo
let maxScrollPct = 0;
let scrollDone: Record<number, boolean> = {};

let clickTimes: number[] = [];
let lastCx = 0;
let lastCy = 0;
let lastAuth: string | null = null;

let cleanups: Array<() => void> = [];

function now(): number {
  return Date.now();
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `${now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function ensureVisitor(): string {
  const ls = local();
  if (!ls) return vid || uuid();
  let v = ls.getItem(VISITOR_KEY);
  if (!v) {
    v = uuid();
    try {
      ls.setItem(VISITOR_KEY, v);
    } catch {
      /* ignore */
    }
  }
  return v;
}

function ensureSession(): string {
  const ls = local();
  const t = now();
  if (!ls) return sid || uuid();
  const prev = ls.getItem(SESSION_KEY) || "";
  const prevTs = parseInt(ls.getItem(SESSION_TS_KEY) || "0", 10) || 0;
  let s = prev;
  if (!s || !prevTs || t - prevTs > SESSION_TIMEOUT_MS) s = uuid();
  try {
    ls.setItem(SESSION_KEY, s);
    ls.setItem(SESSION_TS_KEY, String(t));
  } catch {
    /* ignore */
  }
  return s;
}

/** Nueva sesión inmediata (login/logout en equipo compartido → no mezclar identidad). */
function rotateSession(): void {
  const ls = local();
  sid = uuid();
  if (ls) {
    try {
      ls.setItem(SESSION_KEY, sid);
      ls.setItem(SESSION_TS_KEY, String(now()));
    } catch {
      /* ignore */
    }
  }
}

function touch(): void {
  const ls = local();
  if (ls) {
    try {
      ls.setItem(SESSION_TS_KEY, String(now()));
    } catch {
      /* ignore */
    }
  }
}

/** Señal gruesa de sesión iniciada (cookie Supabase sb-*-auth-token, legible por JS aquí). */
function authState(): string {
  try {
    return /sb-[^=;]*-auth-token/.test(document.cookie || "") ? "auth" : "anon";
  } catch {
    return "anon";
  }
}

function parseAttribution(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    attribution = {
      referrer: document.referrer || undefined,
      utmSource: p.get("utm_source") || undefined,
      utmMedium: p.get("utm_medium") || undefined,
      utmCampaign: p.get("utm_campaign") || undefined,
      utmTerm: p.get("utm_term") || undefined,
      utmContent: p.get("utm_content") || undefined,
      gclid: p.get("gclid") || undefined,
    };
  } catch {
    attribution = {};
  }
}

function enqueue(ev: TrackEvent): void {
  if (!ev.path) return; // nunca encolar eventos sin ruta (rechazarían el batch entero en el server)
  queue.push(ev);
  touch();
  if (queue.length >= MAX_BATCH) flush(false);
}

function buildPayload(): TrackPayload | null {
  if (queue.length === 0) return null;
  const events = queue.splice(0, queue.length);
  return {
    sid,
    vid,
    events,
    screenW: window.screen ? window.screen.width : undefined,
    screenH: window.screen ? window.screen.height : undefined,
    language: navigator.language,
    timezone: safeTz(),
    ...attribution,
  };
}

function safeTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function fetchSend(body: string): void {
  try {
    fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

function flush(useBeacon: boolean): void {
  const payload = buildPayload();
  if (!payload) return;
  let body = "";
  try {
    body = JSON.stringify(payload);
  } catch {
    return;
  }
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(TRACK_ENDPOINT, blob)) return;
    } catch {
      /* fallthrough */
    }
  }
  fetchSend(body);
}

function safeTitle(): string | undefined {
  try {
    return document.title ? document.title.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

// Selector estructural (no-PII: tag + id + clases). Se captura en toda superficie.
// Texto: SOLO en público y SOLO si el click cayó en un accionable real.
function describeTarget(el: Element, publicSurface: boolean): { selector: string; text?: string } {
  const matched =
    el.closest && (el.closest("a,button,[role=button],[data-track]") as Element | null);
  const actionable = matched || el;
  const tag = actionable.tagName ? actionable.tagName.toLowerCase() : "el";
  const he = actionable as HTMLElement;
  const id = he.id ? `#${he.id}` : "";
  const cls =
    typeof he.className === "string" && he.className.trim()
      ? "." + he.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
  const selector = `${tag}${id}${cls}`.slice(0, 120);

  let text: string | undefined;
  if (publicSurface && matched) {
    const label =
      (he.getAttribute && (he.getAttribute("data-track-label") || he.getAttribute("aria-label"))) || "";
    const raw = label || he.innerText || matched.textContent || "";
    const clean = raw.replace(/\s+/g, " ").trim();
    if (clean) text = clean.slice(0, 60);
  }
  return { selector, text };
}

function onClick(e: MouseEvent): void {
  try {
    const target = e.target as Element | null;
    if (!target) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const docH = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0,
      1,
    );
    const x = Math.min(1, Math.max(0, e.clientX / vw));
    const y = Math.round(e.pageY || e.clientY + (window.scrollY || 0));
    const publicSurface = surfaceFromPath(curPath) === "public";
    const { selector, text } = describeTarget(target, publicSurface);
    enqueue({ type: "click", path: curPath, t: now(), x: round3(x), y, vw, vh, docH, selector, text });
    detectRage(e.clientX, e.clientY);
  } catch {
    /* ignore */
  }
}

function detectRage(cx: number, cy: number): void {
  const t = now();
  clickTimes = clickTimes.filter((ts) => t - ts < 800);
  clickTimes.push(t);
  const near = Math.abs(cx - lastCx) < 32 && Math.abs(cy - lastCy) < 32;
  lastCx = cx;
  lastCy = cy;
  if (clickTimes.length >= 3 && near) {
    clickTimes = [];
    enqueue({ type: "rage_click", path: curPath, t });
  }
}

function onScroll(): void {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    try {
      const docH = Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, 1);
      const vh = window.innerHeight || 0;
      const pct = Math.min(100, Math.round(((window.scrollY || 0) + vh) / docH * 100));
      if (pct > maxScrollPct) maxScrollPct = pct;
      [25, 50, 75, 100].forEach((m) => {
        if (pct >= m && !scrollDone[m]) {
          scrollDone[m] = true;
          enqueue({ type: "scroll", path: curPath, t: now(), scrollPct: m });
        }
      });
    } catch {
      /* ignore */
    }
  }, 250);
}

function clearScrollTimer(): void {
  if (scrollTimer) {
    clearTimeout(scrollTimer);
    scrollTimer = null;
  }
}

function emitPageEnter(path: string): void {
  clearScrollTimer();
  curPath = path;
  curEnteredAt = now();
  pageOpen = true;
  maxScrollPct = 0;
  scrollDone = {};
  enqueue({
    type: "pageview",
    path,
    t: now(),
    title: safeTitle(),
    referrer: document.referrer || undefined,
  });
}

function emitPageLeave(): void {
  if (!pageOpen || !curPath) return;
  pageOpen = false;
  const dur = now() - curEnteredAt;
  if (dur > 0) {
    enqueue({ type: "custom", name: "page_time", path: curPath, t: now(), durationMs: dur, scrollPct: maxScrollPct });
  }
}

export function pageview(path: string): void {
  if (!started) return;
  sid = ensureSession();

  // Rotación por cambio de identidad (login/logout, típico en equipo compartido de clínica).
  const a = authState();
  if (lastAuth !== null && a !== lastAuth) {
    if (curPath) emitPageLeave();
    flush(false); // envía lo pendiente con el sid anterior
    rotateSession();
    curPath = "";
  }
  lastAuth = a;

  if (curPath === path) return;
  if (curPath) emitPageLeave();
  emitPageEnter(path);
  flush(false);
}

export function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  vid = ensureVisitor();
  sid = ensureSession();
  lastAuth = authState();
  parseAttribution();

  const clickL = (e: MouseEvent) => onClick(e);
  document.addEventListener("click", clickL, true);

  const scrollL = () => onScroll();
  window.addEventListener("scroll", scrollL, { passive: true });

  // visibilitychange→hidden es la señal de salida MÁS fiable en móvil (pagehide
  // a veces no dispara). Emitimos el cierre de página aquí; pageOpen evita el
  // doble conteo si luego llega pagehide. Al volver a 'visible' se re-arma.
  const visL = () => {
    if (document.visibilityState === "hidden") {
      emitPageLeave();
      flush(true);
    } else if (document.visibilityState === "visible" && curPath && !pageOpen) {
      curEnteredAt = now();
      pageOpen = true;
    }
  };
  document.addEventListener("visibilitychange", visL);

  const hideL = () => {
    emitPageLeave();
    flush(true);
  };
  window.addEventListener("pagehide", hideL);

  flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);

  cleanups = [
    () => document.removeEventListener("click", clickL, true),
    () => window.removeEventListener("scroll", scrollL),
    () => document.removeEventListener("visibilitychange", visL),
    () => window.removeEventListener("pagehide", hideL),
    () => {
      if (flushTimer) clearInterval(flushTimer);
      flushTimer = null;
    },
    clearScrollTimer,
  ];
}

export function stop(): void {
  if (!started) return;
  emitPageLeave();
  flush(true);
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  cleanups = [];
  started = false;
  curPath = "";
  pageOpen = false;
}
