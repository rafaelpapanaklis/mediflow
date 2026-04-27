"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  AlertCircle,
  Building2,
  Lock,
  Plus,
  Minus,
  Crosshair,
  Sun,
  Moon,
} from "lucide-react";
import { toScreen } from "@/lib/floor-plan/iso";
import { getCatalogForClinic } from "@/lib/floor-plan/elements";
import type {
  LayoutElement,
  LiveAppointment,
} from "@/lib/floor-plan/elements";
import { fmtHM, fmtHMS } from "@/lib/floor-plan/live-mode";
import {
  LiveOverlay,
  LiveTooltip,
  LiveStatusPanel,
  LiveTimeline,
  type HoverData,
} from "../../dashboard/clinic-layout/components/live-mode";
import { WaitingRoom, type WaitingRoomEntry } from "../../dashboard/clinic-layout/components/waiting-room";
import liveStyles from "./live-public.module.css";

interface Chair {
  id: string;
  name: string;
  color: string | null;
}

interface ApiResponse {
  clinic: { id: string; name: string; logoUrl?: string | null; city?: string | null; showPatientNames: boolean };
  layout: {
    elements: LayoutElement[];
    metadata: { zoom?: number; panOffset?: { x: number; y: number } } | null;
  };
  chairs: Chair[];
  appointments: Array<{
    id: string;
    resourceId: string;
    patient: string;
    patientFull?: string;
    treatment: string;
    doctor: string;
    start: string;
    end: string;
    status?: string;
  }>;
  waitingRoom?: WaitingRoomEntry[];
}

const ORIG_X = 680;
const ORIG_Y = 260;

