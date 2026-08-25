"use client";

import { useEffect, useRef, useState } from "react";
import s from "./properties.module.css";

/**
 * Visor de PANORÁMICAS PROPIAS (equirectangulares) — el segundo camino de
 * los recorridos: el asesor sube las fotos 360 que tomó con su celular y se
 * ven aquí, sin pagarle a ningún proveedor.
 *
 * ── POR QUÉ three y no Pannellum / Photo Sphere Viewer ─────────────────
 * Las dos son la opción obvia, y las dos habría que INSTALARLAS. En este
 * repo `package.json` no es un archivo del vertical: tocarlo hace fallar la
 * guardia de inmuebles, y con razón — una dependencia nueva la instalan
 * también el dental y barber, que están vivos en producción. `three` YA
 * está instalado (^0.184.0) y una esfera con la textura por dentro es,
 * literalmente, lo que hacen esas librerías. Se usa lo que hay.
 *
 * ── EL ARRANQUE ────────────────────────────────────────────────────────
 * three pesa. Cargarlo con la ficha dispararía el TBT de la pantalla
 * completa (lección de la landing de barber), así que:
 *   · el import es DINÁMICO y ocurre al pulsar "ver", nunca antes;
 *   · el <canvas> solo se monta cuando el usuario lo pide.
 * Mientras tanto la ficha no paga ni un kilobyte de 3D.
 *
 * ── LOS HOTSPOTS ───────────────────────────────────────────────────────
 * RealtyPropertyTour NO tiene dónde guardar puntos de navegación (no hay
 * campo Json ni tabla de hotspots), y esta terminal no toca el schema. Así
 * que las escenas se enlazan por ORDEN, con una tira de puntos abajo:
 * misma utilidad —recorrer el inmueble cuarto por cuarto— sin inventarse
 * una columna. Queda reportado para promoverlo cuando haya dónde guardarlo.
 */

export interface PanoScene {
  id: string;
  url: string;
}

export interface PanoViewerProps {
  scenes: PanoScene[];
  labels: {
    loading: string;
    unsupported: string;
    drag: string;
    scene: (n: number) => string;
  };
}

type Status = "loading" | "ready" | "error";

export default function PanoViewer({ scenes, labels }: PanoViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  // La textura se cambia sin re-montar el visor: rehacer el renderer en
  // cada escena parpadea en negro y vuelve a costar el arranque de WebGL.
  const setTextureRef = useRef<((url: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const host = hostRef.current;
      if (!host) return;

      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled || !hostRef.current) return;

      const width = host.clientWidth || 640;
      const height = host.clientHeight || 360;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      } catch {
        // Sin WebGL (equipo viejo, GPU en lista negra) no hay visor: se
        // dice, no se deja un rectángulo negro sin explicación.
        if (!cancelled) setStatus("error");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.domElement.className = s.panoCanvas;
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 1000);
      // La cámara va EN EL CENTRO de la esfera: no orbita alrededor de un
      // objeto, mira desde dentro de la foto.
      camera.position.set(0, 0, 0.001);

      const geometry = new THREE.SphereGeometry(50, 60, 40);
      // Escala negativa en X: voltea la esfera de dentro hacia fuera. Sin
      // esto se ve la panorámica en espejo y los letreros salen al revés.
      geometry.scale(-1, 1, 1);

      const material = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      let currentTexture: import("three").Texture | null = null;

      function applyTexture(url: string) {
        if (!url) return;
        setStatus("loading");
        loader.load(
          url,
          (texture) => {
            if (cancelled) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            const previous = currentTexture;
            currentTexture = texture;
            material.map = texture;
            material.color.set(0xffffff);
            material.needsUpdate = true;
            // La anterior se libera DESPUÉS de colgar la nueva: soltarla
            // antes deja un cuadro en blanco entre escena y escena.
            if (previous) previous.dispose();
            setStatus("ready");
          },
          undefined,
          () => {
            if (!cancelled) setStatus("error");
          },
        );
      }
      setTextureRef.current = applyTexture;
      applyTexture(scenes[0]?.url ?? "");

      // ── Mirar alrededor ────────────────────────────────────────────
      let lon = 0;
      let lat = 0;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLon = 0;
      let startLat = 0;

      const canvas = renderer.domElement;

      function onDown(e: PointerEvent) {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLon = lon;
        startLat = lat;
        canvas.setPointerCapture(e.pointerId);
      }
      function onMove(e: PointerEvent) {
        if (!dragging) return;
        // 0.12 grados por píxel: con más, un arrastre corto da la vuelta
        // entera y se pierde la orientación.
        lon = startLon - (e.clientX - startX) * 0.12;
        lat = startLat + (e.clientY - startY) * 0.12;
        // El tope en ±85° evita que la cámara se voltee al mirar al cielo.
        lat = Math.max(-85, Math.min(85, lat));
      }
      function onUp(e: PointerEvent) {
        dragging = false;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* el puntero ya se soltó solo */
        }
      }

      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);

      const target = new THREE.Vector3();
      let frame = 0;
      function render() {
        frame = requestAnimationFrame(render);
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon);
        target.setFromSphericalCoords(1, phi, theta);
        camera.lookAt(target);
        renderer.render(scene, camera);
      }
      render();

      // El panel cambia de ancho al colapsar el sidebar: sin esto la
      // panorámica queda estirada hasta recargar.
      const ro = new ResizeObserver(() => {
        const el = hostRef.current;
        if (!el) return;
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      ro.observe(host);

      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        setTextureRef.current = null;
        if (currentTexture) currentTexture.dispose();
        geometry.dispose();
        material.dispose();
        // Sin esto el contexto WebGL sigue vivo: los navegadores solo
        // permiten un puñado y el visor deja de abrir a la cuarta ficha.
        renderer.dispose();
        renderer.forceContextLoss();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      };
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
    // Solo se monta una vez: el cambio de escena va por setTextureRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(i: number) {
    if (i === index || !scenes[i]) return;
    setIndex(i);
    setTextureRef.current?.(scenes[i].url);
  }

  return (
    <div className={s.panoStage}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      {status !== "ready" ? (
        <div className={s.panoStatus}>
          {status === "loading" ? labels.loading : labels.unsupported}
        </div>
      ) : (
        <span className={s.panoHint}>{labels.drag}</span>
      )}
      {scenes.length > 1 ? (
        <div className={s.panoOverlay}>
          {scenes.map((sc, i) => (
            <button
              key={sc.id}
              type="button"
              className={`${s.panoDot} ${i === index ? s.panoDotOn : ""}`}
              onClick={() => goTo(i)}
              aria-label={labels.scene(i + 1)}
              aria-current={i === index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
