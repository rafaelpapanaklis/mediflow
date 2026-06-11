"use client";

// ─────────────────────────────────────────────────────────────────────────────
// A9 — HUD / overlay 2D (React) sobre el canvas: estados de carga, error, vacío,
// leyenda, hint de controles, contadores y botones. NO toca three.
//
// TODO(A9): implementar Clinic3DHud según este brief. Todo en overlay absoluto
// (pointer-events-none en los contenedores informativos; pointer-events-auto en
// los botones). Estética dark tipo videojuego casual, español neutro con tú,
// responsive (clamp de tamaños, safe-area en móvil). El joystick lo dibuja
// touch-controls, NO el HUD.
//
// Fases (props.phase):
//  - "loading": pantalla completa #0b0d11 con spinner + "Construyendo tu
//    clínica…" + barra de progreso (props.loadProgress 0..1).
//  - "error": pantalla amable: título props.errorTitle ?? "No pudimos cargar la
//    vista 3D", mensaje props.errorMessage, botón "Reintentar" (onRetry) y link
//    "Volver al editor" → /dashboard/clinic-layout. NUNCA el Application error
//    de Next (el orquestador captura y pasa phase="error").
//  - "empty": "Aún no has diseñado tu clínica" + "Crea tu plano en Mi Clínica
//    Visual y vuelve para recorrerlo en 3D." + botón "Ir al editor" →
//    /dashboard/clinic-layout.
//  - "ready": overlay de juego:
//     · Top-left: nombre de la clínica (props.clinicName) + chip categoría.
//     · Top-right: botón "Volver al editor" (Link), botón fullscreen
//       (onToggleFullscreen, icono Maximize/Minimize según props.isFullscreen).
//     · Bottom-left: leyenda — ● verde Libre / ● ámbar Próxima / ● rojo Ocupado.
//     · Bottom-right: contador "Ocupados {occupied} · Libres {free}" (de total).
//     · Centro (solo desktop y si !isLocked): tarjeta "Haz clic para entrar" +
//       hint WASD/ratón/ESC; al hacer clic llama onRequestLock. Si isLocked,
//       muestra un hint sutil que se desvanece a los ~5s (maneja un timer
//       interno o recibe props.showHint).
//     · Móvil (props.isTouch): hint breve "Joystick para moverte · arrastra para
//       mirar" que se auto-oculta; sin tarjeta de clic.
//
// Mantén el markup ligero; usa lucide-react (ya en deps) para iconos
// (Maximize2, Minimize2, ArrowLeft, MousePointer2). Sin CSS-in-JS pesado:
// Tailwind o estilos inline. El contenedor raíz debe ser pointer-events-none
// salvo los controles.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { Maximize2, Minimize2, ArrowLeft, MousePointer2, Map as MapIcon } from "lucide-react";
import { STATUS_RING_COLOR, type MinimapFrame, type WorldModel } from "./world-types";
import { drawMinimap } from "./minimap";

export type Hud3DPhase = "loading" | "ready" | "empty" | "error";

export interface Clinic3DHudProps {
  phase: Hud3DPhase;
  clinicName: string;
  category: string;
  loadProgress: number;        // 0..1
  errorTitle?: string;
  errorMessage?: string;
  occupied: number;
  free: number;
  total: number;
  isTouch: boolean;
  isLocked: boolean;
  isFullscreen: boolean;
  onRequestLock: () => void;
  onToggleFullscreen: () => void;
  onRetry: () => void;
  // ── V2 (los implementa A7: crosshair + minimapa + contador de usuarios) ────
  /** Mundo (para el plano estático del minimapa). */
  world: WorldModel;
  /** Personas conectadas (incluyéndote): "👥 N en la clínica". */
  userCount: number;
  /** true si el canal Realtime quedó activo; false → aviso discreto. */
  multiplayerEnabled: boolean;
  /** Tooltip de interacción ("Abrir expediente de {nombre}") o null. */
  interactLabel?: string | null;
  /** true cuando el crosshair apunta a un avatar interactivo. */
  targeting?: boolean;
  /** Minimapa visible (toggle con M o botón). */
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  /** Frame del minimapa que el orquestador actualiza por frame (rAF del HUD). */
  minimapFrameRef: MutableRefObject<MinimapFrame>;
}

