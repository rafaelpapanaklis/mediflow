"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * OLA 12 · EL VISOR CBCT DEL INSTITUTO — CONTENEDOR PROPIO, PIEZAS DEL
 * DENTAL IMPORTADAS TAL CUAL.
 *
 * Qué se IMPORTA del dental sin tocarlo (src/components/patient-3d/**):
 *   · MprPane            → cada plano 2D (axial/coronal/sagital), con cruz
 *                          sincronizada en mm, medición, sonda y paneo
 *   · Dicom3DVolume      → el render volumétrico three.js
 *   · dicom-decode-core  → la decodificación DICOM (decodeSlice)
 *   · dicom-decode.worker→ la misma decodificación FUERA del hilo (códecs)
 *   · cbct-mpr-shared    → la matemática: orden por geometría real, series
 *                          mezcladas, escala física, ventanas, percentiles
 *   · GeometryWarning    → el juicio "¿este estudio es de fiar?" y su aviso
 *   · @/lib/dicom-cache  → cache IndexedDB del .zip y de los cortes
 * Todas son PURAS (cero fetch propio, cero prisma, cero sesión): la
 * corrección de geometría que el dental pague mañana llega aquí sola.
 *
 * Por qué NO se importa `DicomSetViewer` (el contenedor del dental): sus
 * acoples no son props, son fetch INTERNOS con rutas escritas dentro —
 * `POST /api/patients/{id}/dicom-set/{id}/lite` (genera el CBCT reducido
 * de móvil contra `Patient`/`PatientFile` del dental) y
 * `PATCH /api/patients/{id}/models-3d/{id}` (guarda notas ahí mismo). Un
 * adaptador no puede redirigir un fetch interno: con ids del instituto
 * esas rutas contestan 401/404, el móvil quedaría en error y el botón de
 * notas rompería siempre. Es el mismo criterio que el odontograma de la
 * Ola 3: las piezas puras se importan, el CONTENEDOR es del vertical.
 *
 * 🔴 LO QUE ESTE CONTENEDOR NO TIENE, y se dice en pantalla:
 *   · el binario "lite" de móvil (exige un generador de servidor que el
 *     instituto no tiene). En un teléfono, un estudio grande NO se intenta
 *     — descomprimir 300 MB recarga la pestaña en iOS sin avisar — y la
 *     pantalla ofrece la descarga y lo dice claro.
 *   · la vista panorámica (reslice curvo) y las notas dentro del visor:
 *     las notas del estudio viven en `EduStudy.notes` y se leen en la
 *     galería.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import JSZip from "jszip";
import {
  Box,
  Contrast as ContrastIcon,
  Crosshair,
  Layers,
  Loader2,
  Move,
  Pipette,
  RotateCcw,
  Ruler,
  Sun,
} from "lucide-react";
import { fetchWithCache, getDecodedSlices, putDecodedSlices } from "@/lib/dicom-cache";
import { decodeSlice, isDicomEntryName } from "@/components/patient-3d/dicom-decode-core";
import type { DecodeWorkerOut } from "@/components/patient-3d/dicom-decode.worker";
import type { VolSlice } from "@/components/patient-3d/Dicom3DVolume";
import MprPane from "@/components/patient-3d/MprPane";
import GeometryWarning, {
  geometryDoubtReason,
  GEOMETRY_DOUBT_DETAIL,
  type GeometryDoubtReason,
} from "@/components/patient-3d/GeometryWarning";
import {
  clampInt,
  computeVolStats,
  inferScale,
  isPhysicallyOrdered,
  keepDominantSeries,
  measureZSpacing,
  presetWindow,
  sameOrientation,
  sortSlicesForVolume,
  WINDOW_PRESETS,
  type Cross,
  type PlaneKey,
  type ScaleInfo,
  type Slice,
  type Tool,
  type WindowKey,
} from "@/components/patient-3d/cbct-mpr-shared";

// El volumen 3D trae su shader three.js: solo lo paga quien lo abre.
const Dicom3DVolume = dynamic(() => import("@/components/patient-3d/Dicom3DVolume"), {
  ssr: false,
  loading: () => (
    <div className="edu-visor3d-cargando" role="status">
      <Loader2 className="edu-girando" size={18} /> Preparando el volumen 3D…
    </div>
  ),
});

const PLANES: { key: PlaneKey; label: string }[] = [
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagital" },
];

const TOOLS: { key: Tool; label: string; icon: typeof Move }[] = [
  { key: "crosshair", label: "Cruz", icon: Crosshair },
  { key: "pan", label: "Mover", icon: Move },
  { key: "measure", label: "Medir", icon: Ruler },
  { key: "probe", label: "Sonda", icon: Pipette },
];

/**
 * En un teléfono NO se intenta un .zip por encima de esto. El estudio se
 * descomprime a rasters Int16 EN MEMORIA (un 512³ son ~270 MB) y
 * iOS/WebKit recarga la pestaña sin avisar al pasarse. El dental lo
 * resuelve con un binario reducido que genera SU servidor; el instituto no
 * tiene ese generador todavía, así que aquí se es honesto: se ofrece la
 * descarga y se dice por qué.
 */
const EDU_CBCT_MOVIL_MAX_BYTES = 32 * 1024 * 1024;

/** ¿Aparato de poca RAM (móvil/tablet)? Heurística defensiva: nunca lanza. */
function eduLowMemDevice(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const dm = (navigator as { deviceMemory?: number }).deviceMemory;
    if (typeof dm === "number" && dm > 0 && dm <= 4) return true;
    const ua = navigator.userAgent || "";
    const iOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && (navigator as { maxTouchPoints?: number }).maxTouchPoints! > 1);
    const android = /Android/.test(ua);
    const touchOnly =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    return iOS || android || Boolean(touchOnly);
  } catch {
    return false;
  }
}

