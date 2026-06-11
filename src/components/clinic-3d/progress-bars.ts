// ─────────────────────────────────────────────────────────────────────────────
// V3 — A5 — BARRAS DE PROGRESO sobre sillones OCUPADOS. Un billboard por sillón
// (siempre de cara a la cámara) con una barra (now-start)/(end-start) clamp 0-1.
// Se construye una vez (un nodo por ancla de world.chairs) y se MUTA: el estado
// (start/end) entra por poll; el RELLENO se anima cada frame con reloj local (sin
// fetch extra). Visible desde lejos pero DISCRETO (~1.2 m de ancho), sobre la
// placa de nombres (a 2.1 m → la barra va a PROGRESS_BAR_Y = 2.5 m).
//
// TODO(A5): implementar createProgressBars según este brief (reemplaza el stub).
//
// ── CONSTRUCCIÓN (createProgressBars(world)) ─────────────────────────────────
// Por cada ancla en world.chairs crea un sub-Group en (center.x, PROGRESS_BAR_Y,
// center.z), guardado en Map<resourceId, nodo>. Cada nodo (todo billboard: se
// orienta a cámara en update):
//   - track: PlaneGeometry (PROGRESS_BAR_WIDTH × PROGRESS_BAR_HEIGHT) con
//     MeshBasicMaterial oscuro semitransparente (riel de fondo, depthTest:false,
//     transparent, renderOrder alto).
//   - fill: PlaneGeometry del MISMO tamaño, anclado a la IZQUIERDA (desplaza su
//     geometría +0.5 en X local, o usa un pivote) para poder escalar en X desde
//     0→1 sin recentrar. MeshBasicMaterial color PROGRESS_FILL. depthTest:false.
//   - overtimeText: Sprite con CanvasTexture pequeño para "+Xm" (oculto salvo
//     sobretiempo; regenera SOLO cuando cambian los minutos de sobretiempo).
//   Todo arranca .visible=false (solo se muestra en sillones ocupados con datos).
//
// ── setStates(states: Map<resourceId, Chair3DState>) — POR POLL ──────────────
// Por cada nodo busca state = states.get(resourceId). Guarda en el nodo:
//   startMs = Date.parse(state.appointmentStartsAt), endMs =
//   Date.parse(state.appointmentEndsAt). Activo (mostrar) si state.status ===
//   "ocupado" && ambos finitos && endMs > startMs. Si no → nodo.active=false y
//   .visible=false. (No toques aquí el relleno; eso es por frame en update.)
//
// ── update(nowMs, camera) — POR FRAME ────────────────────────────────────────
// Para cada nodo activo:
//   - p = clamp((nowMs - startMs) / (endMs - startMs), 0, 1).
//   - BILLBOARD: nodo.quaternion.copy(camera.quaternion) (mira a cámara).
//   - fill.scale.x = max(p, 0.001); por el anclaje izquierdo la barra crece de
//     izquierda a derecha. Color del relleno por avance: PROGRESS_FILL normal,
//     PROGRESS_FILL_NEAR si p > 0.8.
//   - SOBRETIEMPO (nowMs > endMs): p=1 (barra llena), color PROGRESS_FILL_OVER y
//     PULSA la opacidad/intensidad con sin(nowMs/1000 * 2π * PROGRESS_OVERTIME_HZ);
//     overtimeText visible = `+${Math.floor((nowMs-endMs)/60000)}m` (regenera la
//     textura solo cuando cambia ese entero de minutos; dispón la vieja).
//   - Asegura nodo.visible = active.
// Nodos inactivos: .visible=false (no calcules billboard).
//
// ── dispose() ────────────────────────────────────────────────────────────────
// Traversa group: dispón geometrías/materiales; dispón TODAS las CanvasTextures
// de overtimeText (no las suelta el traverse). Vacía el Map. Cero fugas.
//
// Devuelve { group (name "progress"), setStates, update, dispose }.
//
// GOTCHAS: tsconfig sin ES2015 → NUNCA for...of sobre Map/Set (usa .forEach).
// Reusa el <canvas> de overtimeText por nodo (no realloc). El visor jamás
// crashea por datos raros (fechas inválidas → nodo inactivo, no NaN en escala).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import {
  PROGRESS_BAR_WIDTH,
  PROGRESS_BAR_HEIGHT,
  PROGRESS_BAR_Y,
  PROGRESS_OVERTIME_HZ,
  PROGRESS_FILL,
  PROGRESS_FILL_NEAR,
  PROGRESS_FILL_OVER,
} from "./world-types";
import type { Chair3DState, WorldModel } from "./world-types";

