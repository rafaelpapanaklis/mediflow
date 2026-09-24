/* ============================================================
   tooth3d-marks — traduce el registro de un diente (record.surfaces +
   record.tooth) a un "plan" visual para el modelo 3D:

   - color y estilo por región (O/I · M · D · V · L · raíz) para el shader
     de tooth3d-paint;
   - qué partes se ocultan (raíz con implante/póntico, corona con resto
     radicular, ápice con apicectomía) y cuánto se "fantasmea" (ausente,
     no erupcionado/impactado);
   - objetos extra dentro del grupo del diente (metros): aspas, insignias,
     implante, lesiones apicales, bracket, anillo del cuello, fractura.

   Los colores salen SIEMPRE de COND_BY_ID / GROUP_COLOR (data.ts).
   La lógica visual sigue la de Surface2D / ToothGlyph: el hallazgo de
   cara más reciente manda en su cara; los de diente entero pintan lo que
   ninguna cara ha reclamado.
   ============================================================ */
import * as THREE from "three";
import type { ToothMeta, ToothRecord, Condition } from "./types";
import { COND_BY_ID, GROUP_COLOR, SURFACES } from "./data";
import { faceSlotOf, type FaceInfo } from "./tooth3d-faces";
import { STYLE_FILL, STYLE_OUTLINE, STYLE_STIPPLE, STYLE_DOTS, STYLE_BAND } from "./tooth3d-paint";

export interface ToothPlan {
  faceColor: THREE.Vector4[];
  faceStyle: number[];
  hideRoot: boolean;
  hideCrown: boolean;
  /** altura (hacia la punta, m) por debajo de la cual se corta; −1e9 = no cortar */
  apexH: number;
  ghost: number;
  opacity: number;
  /** anchura de banda cervical por región (m), estilo 4 */
  bandM: number[];
  marks: THREE.Object3D[];
}

const MM = 0.001;
const STEEL = "#64748b";
const MISSING_GRAY = "#6b7280";
const HATCH_GRAY = "#9aa3af"; // misma trama gris que OdoDefs (no erupcionado / impactado)

function rgba(hex: string, a: number): THREE.Vector4 {
  const c = new THREE.Color(hex);
  return new THREE.Vector4(c.r, c.g, c.b, a);
}

function styleOf(c: Condition): number {
  if (c.render === "outline") return STYLE_OUTLINE;
  if (c.render === "stipple") return STYLE_STIPPLE;
  if (c.render === "dots") return STYLE_DOTS;
  return STYLE_FILL;
}

/* ---------- sprites (canvas) ---------- */
function canvasSprite(draw: (ctx: CanvasRenderingContext2D, size: number) => void, sizeM: number, size = 256): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = size; cv.height = size;
  const ctx = cv.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(sizeM, sizeM, 1);
  sp.renderOrder = 5;
  return sp;
}

function crossSprite(color: string, sizeM: number, dashed: boolean, alpha: number): THREE.Sprite {
  return canvasSprite((ctx, s) => {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = s * 0.07; ctx.lineCap = "round";
    if (dashed) ctx.setLineDash([s * 0.09, s * 0.07]);
    ctx.beginPath(); ctx.moveTo(s * 0.12, s * 0.12); ctx.lineTo(s * 0.88, s * 0.88);
    ctx.moveTo(s * 0.88, s * 0.12); ctx.lineTo(s * 0.12, s * 0.88); ctx.stroke();
  }, sizeM);
}

function fractureSprite(color: string, sizeM: number): THREE.Sprite {
  return canvasSprite((ctx, s) => {
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.05; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    [[0.5, 0.06], [0.38, 0.36], [0.6, 0.55], [0.44, 0.9]].forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    ctx.stroke();
  }, sizeM);
}

/* Iconos: mismos trazos que Surface2D.glyphIcon (espacio ±16), vía Path2D */
const ICON_PATHS: Record<string, { d: string; fill?: boolean }> = {
  rotate: { d: "M-14 -4 a14 14 0 1 1 4 12 M-14 -12 v8 h8" },
  displace: { d: "M-16 0 H16 M10 -6 l6 6 -6 6 M-10 -6 l-6 6 6 6" },
  drop: { d: "M0 -16 C 10 -2 12 4 0 14 C -12 4 -10 -2 0 -16 Z", fill: true },
  sparkle: { d: "M0 -14 V14 M-14 0 H14 M-9 -9 L9 9 M9 -9 L-9 9" },
  probe: { d: "M0 -15 V13 M-7 13 H7 M-5 -15 H5" },
  furca: { d: "M0 -14 V2 M0 2 L-12 14 M0 2 L12 14" },
  diastema: { d: "M-12 -12 V12 M12 -12 V12 M-5 0 h10 M2 -4 l4 4 -4 4 M-2 -4 l-4 4 4 4" },
  maintainer: { d: "M-4 0 a5 5 0 1 0 -10 0 a5 5 0 1 0 10 0 M14 0 a5 5 0 1 0 -10 0 a5 5 0 1 0 10 0 M-4 0 H4" },
};

