"use client";
// Visor 3D genérico para modelos intraorales STL / PLY / OBJ.
// Generaliza el STLViewer3D de ortodoncia a los tres formatos usando los
// loaders de three/examples. Three.js se carga por code-split (este componente
// se importa dinámicamente desde Models3DTab) para no inflar el bundle del
// expediente cuando nadie abre un modelo.
//
// El modelo es ESTÁTICO por defecto: solo se mueve cuando el usuario arrastra
// (OrbitControls manual). Hay un toggle "Auto-rotar" APAGADO por defecto que
// además respeta prefers-reduced-motion (con movimiento reducido nunca rota).
//
// Herramientas (selector de modo Rotar | Medir | Marcar):
//  - Medir: clic en dos puntos de la superficie (raycasting) → cota con la
//    distancia en mm/cm. Etiquetas vía CSS2DRenderer superpuesto.
//  - Marcar: clic en la superficie coloca un pin con etiqueta editable; clic
//    sobre un pin lo borra. Los pins se guardan en PatientFile.annotations.
// Más herramientas en la toolbar: encuadrar/reset, vistas rápidas
// (frontal/oclusal/lateral), sólido/malla, color del modelo. Cuando se pasan
// patientId+fileId, el popup muestra un panel de notas (PatientFile.doctorNotes)
// y la lista de marcas, persistidos vía PATCH del endpoint del modelo.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Ruler,
  RotateCw,
  Eraser,
  MapPin,
  Maximize,
  Square,
  Grid,
  Palette,
  RefreshCw,
  StickyNote,
  Save,
  Trash2,
  Download,
  Layers,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { fetchWithCache } from "@/lib/dicom-cache";

// "dicom" cubre tomografías .dcm/.dicom: no son mallas, no se cargan con three.
export type Model3DFormat = "stl" | "ply" | "obj" | "dicom";
export type MeasureUnit = "mm" | "cm";
type ToolMode = "rotate" | "measure" | "mark";
type ColorKey = "bone" | "gray" | "violet";
type ViewKind = "front" | "occlusal" | "lateral";

