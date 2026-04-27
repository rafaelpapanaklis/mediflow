"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, AlertCircle, Building2, Lock } from "lucide-react";
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

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

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
        <div className={liveStyles.canvasWrap}>
          <svg
            className={liveStyles.svgRoot}
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Floor tiles */}
            <g>
              {Array.from({ length: 24 }).map((_, r) =>
                Array.from({ length: 32 }).map((__, c) => {
                  const A = toScreen(c, r, ox, oy);
                  const B = toScreen(c + 1, r, ox, oy);
                  const Cc = toScreen(c + 1, r + 1, ox, oy);
                  const D = toScreen(c, r + 1, ox, oy);
                  return (
                    <polygon
                      key={`t-${c}-${r}`}
                      points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${Cc[0]},${Cc[1]} ${D[0]},${D[1]}`}
                      fill={(c + r) % 2 === 0 ? "rgba(255,255,255,0.4)" : "rgba(232,244,250,0.3)"}
                      stroke="rgba(74,144,226,0.06)"
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
