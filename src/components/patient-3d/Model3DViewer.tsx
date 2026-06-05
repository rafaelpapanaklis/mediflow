"use client";
// Visor 3D genérico para modelos intraorales STL / PLY / OBJ.
// Generaliza el STLViewer3D de ortodoncia a los tres formatos usando los
// loaders de three/examples. Three.js se carga por code-split (este componente
// se importa dinámicamente desde Models3DTab) para no inflar el bundle del
// expediente cuando nadie abre un modelo.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Model3DFormat = "stl" | "ply" | "obj";

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

export default function Model3DViewer({ url, format, onClose }: Model3DViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fmt = format ?? formatFromUrl(url);
    if (!fmt) {
      setStatus("error");
      return;
    }
    setStatus("loading");

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

    // Iluminación: ambiental + dos direccionales para dar volumen al escaneo.
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dir1.position.set(50, 50, 80);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dir2.position.set(-60, -40, -50);
    scene.add(ambient, dir1, dir2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // prefers-reduced-motion → sin auto-rotación (accesibilidad).
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 1.2;

    let object: THREE.Object3D | null = null;
    let disposed = false;

    // Centra el objeto en el origen y encuadra la cámara a su bounding box.
    const frameObject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
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

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      if (object) disposeObject(object);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [url, format]);

  return (
    <div className="flex flex-col gap-2">
      {onClose && (
        <header className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Arrastra para rotar · scroll para zoom
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded border border-border bg-transparent text-foreground text-[11px] cursor-pointer hover:bg-muted/50"
          >
            Cerrar
          </button>
        </header>
      )}
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: 520, background: "#0b0d11", borderRadius: 8, border: "1px solid var(--border)" }}
      >
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            Cargando modelo 3D…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300 px-6 text-center">
            No se pudo cargar el modelo 3D. Verifica que sea un STL, PLY u OBJ válido.
          </div>
        )}
      </div>
    </div>
  );
}