export interface Pin3D {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface Model3DViewerProps {
  url: string;
  /** Si no se pasa, se infiere de la extensión de la URL. */
  format?: Model3DFormat;
  onClose?: () => void;
  // Persistencia opcional: con patientId+fileId se habilita el panel de notas y
  // la persistencia de marcas (PatientFile.doctorNotes / annotations).
  patientId?: string;
  fileId?: string;
  initialNotes?: string | null;
  initialAnnotations?: unknown;
}

// Infiere el formato a partir de la extensión, ignorando el query/hash de las
// signed URLs de Supabase (`.../modelo.stl?token=...`).
function formatFromUrl(url: string): Model3DFormat | null {
  const clean = url.split("?")[0].split("#")[0].toLowerCase();
  if (clean.endsWith(".stl")) return "stl";
  if (clean.endsWith(".ply")) return "ply";
  if (clean.endsWith(".obj")) return "obj";
  if (clean.endsWith(".dcm") || clean.endsWith(".dicom")) return "dicom";
  return null;
}

// Presets de color del modelo: hueso/marfil, gris (actual) y violeta.
const COLOR_PRESETS: Record<ColorKey, number> = {
  bone: 0xe6dcc8,
  gray: 0xc8d4e2,
  violet: 0xc4b5fd,
};
const DEFAULT_COLOR: ColorKey = "gray";
const MEASURE_COLOR = 0x22d3ee; // cyan-400, contrasta sobre el fondo oscuro.
const MARK_COLOR = 0xf472b6; // pink-400, distinto del cyan de las mediciones.

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

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function") {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return `pin_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

// Normaliza el JSON crudo de PatientFile.annotations a pins 3D válidos.
function parsePins(raw: unknown): Pin3D[] {
  if (!Array.isArray(raw)) return [];
  const out: Pin3D[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (
      r &&
      typeof r === "object" &&
      typeof r.x === "number" &&
      typeof r.y === "number" &&
      typeof r.z === "number"
    ) {
      out.push({
        id: typeof r.id === "string" ? r.id : makeId(),
        label: typeof r.label === "string" ? r.label : "",
        x: r.x,
        y: r.y,
        z: r.z,
      });
    }
  }
  return out;
}

interface Measurement {
  raw: number;
  labelEl: HTMLElement;
  objects: THREE.Object3D[];
}

interface ViewerApi {
  applyUnit: (u: MeasureUnit) => void;
  clearMeasure: () => void;
  syncAutoRotate: () => void;
  applyWireframe: (on: boolean) => void;
  applyColor: (hex: number) => void;
  resetView: () => void;
  setView: (k: ViewKind) => void;
  removePin: (id: string) => void;
  clearPins: () => void;
  setPinLabel: (id: string, label: string) => void;
}

// Clase de botón del control segmentado (modo, vistas, render, mm/cm).
function segBtn(active: boolean): string {
  return [
    "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
    active ? "bg-brand-600 text-white" : "bg-transparent text-foreground hover:bg-muted/60",
  ].join(" ");
}

export default function Model3DViewer({
  url,
  format,
  onClose,
  patientId,
  fileId,
  initialNotes,
  initialAnnotations,
}: Model3DViewerProps) {
  const t = useT();
  // DICOM se trata aparte: no es una malla, no se inicializa three.js. El panel
  // de notas sigue disponible (depende del estado, no del render 3D).
  const resolvedFormat = format ?? formatFromUrl(url);
  const isDicom = resolvedFormat === "dicom";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<ToolMode>("rotate");
  const [unit, setUnit] = useState<MeasureUnit>("mm");
  const [measureCount, setMeasureCount] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [colorKey, setColorKey] = useState<ColorKey>(DEFAULT_COLOR);
  const [autoRotate, setAutoRotate] = useState(false);
  const [marks, setMarks] = useState<Pin3D[]>([]);

  const canPersist = Boolean(patientId && fileId);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [panelOpen, setPanelOpen] = useState(true);

  // prefers-reduced-motion → el toggle de auto-rotar queda inhabilitado.
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Puentes estado→escena imperativa: los handlers leen el estado actual sin
  // re-montar el visor.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const colorRef = useRef(colorKey);
  colorRef.current = colorKey;
  const wireframeRef = useRef(wireframe);
  wireframeRef.current = wireframe;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const initialAnnotationsRef = useRef(initialAnnotations);
  initialAnnotationsRef.current = initialAnnotations;
  const apiRef = useRef<ViewerApi | null>(null);

  useEffect(() => {
    // DICOM no es malla: el panel de tomografía se renderiza aparte y aquí no se
    // inicializa three.js (cargarlo con STL/PLY/OBJLoader fallaría).
    const fmt = format ?? formatFromUrl(url);
    if (fmt === "dicom") return;

    const container = containerRef.current;
    if (!container) return;

    if (!fmt) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    setMeasureCount(0);
    setMarks([]);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d11);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(0, 0, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Capa de etiquetas (CSS2D) superpuesta para cotas de medición y pins.
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

    // Grupos de overlays: mediciones y marcas (independientes del modelo).
    const measureGroup = new THREE.Group();
    scene.add(measureGroup);
    const markGroup = new THREE.Group();
    scene.add(markGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 1.2;
    controls.autoRotate = false; // ESTÁTICO por defecto; solo rota al arrastrar.

    let object: THREE.Object3D | null = null;
    let disposed = false;
    let markerRadius = 1;

    // ---- Render ON-DEMAND ----
    // El modelo es estático: en vez de renderizar a 60fps perpetuos (GPU/CPU,
    // batería y ventilador al 100% con la imagen quieta), solo dibujamos cuando
    // algo cambia. requestRender() pide un frame y arranca el loop; el loop se
    // mantiene vivo únicamente mientras la cámara se mueve (damping de
    // OrbitControls en curso o autoRotate) y se detiene al asentarse.
    let raf = 0;
    let needsRender = false;
    const loop = () => {
      if (disposed) {
        raf = 0;
        return;
      }
      // controls.update() devuelve true mientras la cámara cambia (damping o
      // autoRotate); así sabemos si hay que seguir pidiendo frames.
      const moving = controls.update();
      if (needsRender || moving) {
        needsRender = false;
        renderer.render(scene, camera);
        // labelRenderer SIEMPRE acoplado a renderer: las etiquetas CSS2D se
        // reproyectan a pantalla en cada render, junto con la escena.
        labelRenderer.render(scene, camera);
      }
      raf = moving || controls.autoRotate ? requestAnimationFrame(loop) : 0;
    };
    // Pide un frame; si el loop estaba detenido, lo reactiva.
    const requestRender = () => {
      if (disposed) return;
      needsRender = true;
      if (raf === 0) raf = requestAnimationFrame(loop);
    };
    // OrbitControls emite 'change' en cada arrastre/zoom/pan → reactiva el loop
    // ante cualquier interacción de cámara aunque estuviera en reposo.
    controls.addEventListener("change", requestRender);

    // Pérdida/recuperación de contexto WebGL (GPU reset, tab en segundo plano,
    // driver): preventDefault deja que el navegador restaure el contexto en vez
    // de dejar el canvas en negro permanente. Al restaurarse, repintamos vía el
    // render ON-DEMAND (requestRender) para que la escena vuelva a dibujarse.
    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    const onContextRestored = () => {
      requestRender();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    // Recorre los materiales de cada mesh del modelo cargado.
    const forEachMeshMaterial = (fn: (m: THREE.Material) => void) => {
      if (!object) return;
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) if (m) fn(m);
        }
      });
    };
    const setObjectWireframe = (on: boolean) => {
      forEachMeshMaterial((m) => {
        (m as THREE.MeshPhongMaterial).wireframe = on;
      });
      requestRender();
    };
    const setObjectColor = (hex: number) => {
      forEachMeshMaterial((m) => {
        const mm = m as THREE.MeshPhongMaterial;
        if (mm.vertexColors) return; // no recolorear PLY con color por vértice.
        mm.color?.setHex?.(hex);
      });
      requestRender();
    };

    // Centra el objeto en el origen y encuadra la cámara a su bounding box.
    const frameObject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      markerRadius = Math.max(size * 0.012, 0.001);
      camera.up.set(0, 1, 0);
      camera.position.set(0, 0, size * 1.3);
      camera.near = Math.max(size / 100, 0.01);
      camera.far = size * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      requestRender();
    };

