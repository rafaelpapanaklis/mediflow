"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * El poste de barbero en three.js. Todo es procedural —cilindros, toros,
 * esferas y una textura de franjas pintada en un canvas—, así que no hay
 * ningún modelo que descargar: el único peso es el chunk de three, y ese
 * solo lo pide pole-upgrade.tsx en escritorio capaz y con la página ya
 * cargada.
 *
 * El cilindro interior gira sobre su eje: como las franjas son una hélice,
 * parecen subir sin fin (la ilusión del poste de verdad). El vidrio y el
 * latón reflejan un RoomEnvironment (sin HDR externo).
 *
 * ── EL ARRANQUE VA EN TAREAS CORTAS ─────────────────────────────────
 * Montar todo de una vez costaba ~550 ms de hilo principal en una sola
 * tarea (evaluar three + compilar shaders + generar el entorno), y eso
 * es TBT aunque pase después del load. Aquí cada paso cede el hilo:
 * armar la escena → generar el entorno (PMREM) → compilar los shaders EN
 * PARALELO (compileAsync, KHR_parallel_shader_compile) → primer frame.
 * Ninguna tarea propia pasa de unas decenas de ms; la evaluación del
 * módulo de three es la única que no se puede partir.
 *
 * Solo dibuja cuando el poste está en pantalla y la pestaña visible; al
 * desmontar libera geometrías, materiales, texturas y el contexto WebGL.
 * `onReady` se llama con el primer frame ya dibujado (la puerta hace el
 * crossfade con el poste CSS); `onFail` si el contexto se pierde, y el
 * poste CSS vuelve a verse.
 */
export interface BarberPole3DProps {
  onReady: () => void;
  onFail: () => void;
}

const RED = "#a8291f";
const NAVY = "#1f3352";
const CREAM = "#f7f0e5";

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** Cede el hilo principal: la siguiente parte del arranque va en otra tarea. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(() => resolve(), { timeout: 800 });
    else window.setTimeout(resolve, 16);
  });
}

