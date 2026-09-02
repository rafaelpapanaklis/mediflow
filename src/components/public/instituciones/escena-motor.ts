"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL MOTOR DE LAS TRES ESCENAS.
 *
 * Arrancar three.js bien es siempre el mismo trabajo —crear el contexto,
 * encuadrar, compilar, dibujar solo cuando se ve, y soltarlo todo al
 * salir— y escribirlo tres veces es cómo se llega a que una de las tres
 * se quede pintando en una pestaña oculta. Aquí está una vez; cada escena
 * solo aporta su geometría.
 *
 * ── EL ARRANQUE VA EN TAREAS CORTAS ────────────────────────────────────
 * Montar todo de golpe es una tarea larga del hilo principal, y eso es
 * tiempo de bloqueo aunque ocurra después de que la página cargó. Así que
 * se cede el hilo entre pasos: armar → compilar los sombreadores EN
 * PARALELO (`compileAsync`) → primer cuadro. La evaluación del módulo de
 * three es lo único que no se puede partir, y por eso la puerta
 * (escena-gate.tsx) ni siquiera lo pide hasta que hay alguien mirando.
 *
 * ── NO SE USA PMREM NI RoomEnvironment ─────────────────────────────────
 * Generar un entorno de reflejos cuesta varios cientos de milisegundos de
 * hilo y no hace falta: estas escenas son mate y se resuelven con tres
 * luces. La escena que sí lo pediría —el metal— no existe aquí.
 *
 * ── SOLO DIBUJA CUANDO SE VE ───────────────────────────────────────────
 * Un observador de intersección para la caja y `visibilitychange` para la
 * pestaña. Una pestaña oculta congela igual el rAF en Chrome, pero
 * Firefox y Safari no siempre, y un bucle que sigue girando en segundo
 * plano es batería del visitante.
 * ═══════════════════════════════════════════════════════════════════════
 */

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/** Cede el hilo principal: el siguiente paso del arranque va en otra tarea. */
export function cedeElHilo(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(() => resolve(), { timeout: 700 });
    } else {
      window.setTimeout(resolve, 16);
    }
  });
}

/** Sombra de contacto barata: un degradado radial, nada de mapas de sombra. */
export function texturaSombra(): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(8,12,24,0.55)");
  g.addColorStop(1, "rgba(8,12,24,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface ContextoEscena {
  renderer: THREE.WebGLRenderer;
  ancho: number;
  alto: number;
  /** Registra algo que hay que liberar al desmontar. Devuelve lo mismo. */
  guarda: <T extends { dispose: () => void }>(x: T) => T;
  /** true si el contexto es WebGL 2 (hace falta para texturas 3D). */
  webgl2: boolean;
}

export interface Escena3D {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Un cuadro. `dt` en segundos (tope 50 ms), `t` es el tiempo acumulado. */
  frame: (dt: number, t: number) => void;
  /** Reencuadre al cambiar de tamaño. Se llama una vez al arrancar. */
  encuadre?: (ancho: number, alto: number) => void;
}

export interface OpcionesEscena {
  onReady: () => void;
  onFail: () => void;
  /** Tope de densidad de píxeles. Menor = más barato de pintar. */
  dprMax?: number;
  /** true = la escena no funciona sin WebGL 2 (textura 3D). */
  exigeWebgl2?: boolean;
}

/**
 * Monta una escena en un `<canvas>` y devuelve la referencia para pintarlo.
 *
 * `onReady` se llama con el PRIMER cuadro ya dibujado, que es cuando el
 * anfitrión puede fundir la imagen estática. `onFail` en cualquier tropiezo
 * (sin contexto, sombreador que no compila, contexto perdido): la imagen
 * estática sigue debajo, intacta, y vuelve a verse.
 */