    // Vistas rápidas ortogonales (aprox. según orientación del escaneo).
    const applyView = (kind: ViewKind) => {
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const d = size * 1.3;
      if (kind === "front") {
        camera.up.set(0, 1, 0);
        camera.position.set(0, 0, d);
      } else if (kind === "occlusal") {
        camera.up.set(0, 0, -1); // mirada cenital (desde arriba).
        camera.position.set(0, d, 0);
      } else {
        camera.up.set(0, 1, 0);
        camera.position.set(d, 0, 0); // lateral.
      }
      controls.target.set(0, 0, 0);
      camera.lookAt(0, 0, 0);
      controls.update();
      requestRender();
    };

    const syncAutoRotate = () => {
      controls.autoRotate =
        autoRotateRef.current && modeRef.current === "rotate" && !reduceMotion;
      requestRender(); // arranca el loop si se activó autoRotate.
    };

    const onLoadError = (err: unknown) => {
      if (disposed) return;
      console.error("[Model3DViewer] load failed", err);
      setStatus("error");
    };

    // ---- Marcas (pins sobre la superficie) ----
    interface PinRec {
      labelEl: HTMLElement;
      marker: THREE.Mesh;
      labelObj: CSS2DObject;
    }
    const pinRecs = new Map<string, PinRec>();

