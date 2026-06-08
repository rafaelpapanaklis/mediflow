"use client";
// Miniatura de la lista de modelos 3D. Renderiza el modelo a una imagen estática
// (render-to-image) y libera el contexto WebGL de inmediato para no agotar
// contextos en listas largas. Carga diferida: solo cuando la tarjeta es visible
// (IntersectionObserver) y con concurrencia limitada (máx 2 a la vez).
//
// Archivos ligeros (≤8 MB) generan la miniatura automáticamente al entrar en
// viewport. Los pesados (p. ej. escaneos de ~50 MB) muestran un placeholder por
// formato y solo descargan/renderizan bajo demanda (hover o foco), para no
// bloquear la lista ni saturar la red.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Box, Loader2, Layers } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { fetchWithCache } from "@/lib/dicom-cache";
import { getCachedThumb, putCachedThumb } from "@/lib/thumb-cache";
import type { Model3DFormat } from "./Model3DViewer";

const AUTO_MAX_BYTES = 8 * 1024 * 1024; // ≤8 MB: miniatura automática.
const THUMB_PX = 160; // resolución base del render (se muestra más pequeña).
const TOOTH_COLOR = 0xc8d4e2;
const RENDER_TIMEOUT_MS = 15000; // tope: si carga+render no termina, cae a ícono.

// Color por formato para el placeholder elegante.
const FORMAT_STYLE: Record<Model3DFormat, { bg: string; fg: string }> = {
  stl: { bg: "rgba(37,99,235,.14)", fg: "#60a5fa" },
  ply: { bg: "rgba(139,92,246,.14)", fg: "#a78bfa" },
  obj: { bg: "rgba(16,185,129,.14)", fg: "#34d399" },
  dicom: { bg: "rgba(244,114,182,.14)", fg: "#f472b6" },
};