const EDITOR_HREF = "/dashboard/clinic-layout";

// Etiqueta legible de la categoría (el chip muestra texto, no la key cruda).
const CATEGORY_LABEL: Record<string, string> = {
  DENTAL: "Dental",
  AESTHETIC_MEDICINE: "Medicina estética",
  BEAUTY_CENTER: "Centro de belleza",
  SPA: "Spa",
  HAIR_SALON: "Salón de belleza",
  PSYCHOLOGY: "Psicología",
  PHYSIOTHERAPY: "Fisioterapia",
  NUTRITION: "Nutrición",
};

function categoryLabel(category: string): string {
  if (!category) return "Clínica";
  return CATEGORY_LABEL[category] ?? category;
}

// ─── Estados a pantalla completa ─────────────────────────────────────────────

function LoadingScreen({ loadProgress }: { loadProgress: number }) {
  const pct = Math.max(0, Math.min(1, loadProgress || 0));
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0b0d11] px-6 text-center text-white/80">
      <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
      <p className="mt-5 text-sm font-medium tracking-wide text-white/90">Construyendo tu clínica…</p>
      <div className="mt-4 h-1.5 w-[min(280px,72vw)] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-violet-500 transition-[width] duration-200 ease-out"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] tabular-nums text-white/40">{Math.round(pct * 100)}%</p>
    </div>
  );
}

function EmptyScreen() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0d11] px-6 text-center text-white">
      <div className="max-w-sm">
        <p className="text-lg font-semibold">Aún no has diseñado tu clínica</p>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          Crea tu plano en Mi Clínica Visual y vuelve para recorrerlo en 3D.
        </p>
        <Link
          href={EDITOR_HREF}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          <ArrowLeft className="h-4 w-4" />
          Ir al editor
        </Link>
      </div>
    </div>
  );
}