export interface ProgressBars {
  group: THREE.Group;
  /** Aplica estados vivos (start/end por sillón ocupado). Llamar por poll. */
  setStates(states: Map<string, Chair3DState>): void;
  /** Anima relleno + pulso de sobretiempo y orienta el billboard. Por frame. */
  update(nowMs: number, camera: THREE.Camera): void;
  dispose(): void;
}

// ── Geometría de la etiqueta "+Xm" de sobretiempo (Sprite + CanvasTexture) ────
const OT_CANVAS_W = 128; // px del canvas (alta densidad → texto nítido)
const OT_CANVAS_H = 64;
const OT_WORLD_W = 0.5; // ancho del sprite de sobretiempo en metros

// Color del riel oscuro semitransparente (fondo de la barra).
const TRACK_COLOR = "#0b1220";
const TRACK_OPACITY = 0.55;
// renderOrder alto → la barra lee sobre la geometría pero queda discreta.
const RENDER_ORDER = 1000;

/** Estado mutable por sillón (un billboard por ancla de world.chairs). */
interface BarNode {
  resourceId: string;
  node: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  overtimeText: THREE.Sprite;
  overtimeMat: THREE.SpriteMaterial;
  /** <canvas> reusado por nodo (no realloc): se repinta y se crea textura nueva. */
  otCanvas: HTMLCanvasElement;
  otTexture: THREE.CanvasTexture | null;
  /** Entero de minutos de sobretiempo ya pintado (regenera solo si cambia). */
  otMinutes: number;
  /** ¿Mostrar este nodo? (status ocupado + fechas válidas). */
  active: boolean;
  startMs: number;
  endMs: number;
}

/**
 * Repinta el <canvas> reusado del nodo con el texto "+Xm" y devuelve una
 * CanvasTexture NUEVA (panel redondeado rojo translúcido, texto blanco). El
 * caller dispone la textura previa. Nunca lanza.
 */
