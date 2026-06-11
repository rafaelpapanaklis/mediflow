// ─────────────────────────────────────────────────────────────────────────────
// V2 — Utilidades three.js compartidas (AO de contacto, placas de nombre,
// dispose). Implementación COMPLETA — los módulos las consumen, no las editan.
// Texturas procedurales ≤512px, cacheadas/reutilizadas. Sin assets externos.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";

// ── Sombra de contacto (AO fake): círculo radial suave bajo muebles/avatares ──
let _shadowTex: THREE.CanvasTexture | null = null;
function contactShadowTexture(): THREE.CanvasTexture {
  if (_shadowTex) return _shadowTex;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.28)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _shadowTex = tex;
  return tex;
}

/**
 * Decal de sombra de contacto sobre el piso. Reusa una sola textura (no la
 * dispongas: es compartida y cacheada a nivel de módulo). Devuelve un Mesh
 * plano horizontal a y≈0.02 listo para posicionar.
 */
export function makeContactShadow(radius = 0.6, opacity = 0.4): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const mat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = 1;
  m.userData.sharedMap = true; // marca: no disponer el .map en cleanup
  return m;
}

// ── Placa de nombre (Sprite con CanvasTexture; siempre de cara a cámara) ──────
/**
 * Crea un Sprite con el nombre sobre un panel redondeado. accent pinta una
 * franja/borde. La textura es propia del sprite → DISPÓNLA al desmontar
 * (sprite.material.map.dispose()).
 */
export function makeNamePlateSprite(text: string, accent = "#ffffff"): THREE.Sprite {
  const w = 256;
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // panel
  ctx.fillStyle = "rgba(15,18,24,0.82)";
  roundRect(ctx, 4, 4, w - 8, h - 8, 14);
  ctx.fill();
  // franja de acento
  ctx.fillStyle = accent;
  roundRect(ctx, 4, 4, w - 8, 7, 4);
  ctx.fill();
  // texto
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 26px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(clip(ctx, text || "—", w - 28), w / 2, h / 2 + 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 1.1 * (h / w), 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

// ── Dispose recursivo (geometrías + materiales + todas sus texturas) ─────────
/**
 * Libera un subárbol. Respeta userData.sharedMap (no dispone texturas
 * compartidas como la sombra de contacto). Úsalo en el dispose de cada módulo.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const sprite = o as unknown as THREE.Sprite;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh.material ?? (sprite.material as unknown)) as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    const shared = o.userData?.sharedMap === true;
    const one = (x: THREE.Material | undefined) => {
      if (!x) return;
      const mm = x as THREE.MeshStandardMaterial & Record<string, unknown>;
      if (!shared) {
        mm.map?.dispose?.();
        (mm.emissiveMap as THREE.Texture | undefined)?.dispose?.();
        (mm.normalMap as THREE.Texture | undefined)?.dispose?.();
        (mm.roughnessMap as THREE.Texture | undefined)?.dispose?.();
        (mm.metalnessMap as THREE.Texture | undefined)?.dispose?.();
        (mm.aoMap as THREE.Texture | undefined)?.dispose?.();
        (mm.alphaMap as THREE.Texture | undefined)?.dispose?.();
      }
      x.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(one);
    else one(mat);
  });
}
