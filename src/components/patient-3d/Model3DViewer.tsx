"use client";
// Visor 3D genérico para modelos intraorales STL / PLY / OBJ.
// Generaliza el STLViewer3D de ortodoncia a los tres formatos usando los
// loaders de three/examples. Three.js se carga por code-split (este componente
// se importa dinámicamente desde Models3DTab) para no inflar el bundle del
// expediente cuando nadie abre un modelo.
//
// Herramientas: rotar (orbitar) y medir. En modo "medir" el usuario hace clic
// en dos puntos de la superficie (raycasting) y se dibuja la cota con la
// distancia en las unidades del archivo (se asume mm; conmutable a cm). Las
// etiquetas usan CSS2DRenderer superpuesto para texto nítido y accesible.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Ruler, RotateCw, Eraser } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

export type Model3DFormat = "stl" | "ply" | "obj";
export type MeasureUnit = "mm" | "cm";
type ToolMode = "rotate" | "measure";

export interface Model3DViewerProps {
  url: string;
  /** Si no se pasa, se infiere de la extensión de la URL. */
  format?: Model3DFormat;
  onClose?: () => void;
}

// Infiere el formato a partir de la extensión, ignorando el query/hash de las
// signed URLs de Supabase (`.../modelo.stl?token=...`).
function formatFromUrl(url: string): Model3DFormat | null {
  const clean = url.split("?")[0].split("#")[0].toLowerCase();
  if (clean.endsWith(".stl")) return "stl";
  if (clean.endsWith(".ply")) return "ply";
  if (clean.endsWith(".obj")) return "obj";
  return null;
}

const TOOTH_COLOR = 0xc8d4e2;
const MEASURE_COLOR = 0x22d3ee; // cyan-400, contrasta sobre el fondo oscuro.

// La distancia cruda está en las unidades del archivo (se asume mm).
function formatDistance(raw: number, unit: MeasureUnit): string {
  if (unit === "cm") return `${(raw / 10).toFixed(2)} cm`;
  return `${raw.toFixed(2)} mm`;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
      else mat?.dispose?.();
    }
  });
}

interface Measurement {
  raw: number;
  labelEl: HTMLElement;
  objects: THREE.Object3D[];
}

interface ViewerApi {
  applyMode: (m: ToolMode) => void;
  applyUnit: (u: MeasureUnit) => void;
  clear: () => void;
}

// Clase de botón del control segmentado (rotar/medir, mm/cm).
function segBtn(active: boolean): string {
  return [
    "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
    active ? "bg-brand-600 text-white" : "bg-transparent text-foreground hover:bg-muted/60",
  ].join(" ");
}