export function LivePublicClient({
  slug,
  clinicName,
  logoUrl,
  city,
  showPatientNames,
}: {
  slug: string;
  clinicName: string;
  logoUrl: string | null;
  city: string | null;
  showPatientNames: boolean;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  /** Estructura del error: kind ("schema_not_migrated" | "table_missing"
   *  | "internal_error" | "timeout" | "network" | "parse"). hint para
   *  mostrar mensaje accionable al admin de la clínica. */
  const [error, setError] = useState<{ kind: string; hint?: string } | null>(null);
  /** Cuando el endpoint responde 401 ("locked"), mostramos prompt inline
   *  y paramos polling hasta que el usuario desbloquee. */
  const [locked, setLocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewTime, setViewTime] = useState<Date>(() => new Date());
  const [hover, setHover] = useState<HoverData | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Navegación del canvas: zoom + pan ──
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 4;
  const STORAGE_KEY = `mf:live-view:${slug}`;
  const THEME_STORAGE_KEY = `live-theme-${slug}`;
  // Tema light/dark de la vista En Vivo. Se aplica como clase `dark`
  // sobre <html>, así reusamos los selectores `:global(.dark)` que
  // ya tiene el resto del proyecto. Se persiste por slug — cada
  // pantalla puede tener su propio modo (TV de sala oscura vs.
  // recepción luminosa).
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // Hidratar zoom/pan desde localStorage al montar (por slug).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.zoom === "number" && parsed.zoom >= ZOOM_MIN && parsed.zoom <= ZOOM_MAX) {
        setZoom(parsed.zoom);
      }
      if (parsed.pan && typeof parsed.pan.x === "number" && typeof parsed.pan.y === "number") {
        setPan(parsed.pan);
      }
    } catch {/* localStorage bloqueado o JSON inválido — defaults */}
  }, [STORAGE_KEY]);

  // Hidratar tema desde localStorage al montar y aplicarlo sobre <html>.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      const initial = stored === "dark" ? "dark" : "light";
      setTheme(initial);
      document.documentElement.classList.toggle("dark", initial === "dark");
    } catch {/* localStorage bloqueado — light por default */}
    // Limpieza: al desmontar /live (ej. usuario navega), removemos `dark`
    // para no contaminar otras rutas en el mismo tab.
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, [THEME_STORAGE_KEY]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {/* quota / SecurityError — ignore */}
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  }, [THEME_STORAGE_KEY]);

  // Persistir zoom/pan con debounce 300ms.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom, pan }));
      } catch {/* quota / SecurityError — ignore */}
    }, 300);
    return () => clearTimeout(id);
  }, [zoom, pan, STORAGE_KEY]);

  const clampZoom = useCallback((z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)), []);

  const fitToScreen = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * 1.15)), [clampZoom]);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / 1.15)), [clampZoom]);

  const catalog = getCatalogForClinic("DENTAL");

  // Polling cada 30s con timeout de 10s por request. Si `locked=true`
  // NO se monta el polling — el cliente espera a que el usuario
  // ingrese el password.
  useEffect(() => {
    if (locked) return;
    let cancelled = false;
    const fetchAll = async () => {
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 10_000);
      try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/live/${slug}?date=${dateStr}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          if (res.status === 401) {
            // Cualquier 401 = sesión bloqueada. Mostramos prompt inline
            // (sin reload) y paramos el polling hasta que desbloquee.
            if (!cancelled) {
              setLocked(true);
              setError(null);
            }
            return;
          }
          // Intentamos parsear el body para mostrar hint del server.
          let kind = "internal_error";
          let hint: string | undefined;
          try {
            const body = await res.json();
            if (body?.error) kind = String(body.error);
            if (body?.hint) hint = String(body.hint);
          } catch {/* body no era JSON */}
          if (!cancelled) setError({ kind, hint });
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        setError({
          kind: isAbort ? "timeout" : "network",
          hint: isAbort
            ? "El servidor tardó más de 10 segundos en responder."
            : "No se pudo contactar el servidor. Verifica tu conexión.",
        });
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, locked, reloadKey]);

  /** Llamado cuando el prompt de unlock recibe OK del server. Reanuda
   *  el polling y limpia error/locked. reloadKey fuerza re-mount del
   *  effect para que dispare un fetch inmediato. */
  const handleUnlockSuccess = useCallback(() => {
    setLocked(false);
    setError(null);
    setData(null); // muestra "Cargando…" mientras llega el primer fetch
    setReloadKey((k) => k + 1);
  }, []);

  // Reloj cada segundo
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-tick viewTime si cerca de now
  useEffect(() => {
    if (Math.abs(now.getTime() - viewTime.getTime()) < 90_000) {
      setViewTime(now);
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen API
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  // Wheel listener nativo (passive=false para poder preventDefault).
  // React onWheel es passive por default y no podemos bloquear el scroll
  // del page con preventDefault — por eso engancharlo a nivel native.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Zoom centrado en el punto del cursor: ajustamos pan para que la
      // posición bajo el cursor permanezca estable al hacer zoom.
      const rect = wrap.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZoom((prevZoom) => {
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * factor));
        if (nextZoom === prevZoom) return prevZoom;
        const ratio = nextZoom / prevZoom;
        setPan((p) => ({
          x: cx - (cx - p.x) * ratio,
          y: cy - (cy - p.y) * ratio,
        }));
        return nextZoom;
      });
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  // Pan: mousedown en el canvasWrap inicia drag. La barra espaciadora
  // permite pan temporal sin necesidad de tool específica (cursor "grab").
  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Solo botón izquierdo. Ignoramos clicks sobre los botones
      // flotantes (data-no-pan="true") y sobre las regiones AI que
      // ya tienen sus propios handlers.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-pan]")) return;
      panStartRef.current = {
        mx: e.clientX,
        my: e.clientY,
        px: pan.x,
        py: pan.y,
      };
      setIsPanning(true);
    },
    [pan.x, pan.y],
  );

  // Listeners window para que el pan continúe aunque el cursor salga
  // del canvasWrap o del fullscreen.
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      const ref = panStartRef.current;
      if (!ref) return;
      setPan({
        x: ref.px + (e.clientX - ref.mx),
        y: ref.py + (e.clientY - ref.my),
      });
    };
    const onUp = () => {
      panStartRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  // Atajos de teclado: +/- zoom · 0 fit · F fullscreen · Espacio cursor grab.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        fitToScreen();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === "Space") {
        if (!spaceHeld) setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [zoomIn, zoomOut, fitToScreen, toggleFullscreen, spaceHeld]);

  const canvasCursor = isPanning ? "grabbing" : spaceHeld ? "grab" : "default";

  const appointments: LiveAppointment[] = useMemo(() => {
    if (!data) return [];
    return data.appointments.map((a) => ({
      id: a.id,
      resourceId: a.resourceId,
      patient: a.patient,
      patientFull: a.patientFull,
      treatment: a.treatment,
      doctor: a.doctor,
      start: new Date(a.start),
      end: new Date(a.end),
      status: a.status as LiveAppointment["status"],
    }));
  }, [data]);

  // 401 = locked: prompt inline para ingresar password.
  if (locked) {
    return (
      <UnlockPrompt
        slug={slug}
        clinicName={clinicName}
        onSuccess={handleUnlockSuccess}
      />
    );
  }
  if (error) {
    return (
      <div className={liveStyles.errorWrap}>
        <div className={liveStyles.errorCard}>
          <AlertCircle size={32} aria-hidden style={{ color: "#EF4444" }} />
          <h1>{errorTitle(error.kind)}</h1>
          <p>{error.hint ?? errorDefaultHint(error.kind)}</p>
          {(error.kind === "schema_not_migrated" || error.kind === "table_missing") && (
            <pre className={liveStyles.errorCode}>
              ALTER TABLE &quot;clinics&quot;{"\n"}
              {"  "}ADD COLUMN IF NOT EXISTS &quot;liveModeSlug&quot; TEXT,{"\n"}
              {"  "}ADD COLUMN IF NOT EXISTS &quot;liveModePassword&quot; TEXT,{"\n"}
              {"  "}ADD COLUMN IF NOT EXISTS &quot;liveModeEnabled&quot; BOOLEAN DEFAULT false,{"\n"}
              {"  "}ADD COLUMN IF NOT EXISTS &quot;liveModeShowPatientNames&quot; BOOLEAN DEFAULT false;{"\n"}
              {"\n"}
              CREATE TABLE IF NOT EXISTS &quot;clinic_layouts&quot; (...);
            </pre>
          )}
          <button
            type="button"
            className={liveStyles.errorBtn}
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className={liveStyles.loadingWrap}>Cargando vista en vivo…</div>;
  }
  // Caso especial: clínica válida + endpoint OK pero sin layout/sillones.
  // Mostramos UI de "configura tu layout primero" en lugar de canvas vacío.
  if ((data.layout?.elements?.length ?? 0) === 0 && data.chairs.length === 0) {
    return (
      <div className={liveStyles.errorWrap}>
        <div className={liveStyles.errorCard}>
          <Building2 size={32} aria-hidden style={{ color: "#4A90E2" }} />
          <h1>{clinicName} no tiene layout configurado</h1>
          <p>
            El owner de la clínica debe entrar a <code>/dashboard/clinic-layout</code>{" "}
            y diseñar el plano (puede cargar el demo en 1 click). Mientras tanto, esta
            vista pública se mantendrá vacía.
          </p>
          <button
            type="button"
            className={liveStyles.errorBtn}
            onClick={() => window.location.reload()}
          >
            Refrescar
          </button>
        </div>
      </div>
    );
  }

  const elements = data.layout.elements;
  const ox = ORIG_X;
  const oy = ORIG_Y;

  return (
    <div ref={containerRef} className={liveStyles.live}>
      <header className={liveStyles.header}>
        <div className={liveStyles.headerLeft}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={clinicName}
              className={liveStyles.clinicLogo}
            />
          ) : (
            <div className={liveStyles.brandIcon}>
              {clinicName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase() ?? "")
                .join("")}
            </div>
          )}
          <div className={liveStyles.headerClinicInfo}>
            <div className={liveStyles.clinicName}>{clinicName}</div>
            <div className={liveStyles.clinicMeta}>
              <span className={liveStyles.liveBadge}>
                <span /> EN VIVO
              </span>
              {city && <span className={liveStyles.clinicCity}>· {city}</span>}
            </div>
          </div>
        </div>
        <div className={liveStyles.headerClockBlock}>
          <div className={liveStyles.headerClockBig}>{fmtHM(now)}</div>
          <div className={liveStyles.headerClockSec}>{fmtHMS(now).slice(-2)}</div>
        </div>
        <div className={liveStyles.headerRight}>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={liveStyles.fullscreenBtn}
            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullscreen ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>

      <div className={liveStyles.body}>
        <div
          className={liveStyles.canvasWrap}
          ref={canvasWrapRef}
          onMouseDown={onCanvasMouseDown}
          style={{ cursor: canvasCursor }}
        >
          <svg
            className={liveStyles.svgRoot}
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid meet"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.08s linear",
            }}
          >
            {/* Floor tiles */}
            <g>
              {Array.from({ length: 24 }).map((_, r) =>
                Array.from({ length: 32 }).map((__, c) => {
                  const A = toScreen(c, r, ox, oy);
                  const B = toScreen(c + 1, r, ox, oy);
                  const Cc = toScreen(c + 1, r + 1, ox, oy);
                  const D = toScreen(c, r + 1, ox, oy);
                  // Fill via CSS class para que el toggle dark mode pueda
                  // swap-ear los colores sin tocar JSX. Inline `fill` ganaba
                  // a la regla CSS y dejaba el grid blanco en dark.
                  const tileClass = (c + r) % 2 === 0 ? liveStyles.tileA : liveStyles.tileB;
                  return (
                    <polygon
                      key={`t-${c}-${r}`}
                      className={`${tileClass} ${liveStyles.tileStroke}`}
                      points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${Cc[0]},${Cc[1]} ${D[0]},${D[1]}`}
                      strokeWidth={0.5}
                    />
                  );
                }),
              )}
            </g>
            {/* Elementos */}
            <g>
              {elements
                .slice()
                .sort((a, b) => a.col + a.row - (b.col + b.row))
                .map((el) => {
                  const td = catalog.byKey.get(el.type);
                  if (!td) return null;
                  const [sx, sy] = toScreen(el.col, el.row, ox, oy);
                  return (
                    <g
                      key={el.id}
                      transform={el.rotation ? `rotate(${el.rotation} ${sx} ${sy})` : undefined}
                      dangerouslySetInnerHTML={{ __html: td.draw(sx, sy) }}
                    />
                  );
                })}
            </g>
            {/* Halos En Vivo */}
            <LiveOverlay
              elements={elements}
              ox={ox}
              oy={oy}
              viewTime={viewTime}
              appointments={appointments}
              showFullNames={showPatientNames}
              onHover={setHover}
            />
          </svg>

          {/* Controles flotantes — esquina inferior derecha del canvas. */}
          <div className={liveStyles.canvasControls} data-no-pan="true">
            <button
              type="button"
              className={liveStyles.canvasCtrlBtn}
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              title="Acercar (+)"
              aria-label="Acercar"
            >
              <Plus size={15} aria-hidden />
            </button>
            <span className={liveStyles.canvasCtrlZoom}>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className={liveStyles.canvasCtrlBtn}
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              title="Alejar (−)"
              aria-label="Alejar"
            >
              <Minus size={15} aria-hidden />
            </button>
            <span className={liveStyles.canvasCtrlDivider} aria-hidden />
            <button
              type="button"
              className={liveStyles.canvasCtrlBtn}
              onClick={fitToScreen}
              title="Ajustar a pantalla (0)"
              aria-label="Ajustar a pantalla"
            >
              <Crosshair size={15} aria-hidden />
            </button>
            <button
              type="button"
              className={liveStyles.canvasCtrlBtn}
              onClick={toggleTheme}
              title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-label="Cambiar tema"
            >
              {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </button>
            <button
              type="button"
              className={liveStyles.canvasCtrlBtn}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Salir de pantalla completa (F)" : "Pantalla completa (F)"}
              aria-label="Pantalla completa"
            >
              {isFullscreen ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
            </button>
          </div>
        </div>
        <aside className={liveStyles.panel}>
          <LiveStatusPanel
            elements={elements}
            chairs={data.chairs}
            viewTime={viewTime}
            appointments={appointments}
            showFullNames={showPatientNames}
          />
          <div style={{ marginTop: 14 }}>
            <WaitingRoom
              waiting={data.waitingRoom ?? []}
              appointments={appointments}
              chairs={data.chairs}
              enableSound={true}
            />
          </div>
        </aside>
      </div>

      <LiveTimeline
        elements={elements}
        chairs={data.chairs}
        viewTime={viewTime}
        appointments={appointments}
        onSeek={setViewTime}
        onResetNow={() => setViewTime(new Date())}
      />

      <footer className={liveStyles.footer}>
        <span>Powered by</span>
        <strong>MediFlow</strong>
      </footer>

      <LiveTooltip data={hover} />
    </div>
  );
}

/**
 * Prompt inline de desbloqueo. Se muestra cuando el endpoint devolvió
 * 401 ("locked"). Hace POST a /api/live/<slug>/unlock; si el server
 * responde OK, llama onSuccess para que el cliente reanude polling.
 * No recarga la página — el cookie se setea por la respuesta y el
 * próximo fetch del cliente lo envía.
 */
function UnlockPrompt({
  slug,
  clinicName,
  onSuccess,
}: {
  slug: string;
  clinicName: string;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password.trim() || submitting) return;
      setSubmitting(true);
      setErrMsg(null);
      try {
        const res = await fetch(`/api/live/${slug}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
          cache: "no-store",
        });
        if (res.status === 401) {
          setErrMsg("Contraseña incorrecta");
          return;
        }
        if (!res.ok) {
          setErrMsg("No se pudo desbloquear. Reintenta.");
          return;
        }
        // OK: el server seteó la cookie en la response; reanudamos
        // polling sin reload para mejor UX.
        onSuccess();
      } catch {
        setErrMsg("Error de red. Verifica tu conexión.");
      } finally {
        setSubmitting(false);
      }
    },
    [password, submitting, slug, onSuccess],
  );

  return (
    <div className={liveStyles.errorWrap}>
      <form onSubmit={submit} className={liveStyles.unlockCard}>
        <div className={liveStyles.unlockIcon}>
          <Lock size={28} aria-hidden />
        </div>
        <h1>Esta vista requiere contraseña</h1>
        <p>
          {clinicName} habilitó protección por contraseña. Ingrésala una vez y
          quedarás desbloqueado en este dispositivo por 12 horas.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errMsg) setErrMsg(null);
          }}
          placeholder="Contraseña"
          className={liveStyles.unlockInput}
          spellCheck={false}
          disabled={submitting}
        />
        {errMsg && <span className={liveStyles.unlockError}>{errMsg}</span>}
        <button
          type="submit"
          className={liveStyles.errorBtn}
          disabled={!password.trim() || submitting}
        >
          {submitting ? "Desbloqueando…" : "Desbloquear"}
        </button>
      </form>
    </div>
  );
}

function errorTitle(kind: string): string {
  switch (kind) {
    case "schema_not_migrated":
      return "Migración pendiente";
    case "table_missing":
      return "Tabla del schema faltante";
    case "internal_error":
      return "Error en el servidor";
    case "timeout":
      return "Tiempo agotado";
    case "network":
      return "Sin conexión";
    case "disabled":
      return "Vista pública deshabilitada";
    case "not_found":
      return "Esta vista no existe";
    default:
      return "Algo salió mal";
  }
}

function errorDefaultHint(kind: string): string {
  switch (kind) {
    case "internal_error":
      return "Reintenta en unos segundos. Si persiste, contacta al admin.";
    case "timeout":
      return "El servidor tardó más de 10 segundos. Reintenta.";
    case "network":
      return "No se pudo contactar el servidor. Verifica tu conexión.";
    default:
      return "Revisa la URL e inténtalo de nuevo.";
  }
}