function eduEsDicomSuelto(name: string): boolean {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return ext === "dcm" || ext === "dicom";
}

/** Decodifica el .zip en el worker del dental (jszip + dicom-parser +
 *  códecs WASM fuera del hilo). Rechaza si el worker no existe o falla,
 *  para caer al decodificador del hilo principal. */
function decodeConWorker(
  blob: Blob,
  onProgress: (done: number, total: number) => void,
  onWorker: (w: Worker) => void,
): Promise<Slice[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    try {
      if (typeof window === "undefined" || typeof Worker === "undefined") {
        reject(new Error("worker unavailable"));
        return;
      }
      // Ruta RELATIVA a propósito: webpack empaqueta el worker como chunk
      // aparte solo cuando puede resolver el new URL en compilación, y con
      // el alias "@/" no lo garantiza.
      worker = new Worker(new URL("../../patient-3d/dicom-decode.worker.ts", import.meta.url));
    } catch {
      reject(new Error("worker unavailable"));
      return;
    }
    onWorker(worker);
    worker.onmessage = (e: MessageEvent) => {
      const msg = (e.data || {}) as DecodeWorkerOut;
      if (msg.type === "progress") onProgress(msg.done, msg.total);
      else if (msg.type === "done") {
        worker?.terminate();
        resolve(msg.slices);
      } else if (msg.type === "error") {
        worker?.terminate();
        reject(new Error(msg.message || "worker error"));
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      reject(new Error("worker error"));
    };
    worker.postMessage({ type: "decode", blob });
  });
}

/** Fallback en el hilo principal: solo DICOM sin comprimir (los códecs
 *  viven en el worker). Cede el hilo cada dos cortes. */
