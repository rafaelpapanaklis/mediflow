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
import { Box, Loader2, Layers } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
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
function loadObject(url: string, fmt: Model3DFormat): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const onErr = (err: unknown) => reject(err);
    if (fmt === "obj") {
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
          resolve(group);
        },
        undefined,
        onErr,
      );
      return;
    }
    const onGeo = (geo: THREE.BufferGeometry) => {
      geo.computeVertexNormals();
      const hasColor = geo.hasAttribute("color");
      const material = new THREE.MeshPhongMaterial({
        color: hasColor ? 0xffffff : TOOTH_COLOR,
        vertexColors: hasColor,
        specular: 0x222222,
        shininess: 70,
        side: THREE.DoubleSide,
      });
      resolve(new THREE.Mesh(geo, material));
    };
    if (fmt === "ply") new PLYLoader().load(url, onGeo, undefined, onErr);
    else new STLLoader().load(url, onGeo, undefined, onErr);
  });
}

// Renderiza un frame a un dataURL PNG y libera el contexto WebGL al terminar.
// Tope de seguridad: si la carga del modelo o el render no terminan en
// RENDER_TIMEOUT_MS, la promesa se rechaza (Promise.race) y el `finally` libera
// SIEMPRE el slot del semáforo; así un modelo colgado nunca bloquea la lista.
async function renderToDataUrl(url: string, fmt: Model3DFormat, signal: AbortSignal): Promise<string> {
  await acquireSlot();
  let renderer: THREE.WebGLRenderer | null = null;
  let object: THREE.Object3D | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  try {
    const work = (async (): Promise<string> => {
      if (signal.aborted) throw new Error("aborted");
      const obj = await loadObject(url, fmt);
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
      renderer.setPixelRatio(2);
      renderer.setSize(THUMB_PX, THUMB_PX, false);
      renderer.setClearColor(0x000000, 0);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    })();
    const timeout = new Promise<string>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), RENDER_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
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
  onOpen?: () => void;
}

export default function Model3DThumbnail({ url, format, sizeBytes, name, onOpen }: Props) {
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
    const key = `${url}|${fmt}|${retry}`;
    if (startedKeyRef.current === key) return; // ya iniciado para este modelo/intento.
    startedKeyRef.current = key;
    const controller = new AbortController();
    setPhase("loading");
    renderToDataUrl(url, fmt, controller.signal)
      .then((dataUrl) => {
        if (!controller.signal.aborted) {
          setImg(dataUrl);
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("error");
      });
    // El cleanup solo corre en desmontaje real o si cambia url/fmt/retry.
    return () => controller.abort();
  }, [visible, auto, requested, url, fmt, isDicom, retry]);

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