// Semáforo de concurrencia: como mucho 2 renders simultáneos en toda la lista.
let activeRenders = 0;
const waiters: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeRenders < 2) {
      activeRenders++;
      resolve();
    } else {
      waiters.push(() => {
        activeRenders++;
        resolve();
      });
    }
  });
}
function releaseSlot() {
  activeRenders = Math.max(0, activeRenders - 1);
  const next = waiters.shift();
  if (next) next();
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

// Carga el modelo y le aplica el mismo material que el visor para coherencia.
// La descarga se rutea por la cache IndexedDB (fetchWithCache por fileId) cuando
// hay fileId, evitando re-descargar de Supabase; si no, cae a un fetch normal.
// El buffer se obtiene UNA sola vez y se parsea en memoria (STL/PLY/OBJ .parse),
// sin que el loader vuelva a pegarle a la red.
async function loadObject(
  url: string,
  fmt: Model3DFormat,
  fileId?: string,
): Promise<THREE.Object3D> {
  const blob = fileId ? await fetchWithCache(fileId, url) : await (await fetch(url)).blob();
  const buf = await blob.arrayBuffer();

  if (fmt === "obj") {
    const group = new OBJLoader().parse(new TextDecoder().decode(new Uint8Array(buf)));
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
    return group;
  }

  let geo: THREE.BufferGeometry;
  if (fmt === "ply") {
    geo = new PLYLoader().parse(buf);
    // PLY puede traer sus propias normales: solo recalculamos si faltan (no las
    // forzamos para no estropear el sombreado que el archivo ya define).
    if (!geo.hasAttribute("normal")) geo.computeVertexNormals();
    // PLYLoader (r184) ya convierte los colores por vértice de sRGB a lineal al
    // parsear; con el outputColorSpace sRGB por defecto se ven correctos. No
    // reconvertir aquí: duplicaría la corrección y oscurecería.
  } else {
    // STL llega NO indexado con normales por cara → aspecto facetado. Para un
    // sombreado suave: borramos la normal por cara (si no, mergeVertices no
    // fusionaría posiciones coincidentes con normales distintas), fusionamos
    // vértices duplicados y recalculamos normales suaves.
    geo = new STLLoader().parse(buf);
    geo.deleteAttribute("normal");
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
  }
  const hasColor = geo.hasAttribute("color");
  const material = new THREE.MeshPhongMaterial({
    color: hasColor ? 0xffffff : TOOTH_COLOR,
    vertexColors: hasColor,
    specular: 0x222222,
    shininess: 70,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, material);
}

// Renderiza un frame a un dataURL PNG y libera el contexto WebGL al terminar.
// Tope de seguridad: si la carga del modelo o el render no terminan en
// RENDER_TIMEOUT_MS, la promesa se rechaza (Promise.race) y el `finally` libera
// SIEMPRE el slot del semáforo; así un modelo colgado nunca bloquea la lista.
//
// Si hay fileId: primero se consulta la cache de miniaturas (IndexedDB). Un
// cache-hit devuelve el PNG SIN adquirir el slot del semáforo ni crear el
// WebGLRenderer (ahorro real de hardware). Tras generar un PNG nuevo, se persiste
// best-effort por fileId.
async function renderToDataUrl(
  url: string,
  fmt: Model3DFormat,
  signal: AbortSignal,
  fileId?: string,
): Promise<string> {
  // Cache-hit: salta por completo el semáforo y el contexto WebGL.
  if (fileId) {
    const hit = await getCachedThumb(fileId);
    if (hit) return hit;
  }
  if (signal.aborted) throw new Error("aborted");

  await acquireSlot();
  let renderer: THREE.WebGLRenderer | null = null;
  let object: THREE.Object3D | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  // Canvas y handlers de pérdida/restauración de contexto WebGL. Se guardan a
  // nivel de función para poder quitarlos SIEMPRE en el `finally` (sin fugas),
  // aunque se registren dentro del closure de render.
  let canvas: HTMLCanvasElement | null = null;
  let onContextLost: ((e: Event) => void) | null = null;
  let onContextRestored: (() => void) | null = null;
  try {
    const work = (async (): Promise<string> => {
      if (signal.aborted) throw new Error("aborted");
      const obj = await loadObject(url, fmt, fileId);
      // Si ya venció el timeout (o se abortó), no crear el contexto WebGL.
      if (settled) throw new Error("timeout");
      if (signal.aborted) throw new Error("aborted");
      object = obj;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
      const ambient = new THREE.AmbientLight(0xffffff, 0.7);
      const dir1 = new THREE.DirectionalLight(0xffffff, 0.75);
      dir1.position.set(50, 50, 80);
      const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
      dir2.position.set(-60, -40, -50);
      scene.add(ambient, dir1, dir2, obj);

      // Encuadre: centra y aleja la cámara según el bounding box.
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      camera.position.set(size * 0.35, size * 0.25, size * 1.25);
      camera.near = Math.max(size / 100, 0.01);
      camera.far = size * 100;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1.5);
      renderer.setSize(THUMB_PX, THUMB_PX, false);
      renderer.setClearColor(0x000000, 0);

      // Robustez ante pérdida de contexto WebGL. preventDefault permite que el
      // navegador pueda RESTAURAR el contexto (si no, el canvas queda negro para
      // siempre). Al restaurarse, repintamos SOLO si el render aún no terminó
      // (cache-miss / en vuelo): nunca tocamos una miniatura ya cacheada.
      canvas = renderer.domElement;
      const sceneRef = scene;
      const cameraRef = camera;
      onContextLost = (e: Event) => e.preventDefault();
      onContextRestored = () => {
        if (settled) return; // ya completado/cacheado: no re-renderizar.
        renderer?.render(sceneRef, cameraRef);
      };
      canvas.addEventListener("webglcontextlost", onContextLost, false);
      canvas.addEventListener("webglcontextrestored", onContextRestored, false);

      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      // Persiste la miniatura por fileId (best-effort, no bloquea el retorno).
      if (fileId) void putCachedThumb(fileId, dataUrl);
      return dataUrl;
    })();
    const timeout = new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), RENDER_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
    // Quitar los listeners de contexto SIEMPRE (evita fugas en listas largas).
    if (canvas) {
      if (onContextLost) canvas.removeEventListener("webglcontextlost", onContextLost, false);
      if (onContextRestored) canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
    }
    if (object) disposeObject(object);
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
    }
    releaseSlot();
  }
}