function ErrorScreen({
  errorTitle,
  errorMessage,
  onRetry,
}: Pick<Clinic3DHudProps, "errorTitle" | "errorMessage" | "onRetry">) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0d11] px-6 text-center text-white">
      <div className="max-w-sm">
        <p className="text-lg font-semibold">{errorTitle ?? "No pudimos cargar la vista 3D"}</p>
        {errorMessage ? (
          <p className="mt-2 text-sm leading-relaxed text-white/60">{errorMessage}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Reintentar
          </button>
          <Link
            href={EDITOR_HREF}
            className="rounded-lg px-4 py-2 text-sm font-medium text-violet-300 transition-colors hover:text-violet-200"
          >
            Volver al editor
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Overlay de juego (ready) ────────────────────────────────────────────────

const panelBase =
  "pointer-events-none absolute rounded-xl border border-white/10 bg-black/40 backdrop-blur-md text-white shadow-lg";

// ─── Crosshair central (mira) ────────────────────────────────────────────────
// Punto + anillo. Si targeting, el anillo crece y toma el acento, y aparece el
// tooltip de interacción ("Abrir expediente de {nombre}") justo bajo el centro.
// En desktop con control (isLocked) la mira es nítida; sin control queda muy
// discreta. En móvil se mantiene sutil (no estorba al joystick).
function Crosshair({
  targeting,
  interactLabel,
  isLocked,
  isTouch,
}: {
  targeting: boolean;
  interactLabel?: string | null;
  isLocked: boolean;
  isTouch: boolean;
}) {
  // Opacidad base: con control se ve; en reposo (sin lock, no móvil) muy tenue.
  const baseOpacity = targeting ? 1 : isLocked || isTouch ? 0.75 : 0.35;
  const accent = "#a78bfa"; // violet-400
  const ringColor = targeting ? accent : "rgba(255,255,255,0.85)";
  const ringSize = targeting ? 26 : 18;
  return (
    <div className="pointer-events-none absolute inset-0 z-[21] flex items-center justify-center">
      <div className="relative flex items-center justify-center">
        {/* Anillo */}
        <span
          className="rounded-full transition-all duration-150 ease-out"
          style={{
            width: ringSize,
            height: ringSize,
            border: `2px solid ${ringColor}`,
            opacity: baseOpacity,
            boxShadow: targeting ? `0 0 10px ${accent}` : "0 0 2px rgba(0,0,0,0.6)",
          }}
        />
        {/* Punto central */}
        <span
          className="absolute rounded-full transition-all duration-150"
          style={{
            width: targeting ? 4 : 3,
            height: targeting ? 4 : 3,
            backgroundColor: targeting ? accent : "rgba(255,255,255,0.9)",
            opacity: baseOpacity,
          }}
        />
        {/* Tooltip de interacción bajo el centro */}
        {targeting && interactLabel ? (
          <span
            className="absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap rounded-md border border-violet-400/30 bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md"
            style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}
          >
            {interactLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Minimapa (canvas 2D con rAF propio) ─────────────────────────────────────
const MINIMAP_SIZE = 160; // px CSS (responsive: se reduce/oculta vía clases)

function Minimap({
  world,
  frameRef,
}: {
  world: WorldModel;
  frameRef: MutableRefObject<MinimapFrame>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
    const size = MINIMAP_SIZE;
    // Buffer físico (DPR) vs tamaño CSS; escalamos el contexto una vez.
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    const loop = () => {
      const frame = frameRef.current;
      if (frame) {
        try {
          drawMinimap(ctx, world, frame, size);
        } catch {
          /* nunca tumbar el rAF por un frame raro */
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world, frameRef]);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
      aria-hidden="true"
      className="pointer-events-none block rounded-xl shadow-lg"
      style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
    />
  );
}

function ReadyOverlay(props: Clinic3DHudProps) {
  const {
    clinicName,
    category,
    occupied,
    free,
    total,
    isTouch,
    isLocked,
    isFullscreen,
    world,
    userCount,
    multiplayerEnabled,
    interactLabel,
    targeting,
    minimapVisible,
    onToggleMinimap,
    minimapFrameRef,
  } = props;

  // Hint sutil que se desvanece ~5s una vez que el usuario tomó el control
  // (pointer lock en desktop) o al entrar en móvil. Cada vez que (re)entra al
  // estado "con control", reaparece y vuelve a contar.
  const [hintVisible, setHintVisible] = useState(false);

  useEffect(() => {
    const active = isTouch || isLocked;
    if (!active) {
      setHintVisible(false);
      return;
    }
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 5000);
    return () => clearTimeout(t);
  }, [isTouch, isLocked]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none text-white">
      {/* Top-left: nombre de la clínica + chip categoría + contador de usuarios */}
      <div className="pointer-events-none absolute left-0 top-0 m-[max(env(safe-area-inset-left),0.75rem)] mt-[max(env(safe-area-inset-top),0.75rem)] flex max-w-[60vw] flex-col items-start gap-1.5">
        <div className={`${panelBase} static flex items-center gap-2 px-3 py-2`}>
          <span className="truncate text-[clamp(13px,1.6vw,16px)] font-semibold leading-tight">
            {clinicName || "Mi clínica"}
          </span>
          <span className="shrink-0 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200 ring-1 ring-inset ring-violet-400/30">
            {categoryLabel(category)}
          </span>
        </div>
        {/* Contador de usuarios conectados (o aviso discreto si no hay multijugador) */}
        {multiplayerEnabled ? (
          <div className={`${panelBase} static flex items-center gap-1.5 px-2.5 py-1 text-[clamp(11px,1.4vw,13px)] tabular-nums`}>
            <span aria-hidden="true">👥</span>
            <span className="font-medium text-white/90">{Math.max(0, userCount || 0)}</span>
            <span className="text-white/60">en la clínica</span>
          </div>
        ) : (
          <span className="pointer-events-none pl-1 text-[10px] text-white/35">
            multijugador no disponible
          </span>
        )}
      </div>

      {/* Top-right: volver al editor + minimapa (toggle) + fullscreen, y debajo el minimapa */}
      <div className="pointer-events-none absolute right-0 top-0 m-[max(env(safe-area-inset-right),0.75rem)] mt-[max(env(safe-area-inset-top),0.75rem)] flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <Link
            href={EDITOR_HREF}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
            title="Volver al editor"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Volver al editor</span>
          </Link>
          <button
            type="button"
            onClick={onToggleMinimap}
            aria-label={minimapVisible ? "Ocultar minimapa (M)" : "Mostrar minimapa (M)"}
            title={minimapVisible ? "Ocultar minimapa (M)" : "Mostrar minimapa (M)"}
            className={`pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-md transition-colors ${
              minimapVisible
                ? "border-violet-400/40 bg-violet-500/25 text-violet-100 hover:bg-violet-500/35"
                : "border-white/10 bg-black/40 text-white/90 hover:bg-black/60 hover:text-white"
            }`}
          >
            <MapIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={props.onToggleFullscreen}
            aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/90 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        {/* Minimapa: debajo de los botones. Oculto en pantallas muy chicas (estorba). */}
        {minimapVisible ? (
          <div className="hidden sm:block">
            <Minimap world={world} frameRef={minimapFrameRef} />
          </div>
        ) : null}
      </div>

      {/* Bottom-left: leyenda de estados */}
      <div
        className={`${panelBase} bottom-0 left-0 mb-[max(env(safe-area-inset-bottom),0.75rem)] ml-[max(env(safe-area-inset-left),0.75rem)] flex flex-col gap-1 px-3 py-2 text-[11px] text-white/80`}
      >
        <LegendDot color={STATUS_RING_COLOR.libre} label="Libre" />
        <LegendDot color={STATUS_RING_COLOR.proximo} label="Próxima" />
        <LegendDot color={STATUS_RING_COLOR.ocupado} label="Ocupado" />
      </div>

      {/* Bottom-right: contadores */}
      <div
        className={`${panelBase} bottom-0 right-0 mb-[max(env(safe-area-inset-bottom),0.75rem)] mr-[max(env(safe-area-inset-right),0.75rem)] px-3 py-2 text-[clamp(11px,1.4vw,13px)] tabular-nums`}
      >
        <span className="font-medium text-white/90">Ocupados {occupied}</span>
        <span className="mx-1.5 text-white/30">·</span>
        <span className="font-medium text-white/90">Libres {free}</span>
        {total ? <span className="ml-1.5 text-white/40">/ {total}</span> : null}
      </div>

      {/* Centro desktop sin control: tarjeta "Haz clic para entrar" */}
      {!isTouch && !isLocked ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <button
            type="button"
            onClick={props.onRequestLock}
            className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-8 py-6 text-center backdrop-blur-md transition-colors hover:bg-black/70"
          >
            <MousePointer2 className="h-7 w-7 text-violet-300" />
            <span className="text-base font-semibold text-white">Haz clic para entrar</span>
            <span className="text-xs leading-relaxed text-white/60">
              Muévete con <kbd className={kbd}>W</kbd> <kbd className={kbd}>A</kbd> <kbd className={kbd}>S</kbd>{" "}
              <kbd className={kbd}>D</kbd> · mira con el ratón · <kbd className={kbd}>M</kbd> minimapa · sal con{" "}
              <kbd className={kbd}>ESC</kbd>
            </span>
          </button>
        </div>
      ) : null}

      {/* Crosshair central: visible con control (lock desktop o móvil); crece y
          colorea + tooltip cuando apunta a un avatar interactivo. */}
      {(isLocked || isTouch) ? (
        <Crosshair
          targeting={!!targeting}
          interactLabel={interactLabel}
          isLocked={isLocked}
          isTouch={isTouch}
        />
      ) : null}

      {/* Hint sutil con control activo (desktop bloqueado o móvil) — fade ~5s */}
      {(isLocked || isTouch) ? (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),4.5rem)] flex justify-center px-6 transition-opacity duration-700 ${
            hintVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="rounded-full border border-white/10 bg-black/45 px-3.5 py-1.5 text-center text-[11px] text-white/70 backdrop-blur-md">
            {isTouch
              ? "Joystick para moverte · arrastra para mirar · M minimapa"
              : "Muévete con WASD · mira con el ratón · M minimapa · ESC para salir"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

const kbd =
  "inline-flex min-w-[1.4em] items-center justify-center rounded border border-white/15 bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/80";

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span>{label}</span>
    </span>
  );
}

export function Clinic3DHud(props: Clinic3DHudProps) {
  switch (props.phase) {
    case "loading":
      return <LoadingScreen loadProgress={props.loadProgress} />;
    case "empty":
      return <EmptyScreen />;
    case "error":
      return (
        <ErrorScreen
          errorTitle={props.errorTitle}
          errorMessage={props.errorMessage}
          onRetry={props.onRetry}
        />
      );
    case "ready":
      return <ReadyOverlay {...props} />;
    default:
      return null;
  }
}