    const makePinObjects = (pin: Pin3D) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(markerRadius * 1.5, 0.001), 16, 16),
        new THREE.MeshBasicMaterial({ color: MARK_COLOR }),
      );
      marker.position.set(pin.x, pin.y, pin.z);
      marker.userData.pinId = pin.id;
      markGroup.add(marker);
      const el = document.createElement("div");
      el.textContent = pin.label || "•";
      el.style.cssText =
        "padding:1px 7px;border-radius:9999px;background:rgba(8,11,16,.85);color:#fbcfe8;" +
        "font:600 11px/1.3 ui-sans-serif,system-ui,sans-serif;border:1px solid rgba(244,114,182,.6);" +
        "white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);";
      const labelObj = new CSS2DObject(el);
      labelObj.position.set(pin.x, pin.y, pin.z);
      markGroup.add(labelObj);
      pinRecs.set(pin.id, { labelEl: el, marker, labelObj });
      requestRender();
    };

    const removePinObjects = (id: string) => {
      const rec = pinRecs.get(id);
      if (!rec) return;
      rec.marker.geometry?.dispose?.();
      (rec.marker.material as THREE.Material)?.dispose?.();
      rec.marker.parent?.remove(rec.marker);
      rec.labelEl?.remove?.();
      rec.labelObj.parent?.remove(rec.labelObj);
      pinRecs.delete(id);
      requestRender();
    };

    const clearPinObjects = () => {
      for (const id of Array.from(pinRecs.keys())) removePinObjects(id);
    };

    const addObject = (obj: THREE.Object3D) => {
      if (disposed) {
        disposeObject(obj);
        return;
      }
      object = obj;
      scene.add(obj);
      frameObject(obj);
      // Aplica el estado actual (color/wireframe/auto-rotar) tras encuadrar.
      setObjectColor(COLOR_PRESETS[colorRef.current]);
      setObjectWireframe(wireframeRef.current);
      syncAutoRotate();
      // Restaura marcas guardadas (PatientFile.annotations).
      const restored = parsePins(initialAnnotationsRef.current);
      for (const pin of restored) makePinObjects(pin);
      if (restored.length) setMarks(restored);
      setStatus("ready");
      requestRender();
    };

    const meshFromGeometry = (geometry: THREE.BufferGeometry) => {
      // Solo recalculamos normales si la geometría no las trae (p. ej. PLY que
      // las incluye debe respetarlas; STL ya las recalculó tras el welding).
      if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
      const hasColor = geometry.hasAttribute("color");
      const material = new THREE.MeshPhongMaterial({
        color: hasColor ? 0xffffff : COLOR_PRESETS[DEFAULT_COLOR],
        vertexColors: hasColor,
        specular: 0x222222,
        shininess: 70,
        side: THREE.DoubleSide,
      });
      return new THREE.Mesh(geometry, material);
    };

    // Carga el modelo a través de la cache de archivos (IndexedDB por fileId):
    // reabrir el mismo escaneo no vuelve a descargarlo de Supabase. Si no hay
    // fileId, cae a un fetch directo. Usamos .parse() con el blob (no .load(url))
    // para reutilizar el archivo ya descargado/cacheado.
    const blobPromise = fileId
      ? fetchWithCache(fileId, url)
      : fetch(url).then((r) => {
          if (!r.ok) throw new Error("fetch");
          return r.blob();
        });

    void (async () => {
      try {
        const blob = await blobPromise;
        if (disposed) return;
        if (fmt === "stl") {
          // STL llega NO indexado con normales por cara → aspecto facetado. Para
          // un sombreado suave: borramos la normal por cara (si no, mergeVertices
          // no fusionaría posiciones coincidentes con normales distintas),
          // fusionamos vértices duplicados y recalculamos normales suaves.
          let geometry = new STLLoader().parse(await blob.arrayBuffer());
          geometry.deleteAttribute("normal");
          geometry = mergeVertices(geometry);
          geometry.computeVertexNormals();
          addObject(meshFromGeometry(geometry));
        } else if (fmt === "ply") {
          // PLYLoader (r184) ya convierte los colores por vértice de sRGB a
          // lineal al parsear (setRGB(..., SRGBColorSpace)); con el
          // outputColorSpace sRGB por defecto del renderer se ven correctos.
          // No reconvertir aquí: duplicaría la corrección y oscurecería.
          addObject(meshFromGeometry(new PLYLoader().parse(await blob.arrayBuffer())));
        } else {
          // OBJ → Group; aplicamos material uniforme a cada mesh para uniformar
          // escaneos sin .mtl.
          const group = new OBJLoader().parse(await blob.text());
          group.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.geometry?.computeVertexNormals?.();
              mesh.material = new THREE.MeshPhongMaterial({
                color: COLOR_PRESETS[DEFAULT_COLOR],
                specular: 0x222222,
                shininess: 70,
                side: THREE.DoubleSide,
              });
            }
          });
          addObject(group);
        }
      } catch (err) {
        onLoadError(err);
      }
    })();

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
      requestRender();
    };

    const placePoint = (p: THREE.Vector3) => {
      const point = p.clone();
      pts.push(point);
      pendingMarkers.push(makeMarker(point));
      requestRender(); // muestra el marcador (y, al completar el par, la cota).
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
      const target = object;
      if (!target) return;
      // Si hubo arrastre, fue una rotación con OrbitControls → no actuar.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const m = modeRef.current;
      if (m !== "measure" && m !== "mark") return;

      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      if (m === "measure") {
        const hits = raycaster.intersectObject(target, true);
        if (hits.length) placePoint(hits[0].point);
        return;
      }

      // Modo marcar: clic sobre un pin existente → borrarlo.
      const pinHits = raycaster.intersectObjects(markGroup.children, true);
      const hitPin = pinHits.find((h) => (h.object.userData as { pinId?: string })?.pinId);
      if (hitPin) {
        const id = (hitPin.object.userData as { pinId: string }).pinId;
        removePinObjects(id);
        setMarks((prev) => prev.filter((p) => p.id !== id));
        return;
      }
      // Si no, clic sobre la superficie → nuevo pin.
      const hits = raycaster.intersectObject(target, true);
      if (hits.length) {
        const p = hits[0].point;
        const pin: Pin3D = { id: makeId(), label: String(pinRecs.size + 1), x: p.x, y: p.y, z: p.z };
        makePinObjects(pin);
        setMarks((prev) => [...prev, pin]);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    apiRef.current = {
      applyUnit: (u) => {
        for (const meas of measurements) meas.labelEl.textContent = formatDistance(meas.raw, u);
        requestRender();
      },
      clearMeasure: clearMeasurements,
      syncAutoRotate,
      applyWireframe: setObjectWireframe,
      applyColor: setObjectColor,
      resetView: () => {
        if (object) frameObject(object);
      },
      setView: applyView,
      removePin: (id) => removePinObjects(id),
      clearPins: () => clearPinObjects(),
      setPinLabel: (id, label) => {
        const rec = pinRecs.get(id);
        if (rec) rec.labelEl.textContent = label || "•";
        requestRender();
      },
    };

    // Primer frame: dibuja la escena/fondo inicial. El modelo dispara su propio
    // render al terminar de cargar (addObject → requestRender).
    requestRender();

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      clearMeasurements();
      clearPinObjects();
      lineMat.dispose();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      if (object) disposeObject(object);
      renderer.dispose();
      apiRef.current = null;
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (container.contains(ldom)) container.removeChild(ldom);
    };
  }, [url, format, reduceMotion]);

  // Sincroniza estado React → escena imperativa (sin reconstruir el visor).
  useEffect(() => {
    apiRef.current?.applyUnit(unit);
  }, [unit]);
  useEffect(() => {
    apiRef.current?.syncAutoRotate();
  }, [autoRotate, mode]);
  useEffect(() => {
    apiRef.current?.applyWireframe(wireframe);
  }, [wireframe]);
  useEffect(() => {
    apiRef.current?.applyColor(COLOR_PRESETS[colorKey]);
  }, [colorKey]);

  // Reinicia las notas al cambiar de archivo.
  useEffect(() => {
    setNotes(initialNotes ?? "");
    setNotesStatus("idle");
  }, [fileId, initialNotes]);

  // Atajos cuando el viewport tiene foco: R rotar, M medir, P marcar,
  // F encuadrar, C limpiar mediciones.
  const onViewportKey = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "r") setMode("rotate");
    else if (k === "m") setMode("measure");
    else if (k === "p") setMode("mark");
    else if (k === "f") apiRef.current?.resetView();
    else if (k === "c") apiRef.current?.clearMeasure();
  };

  const updateMarkLabel = (id: string, label: string) => {
    setMarks((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)));
    apiRef.current?.setPinLabel(id, label);
  };
  const deleteMark = (id: string) => {
    setMarks((prev) => prev.filter((p) => p.id !== id));
    apiRef.current?.removePin(id);
  };
  const clearAllMarks = () => {
    setMarks([]);
    apiRef.current?.clearPins();
  };

  // Guarda notas + marcas en el PatientFile (multi-tenant: el API valida la
  // clínica desde la sesión, nunca desde el body).
  const save = async () => {
    if (!canPersist) return;
    setNotesStatus("saving");
    try {
      const res = await fetch(`/api/patients/${patientId}/models-3d/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorNotes: notes,
          annotations: marks.map(({ id, label, x, y, z }) => ({ id, label, x, y, z, type: "pin3d" })),
        }),
      });
      if (!res.ok) throw new Error("save_failed");
      setNotesStatus("saved");
      toast.success(t("patients.models3d.saved"));
    } catch {
      setNotesStatus("error");
      toast.error(t("patients.models3d.saveError"));
    }
  };

  const swatch = (c: ColorKey) =>
    [
      "w-5 h-5 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
      colorKey === c ? "ring-2 ring-brand-500 border-white" : "border-border",
    ].join(" ");

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

      {/* Barra de herramientas (oculta para DICOM: no hay malla que rotar/medir) */}
      {!isDicom && (
        <>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("patients.models3d.tools")}>
        {/* Modo: rotar | medir | marcar */}
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
          <button
            type="button"
            onClick={() => setMode("mark")}
            aria-pressed={mode === "mark"}
            aria-keyshortcuts="p"
            className={segBtn(mode === "mark")}
          >
            <MapPin className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.mark")}
          </button>
        </div>

        {/* Vistas rápidas */}
        <div
          role="group"
          aria-label={t("patients.models3d.views")}
          className="inline-flex rounded-lg border border-border overflow-hidden"
        >
          <button
            type="button"
            onClick={() => apiRef.current?.resetView()}
            aria-keyshortcuts="f"
            title={t("patients.models3d.resetView")}
            aria-label={t("patients.models3d.resetView")}
            className={segBtn(false)}
          >
            <Maximize className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button type="button" onClick={() => apiRef.current?.setView("front")} className={segBtn(false)}>
            {t("patients.models3d.viewFront")}
          </button>
          <button type="button" onClick={() => apiRef.current?.setView("occlusal")} className={segBtn(false)}>
            {t("patients.models3d.viewOcclusal")}
          </button>
          <button type="button" onClick={() => apiRef.current?.setView("lateral")} className={segBtn(false)}>
            {t("patients.models3d.viewLateral")}
          </button>
        </div>

        {/* Render: sólido | malla */}
        <div
          role="group"
          aria-label={t("patients.models3d.render")}
          className="inline-flex rounded-lg border border-border overflow-hidden"
        >
          <button type="button" onClick={() => setWireframe(false)} aria-pressed={!wireframe} className={segBtn(!wireframe)}>
            <Square className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.solid")}
          </button>
          <button type="button" onClick={() => setWireframe(true)} aria-pressed={wireframe} className={segBtn(wireframe)}>
            <Grid className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.wireframe")}
          </button>
        </div>

        {/* Color del modelo */}
        <div role="group" aria-label={t("patients.models3d.color")} className="inline-flex items-center gap-1.5 px-1">
          <Palette className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
          {(["bone", "gray", "violet"] as ColorKey[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColorKey(c)}
              aria-pressed={colorKey === c}
              aria-label={t(`patients.models3d.color_${c}`)}
              title={t(`patients.models3d.color_${c}`)}
              className={swatch(c)}
              style={{ background: `#${COLOR_PRESETS[c].toString(16).padStart(6, "0")}` }}
            />
          ))}
        </div>

        {/* Auto-rotar (apagado por defecto; respeta reduce-motion) */}
        <button
          type="button"
          onClick={() => setAutoRotate((v) => !v)}
          disabled={reduceMotion}
          aria-pressed={autoRotate && !reduceMotion}
          title={reduceMotion ? t("patients.models3d.autoRotateReduced") : t("patients.models3d.autoRotate")}
          className={[
            "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40 disabled:cursor-not-allowed",
            autoRotate && !reduceMotion ? "bg-brand-600 text-white" : "text-foreground hover:bg-muted/60",
          ].join(" ")}
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.autoRotate")}
        </button>

        {/* Limpiar mediciones (solo en modo medir) */}
        {mode === "measure" && (
          <button
            type="button"
            onClick={() => apiRef.current?.clearMeasure()}
            disabled={measureCount === 0}
            aria-keyshortcuts="c"
            aria-label={t("patients.models3d.clearMeasurements")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Eraser className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.clear")}
            {measureCount > 0 ? ` (${measureCount})` : ""}
          </button>
        )}

        {/* Unidad (solo en modo medir) */}
        {mode === "measure" && (
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
        )}
      </div>

      {mode === "measure" && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {t("patients.models3d.measureHint")}
        </p>
      )}
      {mode === "mark" && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {t("patients.models3d.markHint")}
        </p>
      )}
        </>
      )}

      {/* Visor (o panel DICOM) + panel de notas (colapsable en móvil) */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1 min-w-0">
          {isDicom ? (
            <div
              className="relative w-full flex flex-col items-center justify-center text-center gap-3 px-6"
              style={{ minHeight: 520, background: "#0b0d11", borderRadius: 8, border: "1px solid var(--border)" }}
            >
              <Layers className="w-10 h-10 text-white/40" aria-hidden />
              <div>
                <p className="text-sm font-bold text-white">{t("patients.models3d.dicomTitle")}</p>
                <p className="text-xs text-white/60 mt-1 max-w-xs">{t("patients.models3d.dicomSoon")}</p>
              </div>
              <a
                href={url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Download className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.download")}
              </a>
            </div>
          ) : (
          <div
            ref={containerRef}
            tabIndex={0}
            role="application"
            aria-label={t("patients.models3d.viewerHint")}
            aria-keyshortcuts="r m p f c"
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
          )}
        </div>

        {canPersist && (
          <aside className="lg:w-72 flex-shrink-0 border border-border rounded-lg bg-card self-start w-full">
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold border-b border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
            >
              <span className="inline-flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.notes")}
              </span>
              <span className="text-muted-foreground" aria-hidden>
                {panelOpen ? "−" : "+"}
              </span>
            </button>
            {panelOpen && (
              <div className="p-3 space-y-3">
                <div>
                  <textarea
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setNotesStatus("idle");
                    }}
                    rows={5}
                    placeholder={t("patients.models3d.notesPlaceholder")}
                    aria-label={t("patients.models3d.notes")}
                    className="w-full text-xs rounded-lg border border-border bg-background p-2 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
                      {notesStatus === "saving"
                        ? t("patients.models3d.saving")
                        : notesStatus === "saved"
                          ? t("patients.models3d.saved")
                          : notesStatus === "error"
                            ? t("patients.models3d.saveError")
                            : ""}
                    </span>
                    <button
                      type="button"
                      onClick={save}
                      disabled={notesStatus === "saving"}
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <Save className="w-3.5 h-3.5" aria-hidden /> {t("patients.models3d.save")}
                    </button>
                  </div>
                </div>

                {/* Marcas */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-muted-foreground">
                      {t("patients.models3d.marks")} ({marks.length})
                    </span>
                    {marks.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllMarks}
                        className="text-[11px] text-rose-600 hover:underline inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                      >
                        <Eraser className="w-3 h-3" aria-hidden /> {t("patients.models3d.clearMarks")}
                      </button>
                    )}
                  </div>
                  {marks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">{t("patients.models3d.marksEmpty")}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {marks.map((m, i) => (
                        <li key={m.id} className="flex items-center gap-1.5">
                          <span
                            className="w-5 h-5 flex-shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                            style={{ background: `#${MARK_COLOR.toString(16).padStart(6, "0")}` }}
                            aria-hidden
                          >
                            {i + 1}
                          </span>
                          <input
                            value={m.label}
                            onChange={(e) => updateMarkLabel(m.id, e.target.value)}
                            placeholder={t("patients.models3d.markLabelPlaceholder")}
                            aria-label={t("patients.models3d.markLabelAria", { n: i + 1 })}
                            className="flex-1 min-w-0 text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                          <button
                            type="button"
                            onClick={() => deleteMark(m.id)}
                            aria-label={t("patients.models3d.deleteMark", { n: i + 1 })}
                            className="p-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