async function decodeEnMain(
  blob: Blob,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<Slice[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries = Object.values(zip.files).filter((f) => !f.dir && isDicomEntryName(f.name));
  const total = entries.length;
  onProgress(0, total);
  const out: Slice[] = [];
  let done = 0;
  for (const entry of entries) {
    if (isCancelled()) return out;
    try {
      const buf = await entry.async("arraybuffer");
      const s = decodeSlice(buf, done);
      if (s) out.push(...s);
    } catch {
      /* corte ilegible: se salta */
    }
    done++;
    if (done % 2 === 0 || done === total) {
      onProgress(done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

export interface EduCbctViewerProps {
  /** URL FIRMADA del .zip (o del .dcm suelto). Caduca: no se guarda. */
  url: string;
  name: string;
  sizeBytes: number;
  /** Clave ESTABLE de la cache (el id del EduStudy): la URL firmada cambia
   *  en cada apertura y por eso no sirve de clave. */
  cacheKey: string;
}

type Estado = "cargando" | "listo" | "error" | "vacio" | "pesado";

export function EduCbctViewer({ url, name, sizeBytes, cacheKey }: EduCbctViewerProps) {
  const [slices, setSlices] = useState<Slice[]>([]);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [progreso, setProgreso] = useState({ done: 0, total: 0 });
  const [droppedForeign, setDroppedForeign] = useState(false);

  // Ventana y cruz COMPARTIDAS por los tres planos (es lo que las sincroniza).
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [activePreset, setActivePreset] = useState<WindowKey | null>(null);
  const [cross, setCross] = useState<Cross>({ x: 0, y: 0, z: 0 });
  const [tool, setTool] = useState<Tool>("crosshair");
  const [showGuides, setShowGuides] = useState(true);
  const [maximized, setMaximized] = useState<PlaneKey | "volume" | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [defaultWin, setDefaultWin] = useState({ c: 0, w: 1 });

  // Poca RAM: UNA vista a la vez y el 3D bajo demanda, como el dental. Se
  // decide una vez — la clase de aparato no cambia a media sesión.
  const [lowMem] = useState<boolean>(() => eduLowMemDevice());
  const [mobileView, setMobileView] = useState<PlaneKey | "volume">("axial");

  const esDicomSuelto = eduEsDicomSuelto(name);

  useEffect(() => {
    let cancelled = false;
    let activeWorker: Worker | null = null;

    // El freno de móvil va ANTES de descargar un solo byte.
    if (lowMem && !esDicomSuelto && sizeBytes > EDU_CBCT_MOVIL_MAX_BYTES) {
      setEstado("pesado");
      return;
    }

    const finalize = (raw: Slice[]) => {
      // Fuera los cortes de OTRA serie (un scout suelto en el mismo .zip):
      // el visor indexa con el raster del primero y uno ajeno pintaría una
      // imagen nítida y FALSA. La decisión vive en cbct-mpr-shared.
      const arr = keepDominantSeries(raw);
      if (arr.length === 0) {
        setEstado(raw.length === 0 ? "vacio" : "error");
        return;
      }
      setDroppedForeign(arr.length !== raw.length);
      sortSlicesForVolume(arr);
      const mid = Math.floor(arr.length / 2);
      setDefaultWin({ c: arr[mid].center, w: arr[mid].width });
      setSlices(arr);
      setCross({ x: Math.floor(arr[0].cols / 2), y: Math.floor(arr[0].rows / 2), z: mid });
      setCenter(arr[mid].center);
      setWidth(arr[mid].width);
      setActivePreset(null);
      setMaximized(null);
      setEstado("listo");
    };

    setEstado("cargando");
    setProgreso({ done: 0, total: 0 });
    setDroppedForeign(false);

    (async () => {
      try {
        // 1 · Cortes ya decodificados en IndexedDB → ni descarga ni decode.
        const cacheados = await getDecodedSlices(cacheKey);
        if (cancelled) return;
        if (cacheados && cacheados.length > 0) {
          finalize(cacheados as Slice[]);
          return;
        }

        // 2 · El binario (con cache de blobs por cacheKey).
        const blob = await fetchWithCache(cacheKey, url);
        if (cancelled) return;

        // 3 · Un .dcm SUELTO no es un zip: se decodifica directo. Solo sin
        // comprimir — los códecs viven en el worker, que espera un zip. Si
        // no se puede, el error lo dice y el archivo queda a un clic.
        if (esDicomSuelto) {
          const s = decodeSlice(await blob.arrayBuffer(), 0);
          if (cancelled) return;
          if (!s || s.length === 0) setEstado("error");
          else finalize(s);
          return;
        }

        // 4 · El .zip completo: worker primero, hilo principal de respaldo.
        const onProgress = (done: number, total: number) => {
          if (!cancelled) setProgreso({ done, total });
        };
        let decoded: Slice[];
        try {
          decoded = await decodeConWorker(blob, onProgress, (w) => {
            activeWorker = w;
          });
        } catch {
          if (cancelled) return;
          decoded = await decodeEnMain(blob, onProgress, () => cancelled);
        }
        if (cancelled) return;
        if (decoded.length === 0) {
          setEstado("vacio");
          return;
        }
        finalize(decoded);
        // Se cachea el set CRUDO (pre-filtrado), igual que el dental: el
        // aviso de "series mezcladas" tiene que sobrevivir a la segunda
        // apertura, y para eso los cortes descartados deben seguir ahí.
        void putDecodedSlices(cacheKey, decoded);
      } catch {
        if (!cancelled) setEstado("error");
      }
    })();

    return () => {
      cancelled = true;
      activeWorker?.terminate();
    };
  }, [cacheKey, url, lowMem, esDicomSuelto, sizeBytes]);

  // ── La matemática importada: estadística, escala y confianza ──────────
  const stats = useMemo(() => computeVolStats(slices), [slices]);
  const measuredZ = useMemo(() => measureZSpacing(slices), [slices]);
  const oneOrientation = useMemo(() => sameOrientation(slices), [slices]);

  // Escala física: lo inferido del corte + la MEDIANA medida de las
  // posiciones reales (que le gana al header — es una medida, no un dato).
  const scale = useMemo<ScaleInfo>(() => {
    if (slices.length === 0) return { sx: 1, sy: 1, sz: 1, xySource: "none", zCalibrated: false };
    const base = inferScale(slices[0]);
    if (!measuredZ) return base;
    if (measuredZ.sz === null) return { ...base, zVariable: measuredZ.variable };
    return { ...base, sz: measuredZ.sz, zCalibrated: true, zVariable: measuredZ.variable };
  }, [slices, measuredZ]);

  const zPhysicalOrder = useMemo(() => isPhysicallyOrdered(slices, measuredZ), [slices, measuredZ]);

  const geometryDoubt = useMemo<GeometryDoubtReason | null>(
    () =>
      slices.length === 0
        ? null
        : geometryDoubtReason({
            route: "full",
            orderSources: slices.map((s) => s.orderSource),
            samePosition: measuredZ !== null && measuredZ.sz === null,
            mixedSeries: !oneOrientation || droppedForeign,
            zVariable: scale.zVariable,
          }),
    [slices, measuredZ, oneOrientation, droppedForeign, scale.zVariable],
  );

  // Auto-ventana p1/p99 en cuanto hay percentiles (el WindowCenter del
  // scanner suele caer mal en CBCT).
  const [autoAplicada, setAutoAplicada] = useState(false);
  useEffect(() => {
    setAutoAplicada(false);
  }, [cacheKey]);
  useEffect(() => {
    if (!stats || slices.length === 0 || autoAplicada) return;
    setAutoAplicada(true);
    const w = presetWindow(stats, "auto");
    setDefaultWin({ c: w.c, w: w.w });
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset("auto");
  }, [stats, slices.length, autoAplicada]);

  const updateCross = useCallback(
    (next: Partial<Cross>) => {
      setCross((prev) => {
        if (slices.length === 0) return prev;
        const x = next.x != null ? clampInt(next.x, 0, slices[0].cols - 1) : prev.x;
        const y = next.y != null ? clampInt(next.y, 0, slices[0].rows - 1) : prev.y;
        const z = next.z != null ? clampInt(next.z, 0, slices.length - 1) : prev.z;
        if (x === prev.x && y === prev.y && z === prev.z) return prev;
        return { x, y, z };
      });
    },
    [slices],
  );

  const aplicarPreset = (key: WindowKey) => {
    if (!stats) return;
    const w = presetWindow(stats, key);
    setCenter(w.c);
    setWidth(w.w);
    setActivePreset(key);
  };

  const reiniciar = () => {
    if (stats) aplicarPreset("auto");
    else {
      setCenter(defaultWin.c);
      setWidth(defaultWin.w);
    }
    if (slices.length) {
      setCross({
        x: Math.floor(slices[0].cols / 2),
        y: Math.floor(slices[0].rows / 2),
        z: Math.floor(slices.length / 2),
      });
    }
    setResetNonce((n) => n + 1);
  };

  // ── Estados sin volumen ───────────────────────────────────────────────
  if (estado === "pesado") {
    return (
      <div className="edu-banner edu-banner--warn">
        <div>
          <p className="edu-banner__title">Este CBCT es muy pesado para verlo en el teléfono</p>
          <p className="edu-banner__detail">
            Abrirlo aquí descomprime el estudio completo en la memoria del dispositivo y la
            pestaña se recargaría a medias. Ábrelo desde una computadora para verlo con los
            tres planos y el volumen 3D, o descárgalo con el botón de abajo. El archivo está
            íntegro.
          </p>
        </div>
      </div>
    );
  }

  if (estado === "cargando") {
    return (
      <div className="edu-visor3d-cargando" role="status">
        <Loader2 className="edu-girando" size={18} />
        <span>
          Descomprimiendo y leyendo el CBCT…
          {progreso.total > 0 ? ` ${progreso.done} / ${progreso.total} cortes` : ""}
        </span>
      </div>
    );
  }

  if (estado === "error" || estado === "vacio") {
    return (
      <div className="edu-banner">
        <div>
          <p className="edu-banner__title">
            {estado === "vacio" ? "No se encontraron cortes legibles" : "No se pudo leer el estudio"}
          </p>
          <p className="edu-banner__detail">
            {estado === "vacio"
              ? "El .zip no contiene cortes DICOM legibles. Verifica que sea la carpeta del CBCT (archivos .dcm)."
              : esDicomSuelto
                ? "Este corte no se pudo decodificar aquí (puede venir comprimido con un códec que el visor solo maneja dentro de un .zip). Descárgalo con el botón de abajo."
                : "El archivo no pudo descomprimirse o leerse. Descárgalo con el botón de abajo para abrirlo en tu visor DICOM."}
          </p>
        </div>
      </div>
    );
  }

  // ── estado === "listo" ────────────────────────────────────────────────
  const winMin = defaultWin.c - defaultWin.w * 2;
  const winMax = defaultWin.c + defaultWin.w * 2;

  const pane = (p: { key: PlaneKey; label: string }, heightPx: number) => (
    <MprPane
      key={p.key}
      slices={slices}
      plane={p.key}
      zPhysicalOrder={zPhysicalOrder}
      label={p.label}
      cross={cross}
      scale={scale}
      center={center}
      width={width}
      tool={tool}
      showGuides={showGuides}
      resetNonce={resetNonce}
      maximized={maximized === p.key}
      heightPx={heightPx}
      onToggleMax={() => setMaximized((m) => (m === p.key ? null : p.key))}
      onCrossChange={updateCross}
    />
  );

  const volumen = (
    <div className="edu-visor3d-vol">
      <div className="edu-visor3d-vol__head">
        <span>
          <Box size={14} /> Volumen 3D
        </span>
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={() => setMaximized((m) => (m === "volume" ? null : "volume"))}
        >
          {maximized === "volume" ? "Restaurar" : "Maximizar"}
        </button>
      </div>
      <Dicom3DVolume
        slices={slices as unknown as VolSlice[]}
        maxDim={lowMem ? 128 : 256}
        zSpacingMm={scale.sz}
        zPhysicalOrder={zPhysicalOrder}
        height={maximized === "volume" ? "68vh" : 420}
      />
    </div>
  );

  const planoMaximizado = PLANES.find((p) => p.key === maximized);

  return (
    <div className="edu-visor3d">
      {geometryDoubt && <GeometryWarning detail={GEOMETRY_DOUBT_DETAIL[geometryDoubt]} />}

      {/* Barra: herramienta + guías + reiniciar. */}
      <div className="edu-visor3d-barra" role="toolbar" aria-label="Herramientas del visor CBCT">
        <div className="edu-visor3d-grupo" role="group" aria-label="Herramienta">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const on = tool === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                className={`edu-btn edu-btn--sm ${on ? "edu-btn--primary" : "edu-btn--ghost"}`}
                onClick={() => setTool(t.key)}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="edu-visor3d-grupo">
          <button
            type="button"
            aria-pressed={showGuides}
            className={`edu-btn edu-btn--sm ${showGuides ? "edu-btn--primary" : "edu-btn--ghost"}`}
            onClick={() => setShowGuides((v) => !v)}
          >
            <Crosshair size={14} />
            Guías
          </button>
          <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={reiniciar}>
            <RotateCcw size={14} />
            Reiniciar
          </button>
        </div>
      </div>

      {/* Ventana 2D: presets + brillo/contraste. */}
      <div className="edu-visor3d-barra">
        <div className="edu-visor3d-grupo" role="group" aria-label="Ventana 2D">
          {WINDOW_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={activePreset === p.key}
              disabled={!stats}
              className={`edu-btn edu-btn--sm ${
                activePreset === p.key ? "edu-btn--primary" : "edu-btn--ghost"
              }`}
              onClick={() => aplicarPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="edu-visor3d-slider">
          <Sun size={14} aria-hidden />
          <input
            type="range"
            min={winMin}
            max={winMax}
            value={center}
            aria-label="Brillo (centro de ventana)"
            onChange={(e) => {
              setCenter(Number(e.target.value));
              setActivePreset(null);
            }}
          />
        </label>
        <label className="edu-visor3d-slider">
          <ContrastIcon size={14} aria-hidden />
          <input
            type="range"
            min={1}
            max={Math.max(2, defaultWin.w * 4)}
            value={width}
            aria-label="Contraste (ancho de ventana)"
            onChange={(e) => {
              setWidth(Number(e.target.value));
              setActivePreset(null);
            }}
          />
        </label>
      </div>

      {/* Poca RAM: una vista a la vez; escritorio: rejilla 2×2 o el
          cuadrante maximizado. La cruz sigue compartida en los dos modos. */}
      {lowMem ? (
        <div className="edu-visor3d-pila">
          <div className="edu-visor3d-grupo" role="group" aria-label="Vista del estudio">
            {PLANES.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={mobileView === p.key}
                className={`edu-btn edu-btn--sm ${
                  mobileView === p.key ? "edu-btn--primary" : "edu-btn--ghost"
                }`}
                onClick={() => setMobileView(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={mobileView === "volume"}
              className={`edu-btn edu-btn--sm ${
                mobileView === "volume" ? "edu-btn--primary" : "edu-btn--ghost"
              }`}
              onClick={() => setMobileView("volume")}
            >
              <Box size={14} /> 3D
            </button>
          </div>
          {mobileView === "volume"
            ? volumen
            : pane(PLANES.find((p) => p.key === mobileView) ?? PLANES[0], 420)}
          <p className="edu-note">
            En este dispositivo se muestra una vista a la vez para cuidar la memoria. Toca
            “3D” para cargar el volumen.
          </p>
        </div>
      ) : maximized === "volume" ? (
        volumen
      ) : planoMaximizado ? (
        pane(planoMaximizado, 600)
      ) : (
        <div className="edu-visor3d-grid">
          {pane(PLANES[0], 400)}
          {pane(PLANES[1], 400)}
          {pane(PLANES[2], 400)}
          {volumen}
        </div>
      )}

      <p className="edu-note">
        <Layers size={13} aria-hidden /> {slices.length} cortes · cruz sincronizada en mm ·
        rueda = navegar cortes · Ctrl/⌘+rueda = zoom · doble clic = centrar.
      </p>
      <p className="edu-visor3d-aviso">
        ⚠ El CBCT no entrega unidades Hounsfield reales: la sonda da un valor relativo para
        comparar zonas del MISMO estudio, no densidad ósea. Sin escala calibrada, las
        medidas se reportan en px. Es apoyo visual — no sustituye una estación diagnóstica
        certificada.
      </p>
    </div>
  );
}