function badgeSprite(kind: "badge" | "roman" | "icon", text: string, color: string, sizeM: number): THREE.Sprite {
  return canvasSprite((ctx, s) => {
    const c = s / 2, r = s * 0.42;
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
    if (kind === "roman") { ctx.fillStyle = color; ctx.fill(); }
    else { ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.lineWidth = s * 0.05; ctx.strokeStyle = color; ctx.stroke(); }
    if (kind === "icon") {
      const ic = ICON_PATHS[text];
      if (!ic) return;
      ctx.save(); ctx.translate(c, c); ctx.scale(s / 64, s / 64);
      const p = new Path2D(ic.d);
      if (ic.fill) { ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fill(p); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 3.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(p); }
      ctx.restore();
      return;
    }
    ctx.fillStyle = kind === "roman" ? "#ffffff" : color;
    ctx.font = `800 ${Math.round(s * (kind === "roman" ? 0.38 : 0.5))}px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, c, c + s * 0.02);
  }, sizeM);
}

/* ---------- mallas auxiliares ---------- */
function implantMesh(info: FaceInfo, color: string): THREE.Group {
  const g = new THREE.Group();
  const rootLen = Math.max(4 * MM, info.length - info.crownLen);
  const h = rootLen * 0.85;
  const rTop = Math.min(info.halfX, info.halfZ) * 0.42, rBot = rTop * 0.35;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.38 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 24), mat);
  // eje Y: la raíz está hacia −tipSign
  body.position.y = info.neckY - info.tipSign * (h / 2 + 0.3 * MM);
  g.add(body);
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    const r = rTop + (rBot - rTop) * t;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.12, 8, 28), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = info.neckY - info.tipSign * (0.3 * MM + h * t);
    g.add(ring);
  }
  return g;
}

function sphereAt(p: THREE.Vector3, r: number, color: string, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 20, 14),
    new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, roughness: 0.6 }),
  );
  m.position.copy(p);
  return m;
}

/** Libera geometrías, materiales y texturas de un subárbol de marcas. */
export function disposeObject(o: THREE.Object3D) {
  o.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose();
    const om = obj.material;
    if (om) {
      const mats = Array.isArray(om) ? om : [om];
      mats.forEach((mat: any) => { if (mat.map) mat.map.dispose(); mat.dispose(); });
    }
  });
}

export function buildToothPlan(record: ToothRecord, meta: ToothMeta, info: FaceInfo): ToothPlan {
  const faceColor = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0));
  const faceStyle = [STYLE_FILL, STYLE_FILL, STYLE_FILL, STYLE_FILL, STYLE_FILL, STYLE_FILL];
  const claimed = [false, false, false, false, false, false];
  const plan: ToothPlan = {
    faceColor, faceStyle, hideRoot: false, hideCrown: false, apexH: -1e9,
    ghost: 0, opacity: 1, bandM: [2 * MM, 2 * MM, 2 * MM, 2 * MM, 2 * MM, 2 * MM], marks: [],
  };
  const setFace = (slot: number, hex: string, alpha: number, style: number, bandM?: number) => {
    if (slot < 0 || claimed[slot]) return;
    faceColor[slot].copy(rgba(hex, alpha));
    faceStyle[slot] = style;
    if (bandM != null) plan.bandM[slot] = bandM;
    claimed[slot] = true;
  };

  // 1) caras: manda el último hallazgo de cada una
  const letters = meta.posterior ? SURFACES.posterior : SURFACES.anterior;
  letters.forEach((letter) => {
    const arr = (record.surfaces || {})[letter];
    if (!arr || !arr.length) return;
    const c = COND_BY_ID[arr[arr.length - 1]];
    if (!c) return;
    setFace(faceSlotOf(letter), GROUP_COLOR[c.group], c.render === "outline" ? 0.95 : 0.85, styleOf(c));
  });

  // 2) diente entero
  const conds = (record.tooth || []).map((id) => COND_BY_ID[id]).filter(Boolean);
  const crownSlots = [0, 1, 2, 3, 4];
  const ROOT = 5;
  const crownCenter = info.centroids[0].clone();
  const crownMid = new THREE.Vector3(0, info.neckY + info.tipSign * info.crownLen * 0.5, 0);
  let badgeN = 0;
  const badgeSize = 3.2 * MM;
  const addBadge = (sp: THREE.Sprite) => {
    // en fila junto a la raíz, por el lado distal (la raíz es más estrecha que la corona)
    sp.position.set(-info.mesialSign * (info.halfX + 2.4 * MM), info.neckY - info.tipSign * (2 * MM + badgeN * 3.4 * MM), 0);
    badgeN++;
    plan.marks.push(sp);
  };

  for (const c of conds) {
    const col = GROUP_COLOR[c.group];
    switch (c.render) {
      case "ring": {
        const hex = c.steel ? STEEL : col;
        if (c.band) crownSlots.forEach((s) => setFace(s, hex, 0.8, STYLE_BAND, 2 * MM));
        else crownSlots.forEach((s) => setFace(s, hex, 0.55, STYLE_FILL));
        break;
      }
      case "veneer":
        setFace(3, col, 0.6, STYLE_FILL);
        break;
      case "pontic":
        crownSlots.forEach((s) => setFace(s, col, 0.5, STYLE_FILL));
        plan.hideRoot = true;
        break;
      case "endo":
        if (c.partial) setFace(ROOT, col, 0.7, STYLE_BAND, 2.5 * MM);
        else setFace(ROOT, col, 0.55, c.dashed ? STYLE_DOTS : STYLE_FILL);
        break;
      case "post":
        setFace(ROOT, col, 0.6, STYLE_BAND, (info.length - info.crownLen) * 0.5);
        break;
      case "recession":
        setFace(ROOT, col, 0.6, STYLE_BAND, 1.8 * MM);
        break;
      case "missing": {
        plan.ghost = 1; plan.opacity = 0.35;
        const x = crossSprite(MISSING_GRAY, info.length * 0.7, false, 0.9);
        x.position.set(0, 0, 0);
        plan.marks.push(x);
        break;
      }
      case "cross": {
        const x = crossSprite(col, info.crownLen * 1.7, !!c.soft, c.soft ? 0.75 : 1);
        x.position.copy(crownMid);
        plan.marks.push(x);
        break;
      }
      case "hatch":
        plan.ghost = Math.max(plan.ghost, 0.6); plan.opacity = Math.min(plan.opacity, 0.7);
        for (let s = 0; s < 6; s++) setFace(s, HATCH_GRAY, 0.6, STYLE_STIPPLE);
        break;
      case "implant":
        plan.hideRoot = true;
        plan.marks.push(implantMesh(info, col));
        break;
      case "apical":
        info.apices.forEach((p) => plan.marks.push(sphereAt(p, (0.9 + (c.mm ?? 1) * 0.55) * MM, col, 0.6)));
        break;
      case "remnant": {
        plan.hideCrown = true;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(info.halfX, info.halfZ) * 0.98, 0.18 * MM, 8, 48),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = info.neckY;
        plan.marks.push(ring);
        break;
      }
      case "apico": {
        let hMin = Infinity;
        info.apices.forEach((p) => { hMin = Math.min(hMin, info.tipSign * p.y); });
        plan.apexH = hMin + 3 * MM;
        info.apices.forEach((p) => {
          const q = p.clone(); q.y = info.tipSign * (plan.apexH + 0.2 * MM);
          plan.marks.push(sphereAt(q, 0.9 * MM, col, 0.85));
        });
        break;
      }
      case "fracture": {
        const f = fractureSprite(col, info.crownLen * 1.15);
        f.position.copy(crownCenter).setY(crownMid.y);
        plan.marks.push(f);
        break;
      }
      case "bracket": {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(2.6 * MM, 2.6 * MM, 1.2 * MM),
          new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.35 }),
        );
        b.position.copy(info.buccalPoint).add(new THREE.Vector3(0, 0, 0.5 * MM));
        plan.marks.push(b);
        break;
      }
      case "badge":
        addBadge(badgeSprite("badge", c.letter || "?", col, badgeSize));
        break;
      case "roman":
        addBadge(badgeSprite("roman", ["", "I", "II", "III"][c.degree ?? 0] || "I", col, badgeSize));
        break;
      case "icon":
        addBadge(badgeSprite("icon", c.icon || "", col, badgeSize));
        break;
      default:
        break;
    }
  }

  return plan;
}