export default function Model3DViewer({ url, format, onClose }: Model3DViewerProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<ToolMode>("rotate");
  const [unit, setUnit] = useState<MeasureUnit>("mm");
  const [measureCount, setMeasureCount] = useState(0);

  // Puentes estado→escena imperativa: los handlers de puntero leen el modo/
  // unidad actuales sin re-montar el visor.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const apiRef = useRef<ViewerApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fmt = format ?? formatFromUrl(url);
    if (!fmt) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    setMeasureCount(0);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d11);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Capa de etiquetas (CSS2D) superpuesta para las cotas de medición.
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    const ldom = labelRenderer.domElement;
    ldom.style.position = "absolute";
    ldom.style.top = "0";
    ldom.style.left = "0";
    ldom.style.pointerEvents = "none"; // los punteros pasan a OrbitControls.
    container.appendChild(ldom);

    // Iluminación: ambiental + dos direccionales para dar volumen al escaneo.
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dir1.position.set(50, 50, 80);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-60, -40, -50);
    scene.add(ambient, dir1, dir2);

    // Grupo que contiene marcadores, líneas y etiquetas de las mediciones.
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // prefers-reduced-motion → sin auto-rotación (accesibilidad).
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotateSpeed = 1.2;
    // Auto-rotación solo en modo "rotar" (y si no hay reduce-motion).
    controls.autoRotate = modeRef.current === "rotate" && !reduceMotion;

    let object: THREE.Object3D | null = null;
    let disposed = false;
    let markerRadius = 1;

    // Centra el objeto en el origen y encuadra la cámara a su bounding box.
    const frameObject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      markerRadius = Math.max(size * 0.012, 0.001);
      camera.position.set(0, 0, size * 1.3);
      camera.near = Math.max(size / 100, 0.01);
      camera.far = size * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const onLoadError = (err: unknown) => {
      if (disposed) return;
      console.error("[Model3DViewer] load failed", err);
      setStatus("error");
    };

    const addObject = (obj: THREE.Object3D) => {
      if (disposed) {
        disposeObject(obj);
        return;
      }
      object = obj;
      scene.add(obj);
      frameObject(obj);
      setStatus("ready");
    };

    const meshFromGeometry = (geometry: THREE.BufferGeometry) => {
      geometry.computeVertexNormals();
      const hasColor = geometry.hasAttribute("color");
      const material = new THREE.MeshPhongMaterial({
        color: hasColor ? 0xffffff : TOOTH_COLOR,
        vertexColors: hasColor,
        specular: 0x222222,
        shininess: 70,
        side: THREE.DoubleSide,
      });
      return new THREE.Mesh(geometry, material);
    };

    try {
      if (fmt === "stl") {
        new STLLoader().load(url, (geo) => addObject(meshFromGeometry(geo)), undefined, onLoadError);
      } else if (fmt === "ply") {
        new PLYLoader().load(url, (geo) => addObject(meshFromGeometry(geo)), undefined, onLoadError);
      } else {
        // OBJ → Group; aplicamos material uniforme a cada mesh para uniformar
        // escaneos sin .mtl.
        new OBJLoader().load(
          url,
          (group) => {
            group.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.geometry?.computeVertexNormals?.();
                mesh.material = new THREE.MeshPhongMaterial({
                  color: TOOTH_COLOR,
                  specular: 0x222222,
                  shininess: 70,
                  side: THREE.DoubleSide,
                });
              }
            });
            addObject(group);
          },
          undefined,
          onLoadError,
        );
      }
    } catch (err) {
      onLoadError(err);
    }

    // ---- Medición de distancias (raycasting sobre la superficie) ----
    const measurements: Measurement[] = [];
    const pts: THREE.Vector3[] = []; // puntos pendientes del par en curso.
    const pendingMarkers: THREE.Mesh[] = [];
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const lineMat = new THREE.LineBasicMaterial({ color: MEASURE_COLOR });
    let downX = 0;
    let downY = 0;

    const makeMarker = (p: THREE.Vector3) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(markerRadius, 16, 16),
        new THREE.MeshBasicMaterial({ color: MEASURE_COLOR }),
      );
      m.position.copy(p);
      measureGroup.add(m);
      return m;
    };

    const makeLabel = (text: string, pos: THREE.Vector3) => {
      const el = document.createElement("div");
      el.textContent = text;
      // CSS2DRenderer sobrescribe `transform` cada frame, así que no lo fijamos.
      el.style.cssText =
        "padding:2px 7px;border-radius:9999px;background:rgba(8,11,16,.85);color:#a5f3fc;" +
        "font:600 11px/1.3 ui-sans-serif,system-ui,sans-serif;border:1px solid rgba(34,211,238,.55);" +
        "white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);";
      const label = new CSS2DObject(el);
      label.position.copy(pos);
      measureGroup.add(label);
      return { el, label };
    };

    const disposeMeasureObject = (o: THREE.Object3D) => {
      if (o instanceof CSS2DObject) {
        o.element?.remove?.();
      } else {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
        else mat?.dispose?.();
      }
      o.parent?.remove(o);
    };

    const clearMeasurements = () => {
      for (const meas of measurements) for (const o of meas.objects) disposeMeasureObject(o);
      measurements.length = 0;
      for (const m of pendingMarkers) disposeMeasureObject(m);
      pendingMarkers.length = 0;
      pts.length = 0;
      setMeasureCount(0);
    };

    const placePoint = (p: THREE.Vector3) => {
      const point = p.clone();
      pts.push(point);
      pendingMarkers.push(makeMarker(point));
      if (pts.length < 2) return;

      const [a, b] = pts;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(lineGeo, lineMat);
      measureGroup.add(line);
      const raw = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const { el, label } = makeLabel(formatDistance(raw, unitRef.current), mid);
      measurements.push({
        raw,
        labelEl: el,
        objects: [pendingMarkers[0], pendingMarkers[1], line, label],
      });
      pts.length = 0;
      pendingMarkers.length = 0;
      setMeasureCount(measurements.length);
    };

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (modeRef.current !== "measure") return;
      const target = object;
      if (!target) return;
      // Si hubo arrastre, fue una rotación con OrbitControls → no medir.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(target, true);
      if (hits.length) placePoint(hits[0].point);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    apiRef.current = {
      applyMode: (m) => {
        controls.autoRotate = m === "rotate" && !reduceMotion;
      },
      applyUnit: (u) => {
        for (const meas of measurements) meas.labelEl.textContent = formatDistance(meas.raw, u);
      },
      clear: clearMeasurements,
    };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      clearMeasurements();
      lineMat.dispose();
      controls.dispose();
      if (object) disposeObject(object);
      renderer.dispose();
      apiRef.current = null;
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (container.contains(ldom)) container.removeChild(ldom);
    };
  }, [url, format]);

  // Sincroniza estado React → escena imperativa (sin reconstruir el visor).
  useEffect(() => {
    apiRef.current?.applyMode(mode);
  }, [mode]);
  useEffect(() => {
    apiRef.current?.applyUnit(unit);
  }, [unit]);

  // Atajos de teclado cuando el viewport tiene foco: R rotar, M medir, C limpiar.
  const onViewportKey = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "r") setMode("rotate");
    else if (k === "m") setMode("measure");
    else if (k === "c") apiRef.current?.clear();
  };

  return (
    <div className="flex flex-col gap-2">
      {onClose && (
        <header className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{t("patients.models3d.viewerHint")}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded border border-border bg-transparent text-foreground text-[11px] cursor-pointer hover:bg-muted/50"
          >
            {t("patients.models3d.close")}
          </button>
        </header>
      )}

      {/* Barra de herramientas: rotar | medir, limpiar, unidad */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("patients.models3d.tools")}>
        <div
          role="group"
          aria-label={t("patients.models3d.mode")}
          className="inline-flex rounded-lg border border-border overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setMode("rotate")}
            aria-pressed={mode === "rotate"}
            aria-keyshortcuts="r"
            className={segBtn(mode === "rotate")}
          >
            <RotateCw className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.rotate")}
          </button>
          <button
            type="button"
            onClick={() => setMode("measure")}
            aria-pressed={mode === "measure"}
            aria-keyshortcuts="m"
            className={segBtn(mode === "measure")}
          >
            <Ruler className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.measure")}
          </button>
        </div>

        <button
          type="button"
          onClick={() => apiRef.current?.clear()}
          disabled={measureCount === 0}
          aria-keyshortcuts="c"
          aria-label={t("patients.models3d.clearMeasurements")}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Eraser className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.clear")}
          {measureCount > 0 ? ` (${measureCount})` : ""}
        </button>

        <div
          role="group"
          aria-label={t("patients.models3d.unit")}
          className="inline-flex rounded-lg border border-border overflow-hidden sm:ml-auto"
        >
          <button type="button" onClick={() => setUnit("mm")} aria-pressed={unit === "mm"} className={segBtn(unit === "mm")}>
            mm
          </button>
          <button type="button" onClick={() => setUnit("cm")} aria-pressed={unit === "cm"} className={segBtn(unit === "cm")}>
            cm
          </button>
        </div>
      </div>

      {mode === "measure" && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {t("patients.models3d.measureHint")}
        </p>
      )}

      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={t("patients.models3d.viewerHint")}
        aria-keyshortcuts="r m c"
        onKeyDown={onViewportKey}
        className="relative w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        style={{ height: 520, background: "#0b0d11", borderRadius: 8, border: "1px solid var(--border)" }}
      >
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-white/70">
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            {t("patients.models3d.loading")}
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-rose-300 px-6 text-center">
            {t("patients.models3d.loadError")}
          </div>
        )}
      </div>
    </div>
  );
}