interface Props {
  url: string;
  format?: Model3DFormat;
  sizeBytes?: number | null;
  name: string;
  fileId?: string;
  onOpen?: () => void;
}

export default function Model3DThumbnail({ url, format, sizeBytes, name, fileId, onOpen }: Props) {
  const t = useT();
  const fmt: Model3DFormat = format ?? "stl";
  const isDicom = fmt === "dicom"; // DICOM no se renderiza como malla: placeholder.
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [img, setImg] = useState<string | null>(null);
  const [requested, setRequested] = useState(false); // disparo manual (pesados).
  const [visible, setVisible] = useState(false);
  const [retry, setRetry] = useState(0); // contador para reintentar un render fallido.
  const ref = useRef<HTMLButtonElement | null>(null);
  const startedKeyRef = useRef<string | null>(null); // último modelo/intento ya iniciado.

  const auto = typeof sizeBytes === "number" && sizeBytes > 0 && sizeBytes <= AUTO_MAX_BYTES;

  // IntersectionObserver: marca la tarjeta como visible (con margen de prefetch).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Dispara el render cuando procede (auto para ligeros, manual para pesados).
  // IMPORTANTE: `phase` NO va en las dependencias. Antes sí estaba y, al llamar
  // setPhase("loading") aquí dentro, el efecto se re-ejecutaba: su cleanup
  // abortaba el render recién iniciado y el nuevo ciclo salía temprano, dejando
  // el spinner colgado para siempre. La guarda `startedKeyRef` arranca el render
  // una sola vez por modelo/intento (la clave incluye url, fmt y retry).
  useEffect(() => {
    if (!visible || isDicom) return; // DICOM: placeholder, sin render 3D.
    if (!auto && !requested) return; // pesados: solo bajo demanda (hover/foco).
    const key = `${fileId ?? url}|${fmt}|${retry}`;
    if (startedKeyRef.current === key) return; // ya iniciado para este modelo/intento.
    startedKeyRef.current = key;
    const controller = new AbortController();
    setPhase("loading");
    renderToDataUrl(url, fmt, controller.signal, fileId)
      .then((dataUrl) => {
        if (!controller.signal.aborted) {
          setImg(dataUrl);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("error");
      });
    // El cleanup solo corre en desmontaje real o si cambia url/fmt/retry/fileId.
    return () => controller.abort();
  }, [visible, auto, requested, url, fmt, isDicom, retry, fileId]);

  // Reintenta una sola vez un render fallido (al pasar/enfocar el ícono de error).
  const retryRender = () => {
    if (phase !== "error") return;
    setPhase("loading");
    setRetry((n) => n + 1);
  };

  const style = FORMAT_STYLE[fmt] ?? FORMAT_STYLE.stl;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      // Para pesados: hover/foco genera la vista previa bajo demanda.
      onMouseEnter={() => {
        if (!auto) setRequested(true);
        retryRender();
      }}
      onFocus={() => {
        if (!auto) setRequested(true);
        retryRender();
      }}
      aria-label={t("patients.models3d.openAria", { name })}
      title={t("patients.models3d.view")}
      className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      style={{ background: "#0b0d11" }}
    >
      {phase === "ready" && img ? (
        <img src={img} alt="" className="w-full h-full object-contain" draggable={false} />
      ) : (
        <span
          className="flex flex-col items-center justify-center gap-0.5 w-full h-full"
          style={{ background: style.bg }}
        >
          {phase === "loading" ? (
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: style.fg }} aria-hidden />
          ) : isDicom ? (
            <Layers className="w-5 h-5" style={{ color: style.fg }} aria-hidden />
          ) : (
            <Box className="w-5 h-5" style={{ color: style.fg }} aria-hidden />
          )}
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: style.fg }}>
            {fmt}
          </span>
        </span>
      )}
    </button>
  );
}