export function useEscena3D(
  construir: (ctx: ContextoEscena) => Escena3D | Promise<Escena3D>,
  { onReady, onFail, dprMax = 1.75, exigeWebgl2 = false }: OpcionesEscena,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const construirRef = useRef(construir);
  const readyRef = useRef(onReady);
  const failRef = useRef(onFail);
  construirRef.current = construir;
  readyRef.current = onReady;
  failRef.current = onFail;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;

    let cancelado = false;
    const basura: Array<{ dispose: () => void }> = [];
    const guarda = <T extends { dispose: () => void }>(x: T): T => {
      basura.push(x);
      return x;
    };
    let renderer: THREE.WebGLRenderer | null = null;
    let apagaBucle: () => void = () => {};

    const arranca = async () => {
      const ancho = Math.max(1, wrap.clientWidth);
      const alto = Math.max(1, wrap.clientHeight);

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
      const webgl2 = renderer.capabilities.isWebGL2;
      if (exigeWebgl2 && !webgl2) throw new Error("hace falta WebGL 2");

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprMax));
      renderer.setSize(ancho, alto, false);
      renderer.setClearColor(0x000000, 0);
      // Neutral y no ACES: conserva el índigo del panel sin lavarlo.
      renderer.toneMapping = THREE.NeutralToneMapping;

      const esc = await construirRef.current({ renderer, ancho, alto, guarda, webgl2 });
      if (cancelado) return;

      const encuadra = () => {
        if (!renderer) return;
        const w = Math.max(1, wrap.clientWidth);
        const h = Math.max(1, wrap.clientHeight);
        renderer.setSize(w, h, false);
        esc.encuadre?.(w, h);
      };
      encuadra();

      // Sombreadores en paralelo, sin bloquear el hilo.
      await cedeElHilo();
      if (cancelado) return;
      await renderer.compileAsync(esc.scene, esc.camera);
      if (cancelado) return;

      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(encuadra) : null;
      ro?.observe(wrap);

      // El reloj es un par de números y no THREE.Clock: esa clase está
      // marcada como obsoleta en la versión de three del repo y avisa por
      // consola en cada montaje. Lo único que hacía falta —el tiempo entre
      // cuadros, con tope para que volver a una pestaña no dé un salto— son
      // estas tres líneas.
      let anterior = 0;
      let raf = 0;
      let corriendo = false;
      let listo = false;
      let aLaVista = true;
      let acumulado = 0;

      const cuadro = (ahora: number) => {
        raf = requestAnimationFrame(cuadro);
        if (!renderer) return;
        const dt = anterior === 0 ? 0.016 : Math.min((ahora - anterior) / 1000, 0.05);
        anterior = ahora;
        acumulado += dt;
        esc.frame(dt, acumulado);
        renderer.render(esc.scene, esc.camera);
        if (!listo) {
          listo = true;
          readyRef.current();
        }
      };
      const arrancaBucle = () => {
        if (corriendo) return;
        corriendo = true;
        anterior = 0; // el primer cuadro tras una pausa no acumula el hueco
        raf = requestAnimationFrame(cuadro);
      };
      const paraBucle = () => {
        if (!corriendo) return;
        corriendo = false;
        cancelAnimationFrame(raf);
      };
      const sincroniza = () => {
        if (aLaVista && !document.hidden) arrancaBucle();
        else paraBucle();
      };
      const io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver(
              (entries) => {
                aLaVista = entries.some((e) => e.isIntersecting);
                sincroniza();
              },
              { threshold: 0.02 },
            )
          : null;
      io?.observe(wrap);
      document.addEventListener("visibilitychange", sincroniza);

      const perdido = (e: Event) => {
        e.preventDefault();
        paraBucle();
        failRef.current();
      };
      canvas.addEventListener("webglcontextlost", perdido);

      apagaBucle = () => {
        paraBucle();
        io?.disconnect();
        ro?.disconnect();
        document.removeEventListener("visibilitychange", sincroniza);
        canvas.removeEventListener("webglcontextlost", perdido);
      };
      sincroniza();
    };

    arranca().catch(() => {
      if (!cancelado) failRef.current();
    });

    return () => {
      cancelado = true;
      apagaBucle();
      for (const d of basura) d.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = null;
      }
    };
    // Se monta una vez: las devoluciones de llamada viajan por referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dprMax, exigeWebgl2]);

  return canvasRef;
}