/** Franjas diagonales que empalman al envolver el cilindro (sube 2 mosaicos por vuelta ≈ 47°). */
function makeStripeTexture(): THREE.CanvasTexture | null {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const colors = [RED, CREAM, NAVY, CREAM];
  const band = S / 4;
  const slope = 2;
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, S, S);
  for (let k = -12; k <= 6; k++) {
    const y0 = k * band;
    ctx.fillStyle = colors[((k % 4) + 4) % 4];
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(S, y0 + slope * S);
    ctx.lineTo(S, y0 + slope * S + band);
    ctx.lineTo(0, y0 + band);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Sombra de contacto: un degradado radial, nada de shadow maps. */
function makeShadowTexture(): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function BarberPole3D({ onReady, onFail }: BarberPole3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadyRef = useRef(onReady);
  const onFailRef = useRef(onFail);
  onReadyRef.current = onReady;
  onFailRef.current = onFail;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;

    let cancelled = false;
    const disposables: Array<{ dispose: () => void }> = [];
    const keep = <T extends { dispose: () => void }>(x: T): T => {
      disposables.push(x);
      return x;
    };
    let renderer: THREE.WebGLRenderer | null = null;
    let teardownLoop: () => void = () => {};

    const setup = async () => {
      // ── Tarea 1: renderer, materiales y geometría (barato) ──────────
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      // Neutral (no ACES): conserva la saturación del rojo y el marino.
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.0;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
      camera.position.set(0, 0.08, 9);
      camera.lookAt(0, 0, 0);

      const stripes = makeStripeTexture();
      if (!stripes) throw new Error("sin canvas 2d");
      keep(stripes);

      const brass = keep(
        new THREE.MeshStandardMaterial({ color: 0xd4a25c, metalness: 1, roughness: 0.3, envMapIntensity: 1.25 }),
      );
      const paint = keep(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5, metalness: 0.05 }));
      // Vidrio con MeshStandard (no Physical): mismo programa base que el
      // latón y la pintura → menos shaders que compilar; el brillo lo pone
      // el entorno.
      const glassMat = keep(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.13,
          roughness: 0.05,
          metalness: 0.2,
          envMapIntensity: 1.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );

      const group = new THREE.Group();
      group.rotation.z = -0.07;
      scene.add(group);

      const core = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.36, 0.36, 2.4, 64, 1, true)), paint);
      const glass = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.47, 0.47, 2.4, 64, 1, true)), glassMat);
      glass.renderOrder = 2;

      const capGeo = keep(new THREE.CylinderGeometry(0.57, 0.53, 0.28, 64));
      const capTop = new THREE.Mesh(capGeo, brass);
      capTop.position.y = 1.34;
      const capBottom = new THREE.Mesh(capGeo, brass);
      capBottom.position.y = -1.34;
      capBottom.rotation.x = Math.PI;

      const ringGeo = keep(new THREE.TorusGeometry(0.5, 0.045, 16, 64));
      const ringTop = new THREE.Mesh(ringGeo, brass);
      ringTop.rotation.x = Math.PI / 2;
      ringTop.position.y = 1.19;
      const ringBottom = new THREE.Mesh(ringGeo, brass);
      ringBottom.rotation.x = Math.PI / 2;
      ringBottom.position.y = -1.19;

      const neckGeo = keep(new THREE.CylinderGeometry(0.2, 0.3, 0.26, 32));
      const neckTop = new THREE.Mesh(neckGeo, brass);
      neckTop.position.y = 1.61;
      const neckBottom = new THREE.Mesh(neckGeo, brass);
      neckBottom.position.y = -1.61;
      neckBottom.rotation.x = Math.PI;

      const ballGeo = keep(new THREE.SphereGeometry(0.31, 40, 28));
      const ballTop = new THREE.Mesh(ballGeo, brass);
      ballTop.position.y = 1.95;
      const ballBottom = new THREE.Mesh(ballGeo, brass);
      ballBottom.position.y = -1.95;

      group.add(core, glass, capTop, capBottom, ringTop, ringBottom, neckTop, neckBottom, ballTop, ballBottom);

      const shadowTex = makeShadowTexture();
      if (shadowTex) {
        keep(shadowTex);
        const shadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
        const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.8, 1.2)), shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -2.34;
        scene.add(shadow);
      }

      const hemi = new THREE.HemisphereLight(0xfff0dc, 0x1a1210, 0.55);
      const key = new THREE.DirectionalLight(0xffe6c4, 2.2);
      key.position.set(3, 5, 4);
      const rim = new THREE.DirectionalLight(0xcd9459, 1.6);
      rim.position.set(-4, 1, -3);
      scene.add(hemi, key, rim);

      // Encuadre: el poste mide ~4.5 de alto; cabe siempre, sea cual sea la caja.
      const fit = () => {
        if (!renderer) return;
        const w = Math.max(1, wrap.clientWidth);
        const h = Math.max(1, wrap.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const byHeight = 4.95 / 2 / t;
        const byWidth = 1.55 / 2 / (t * camera.aspect);
        camera.position.z = Math.max(byHeight, byWidth);
        camera.updateProjectionMatrix();
      };
      fit();

      // ── Tarea 2: el entorno (PMREM), en su propia tarea ─────────────
      await yieldToMain();
      if (cancelled) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = keep(pmrem.fromScene(room, 0.04).texture);
      pmrem.dispose();
      room.dispose();

      // ── Tarea 3: shaders en paralelo, sin bloquear ──────────────────
      await yieldToMain();
      if (cancelled) return;
      await renderer.compileAsync(scene, camera);
      if (cancelled) return;

      // ── Tarea 4: el loop ────────────────────────────────────────────
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
      ro?.observe(wrap);

      // Paralaje del mouse sobre toda la portada (±, suavizado en el loop).
      const hero = wrap.closest("section");
      let targetX = 0;
      let targetY = 0;
      let curX = 0;
      let curY = 0;
      const onMove = (e: MouseEvent) => {
        if (!hero) return;
        const r = hero.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        targetX = (e.clientX - r.left) / r.width - 0.5;
        targetY = (e.clientY - r.top) / r.height - 0.5;
      };
      const onLeave = () => {
        targetX = 0;
        targetY = 0;
      };
      hero?.addEventListener("mousemove", onMove);
      hero?.addEventListener("mouseleave", onLeave);

      const clock = new THREE.Clock(false);
      let raf = 0;
      let running = false;
      let ready = false;
      let inView = true;

      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!renderer) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        // Sentido medido en Chromium con GPU: con este signo las franjas
        // parecen SUBIR, como en el poste de la esquina.
        core.rotation.y += dt * 1.15;
        curX += (targetX - curX) * 0.06;
        curY += (targetY - curY) * 0.06;
        group.rotation.y = curX * 0.5;
        group.rotation.x = curY * 0.18;
        group.rotation.z = -0.07 - curX * 0.06;
        renderer.render(scene, camera);
        if (!ready) {
          ready = true;
          onReadyRef.current();
        }
      };
      const start = () => {
        if (running) return;
        running = true;
        clock.start();
        raf = requestAnimationFrame(frame);
      };
      const stop = () => {
        if (!running) return;
        running = false;
        clock.stop();
        cancelAnimationFrame(raf);
      };
      const sync = () => {
        if (inView && !document.hidden) start();
        else stop();
      };
      const io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver(
              (entries) => {
                inView = entries.some((e) => e.isIntersecting);
                sync();
              },
              { threshold: 0.02 },
            )
          : null;
      io?.observe(wrap);
      document.addEventListener("visibilitychange", sync);

      const onLost = (e: Event) => {
        e.preventDefault();
        stop();
        onFailRef.current();
      };
      canvas.addEventListener("webglcontextlost", onLost);

      teardownLoop = () => {
        stop();
        io?.disconnect();
        ro?.disconnect();
        document.removeEventListener("visibilitychange", sync);
        hero?.removeEventListener("mousemove", onMove);
        hero?.removeEventListener("mouseleave", onLeave);
        canvas.removeEventListener("webglcontextlost", onLost);
      };
      sync();
    };

    setup().catch(() => {
      if (!cancelled) onFailRef.current();
    });

    return () => {
      cancelled = true;
      teardownLoop();
      for (const d of disposables) d.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = null;
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="dcbl-pole3d" />;
}