function makeOvertimeTexture(canvas: HTMLCanvasElement, text: string): THREE.CanvasTexture {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  if (ctx) {
    ctx.clearRect(0, 0, W, H);
    // pastilla de fondo
    const r = 14;
    const x = 4;
    const y = 4;
    const w = W - 8;
    const h = H - 8;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.fillStyle = "rgba(127,17,17,0.88)";
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fill();
    // texto
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 34px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, H / 2 + 2, W - 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function createProgressBars(world: WorldModel): ProgressBars {
  const group = new THREE.Group();
  group.name = "progress";

  // Un nodo billboard por ancla de sillón, indexado por resourceId.
  const nodes = new Map<string, BarNode>();

  const chairs = world.chairs ?? [];
  for (let i = 0; i < chairs.length; i++) {
    const a = chairs[i];
    if (!a || !a.resourceId) continue;

    const node = new THREE.Group();
    node.position.set(a.center.x, PROGRESS_BAR_Y, a.center.z);
    node.visible = false; // solo se muestra en sillones ocupados con datos

    // Riel de fondo (track): plano oscuro semitransparente, centrado.
    const trackMat = new THREE.MeshBasicMaterial({
      color: TRACK_COLOR,
      transparent: true,
      opacity: TRACK_OPACITY,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT),
      trackMat,
    );
    track.renderOrder = RENDER_ORDER;
    node.add(track);

    // Relleno (fill): MISMO tamaño pero anclado a la IZQUIERDA. Desplazamos la
    // geometría +0.5*ancho en X local y colocamos la malla en x = -0.5*ancho;
    // así scale.x crece la barra de izquierda→derecha sin recentrar.
    const fillGeo = new THREE.PlaneGeometry(PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT);
    fillGeo.translate(PROGRESS_BAR_WIDTH / 2, 0, 0);
    const fillMat = new THREE.MeshBasicMaterial({
      color: PROGRESS_FILL,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.x = -PROGRESS_BAR_WIDTH / 2;
    fill.position.z = 0.001; // un pelín delante del riel
    fill.renderOrder = RENDER_ORDER + 1;
    fill.scale.x = 0.001;
    node.add(fill);

    // Etiqueta "+Xm" de sobretiempo (Sprite → siempre mira a cámara). Oculta
    // salvo sobretiempo; su textura se regenera solo cuando cambian los minutos.
    const otCanvas = document.createElement("canvas");
    otCanvas.width = OT_CANVAS_W;
    otCanvas.height = OT_CANVAS_H;
    const overtimeMat = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
    });
    const overtimeText = new THREE.Sprite(overtimeMat);
    overtimeText.position.set(0, PROGRESS_BAR_HEIGHT / 2 + 0.18, 0.002);
    overtimeText.scale.set(OT_WORLD_W, OT_WORLD_W * (OT_CANVAS_H / OT_CANVAS_W), 1);
    overtimeText.renderOrder = RENDER_ORDER + 2;
    overtimeText.visible = false;
    node.add(overtimeText);

    group.add(node);
    nodes.set(a.resourceId, {
      resourceId: a.resourceId,
      node,
      fill,
      fillMat,
      overtimeText,
      overtimeMat,
      otCanvas,
      otTexture: null,
      otMinutes: Number.NaN,
      active: false,
      startMs: Number.NaN,
      endMs: Number.NaN,
    });
  }

  return {
    group,
    setStates(states) {
      // Recorre el Map con .forEach (NUNCA for...of sobre Map/Set).
      nodes.forEach((n) => {
        const st = states.get(n.resourceId);
        const startMs = st?.appointmentStartsAt ? Date.parse(st.appointmentStartsAt) : Number.NaN;
        const endMs = st?.appointmentEndsAt ? Date.parse(st.appointmentEndsAt) : Number.NaN;
        const active =
          !!st &&
          st.status === "ocupado" &&
          Number.isFinite(startMs) &&
          Number.isFinite(endMs) &&
          endMs > startMs;
        n.active = active;
        n.startMs = startMs;
        n.endMs = endMs;
        if (!active) {
          n.node.visible = false;
          n.overtimeText.visible = false;
        }
        // El relleno se anima por frame en update (no aquí).
      });
    },
    update(nowMs, camera) {
      // Recorre el Map con .forEach (NUNCA for...of sobre Map/Set).
      nodes.forEach((n) => {
        if (!n.active) {
          if (n.node.visible) n.node.visible = false;
          return;
        }
        n.node.visible = true;

        // Billboard: orientar el nodo de cara a la cámara.
        n.node.quaternion.copy(camera.quaternion);

        const span = n.endMs - n.startMs; // > 0 garantizado en setStates
        const over = nowMs > n.endMs;

        if (over) {
          // SOBRETIEMPO: barra llena, color rojo, opacidad/intensidad pulsa.
          n.fill.scale.x = 1;
          n.fillMat.color.set(PROGRESS_FILL_OVER);
          const pulse = 0.5 + 0.5 * Math.sin((nowMs / 1000) * 2 * Math.PI * PROGRESS_OVERTIME_HZ);
          n.fillMat.opacity = 0.55 + 0.45 * pulse;

          // Etiqueta "+Xm": regenerar textura solo cuando cambia el entero.
          const minutes = Math.floor((nowMs - n.endMs) / 60000);
          if (minutes !== n.otMinutes) {
            n.otMinutes = minutes;
            const next = makeOvertimeTexture(n.otCanvas, `+${minutes}m`);
            const prev = n.otTexture;
            n.otTexture = next;
            n.overtimeMat.map = next;
            n.overtimeMat.needsUpdate = true;
            if (prev) prev.dispose();
          }
          n.overtimeText.visible = true;
        } else {
          // Avance normal: p ∈ [0,1]; nunca NaN en la escala.
          const p = clamp01((nowMs - n.startMs) / span);
          n.fill.scale.x = Math.max(p, 0.001);
          n.fillMat.color.set(p > 0.8 ? PROGRESS_FILL_NEAR : PROGRESS_FILL);
          n.fillMat.opacity = 1;
          n.overtimeText.visible = false;
        }
      });
    },
    dispose() {
      // Geometrías/materiales del árbol completo.
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        const s = o as unknown as THREE.Sprite;
        if (m.geometry) m.geometry.dispose();
        const mat = (m.material ?? (s.material as unknown)) as
          | THREE.Material
          | THREE.Material[]
          | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
        else mat?.dispose?.();
      });
      // CanvasTextures de sobretiempo de TODOS los nodos (no las suelta el
      // traverse: viven en n.otTexture, no como .map en el momento del dispose).
      nodes.forEach((n) => {
        if (n.otTexture) n.otTexture.dispose();
        n.otTexture = null;
      });
      nodes.clear();
      group.clear();
    },
  };
}
