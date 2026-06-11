// ─────────────────────────────────────────────────────────────────────────────
// A2 — Avatares remotos (los demás usuarios) + interpolación suave. Un Group por
// jugador; sync() reconcilia altas/bajas/targets; update(dt) interpola. NO
// colisionan contigo ni se renderiza tu propio avatar (el orquestador ya
// excluye tu key vía multiplayer).
//
// TODO(A2): implementar createRemoteAvatars según este brief.
//
// AVATAR (estilo "doctor" de la v1, ver live-layer.ts makeAvatar): cápsula con
//   BATA BLANCA + esfera cabeza tono piel + media esfera de cabello; color del
//   jugador (RemotePlayerState.color, estable por nombre) como acento (cuello/
//   banda/zapatos), para distinguirlos entre sí. Placa de nombre con
//   makeNamePlateSprite(name, color) de three-helpers (Sprite → siempre de cara
//   a cámara, sin billboard manual), a ~2.1 m. castShadow en cuerpo.
//
// sync(players): reconcilia un Map<id, nodo>:
//   - id nuevo → crea avatar, lo añade al group, fija target = pos actual (sin
//     lerp el primer frame: aparece en su sitio, no en el origen). fade-in
//     opcional (opacity 0→1) en update.
//   - id existente → actualiza target {x,z,yaw}. NO muevas de golpe (lo hace
//     update con lerp).
//   - id que ya no está → márcalo para fade-out y elimínalo tras ~250 ms (o
//     elimínalo directo con disposeObject). NUNCA teleports.
//   Usa .forEach/Array.from, jamás for...of sobre Map.
//
// update(dt): por cada nodo, lerp posición actual→target con factor
//   1 - exp(-dt*1000/LERP_MS) (suave, estable a cualquier fps); lerp del yaw por
//   el camino corto (atan2 de seno/coseno o normaliza la diferencia a [-π,π]).
//   Aplica al group.position (y=0) y group.rotation.y. Avanza fades.
//
// dispose(): disposeObject(group) de three-helpers para cada avatar + dispón las
//   CanvasTextures de las placas (las placas tienen map propio → no compartido).
//   Vacía el Map.
//
// Devuelve { group (name "remote"), sync, update, dispose }.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { LERP_MS, type RemotePlayerState } from "./world-types";
import { disposeObject3D, makeNamePlateSprite } from "./three-helpers";

export interface RemoteAvatars {
  group: THREE.Group;
  sync(players: RemotePlayerState[]): void;
  update(dt: number): void;
  dispose(): void;
}

// ── Paleta del avatar remoto (mismo estilo low-poly que el doctor de v1) ──────
const SKIN = "#e8b894";       // tono piel cabeza
const COAT_WHITE = "#f4f6f8"; // bata blanca
const HAIR = "#3a3f47";       // cabello
const PLATE_Y = 2.1;          // alto flotante de la placa
const FADE_OUT_MS = 250;      // duración del fade-out al desaparecer
const FADE_IN_MS = 200;       // duración del fade-in al aparecer

/** Nodo por jugador: el group, su target a interpolar y el estado de fades. */
interface AvatarNode {
  group: THREE.Group;
  /** Materiales transparentes para animar la opacidad (fade in/out). */
  fadeMats: THREE.Material[];
  /** Placa de nombre (su .map es propio → disponer en cleanup). */
  plate: THREE.Sprite;
  /** Posición/orientación objetivo (de la red). Se interpola hacia ella. */
  target: { x: number; z: number; yaw: number };
  /** true mientras no haya recibido su primer update visual (no lerp aún). */
  fresh: boolean;
  /** Opacidad lógica 0→1; controla fade-in y fade-out. */
  opacity: number;
  /** 0 = normal, 1 = saliendo (cuenta atrás de FADE_OUT_MS para eliminar). */
  removing: boolean;
}

/**
 * Avatar remoto estilo "doctor": cápsula bata blanca + cabeza piel + cabello,
 * con el color del jugador como acento (cuello/banda/zapatos) para distinguir
 * a cada quién. Devuelve el group y los materiales transparentes a animar.
 */
function makeRemoteAvatar(accent: string): {
  group: THREE.Group;
  fadeMats: THREE.Material[];
} {
  const group = new THREE.Group();
  const fadeMats: THREE.Material[] = [];

  // Cuerpo: cápsula bata blanca (mismo gálibo que makeAvatar de live-layer).
  const coat = new THREE.MeshStandardMaterial({
    color: COAT_WHITE,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 10), coat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  fadeMats.push(coat);

  // Banda/cinturón de acento alrededor del torso (color del jugador).
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.6,
    metalness: 0.1,
    transparent: true,
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), accentMat);
  band.position.y = 0.5;
  band.castShadow = true;
  group.add(band);
  fadeMats.push(accentMat);

  // Cuello de acento (anillo bajo la cabeza), mismo color del jugador.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 12), accentMat);
  collar.position.y = 0.86;
  group.add(collar);

  // Cabeza: esfera tono piel.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, metalness: 0, transparent: true }),
  );
  head.position.y = 1.02;
  head.castShadow = true;
  group.add(head);
  fadeMats.push(head.material as THREE.Material);

  // Cabello: media esfera (distingue al avatar de una bata sin cabeza).
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.8, metalness: 0, transparent: true }),
  );
  hair.position.y = 1.06;
  group.add(hair);
  fadeMats.push(hair.material as THREE.Material);

  // Zapatos de acento (dos cajitas al pie), color del jugador.
  for (const dx of [-0.09, 0.09]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), accentMat);
    shoe.position.set(dx, 0.04, 0.02);
    shoe.castShadow = true;
    group.add(shoe);
  }

  return { group, fadeMats };
}

/** Normaliza un ángulo a [-π, π] (para lerp de yaw por el camino corto). */
function shortAngle(diff: number): number {
  let d = diff % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createRemoteAvatars(): RemoteAvatars {
  const group = new THREE.Group();
  group.name = "remote";
  const nodes = new Map<string, AvatarNode>();

  /** Aplica una opacidad a todos los materiales del nodo (fade in/out). */
  function applyOpacity(node: AvatarNode, o: number): void {
    const clamped = o < 0 ? 0 : o > 1 ? 1 : o;
    node.fadeMats.forEach((m) => {
      m.opacity = clamped;
    });
    (node.plate.material as THREE.SpriteMaterial).opacity = clamped;
  }

  function destroyNode(node: AvatarNode): void {
    group.remove(node.group);
    disposeObject3D(node.group);
    // La placa tiene su propia CanvasTexture (no compartida) → disponer el .map.
    const map = (node.plate.material as THREE.SpriteMaterial).map;
    map?.dispose?.();
  }

  return {
    group,

    sync(players) {
      if (!Array.isArray(players)) return;

      // Marca de presencia este frame para detectar bajas.
      const seen = new Set<string>();

      players.forEach((p) => {
        // Ignora datos raros sin lanzar (id obligatorio).
        if (!p || typeof p.id !== "string" || p.id.length === 0) return;
        seen.add(p.id);

        const x = Number.isFinite(p.x) ? p.x : 0;
        const z = Number.isFinite(p.z) ? p.z : 0;
        const yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
        const accent = p.color || "#ffffff";

        const existing = nodes.get(p.id);
        if (existing) {
          // Existente: solo actualiza el target (lo mueve update con lerp).
          existing.target.x = x;
          existing.target.z = z;
          existing.target.yaw = yaw;
          // Si estaba saliendo y vuelve a reportarse, cancela el fade-out.
          if (existing.removing) {
            existing.removing = false;
          }
          return;
        }

        // Alta: crea el avatar y colócalo YA en su sitio (sin lerp el 1er frame).
        const { group: avatar, fadeMats } = makeRemoteAvatar(accent);
        avatar.name = `remote-${p.id}`;
        avatar.position.set(x, 0, z);
        avatar.rotation.y = yaw;

        const plate = makeNamePlateSprite(p.name || "—", accent);
        plate.position.set(0, PLATE_Y, 0);
        avatar.add(plate);

        const node: AvatarNode = {
          group: avatar,
          fadeMats,
          plate,
          target: { x, z, yaw },
          fresh: true,
          opacity: 0, // arranca invisible → fade-in en update
          removing: false,
        };
        applyOpacity(node, 0);
        group.add(avatar);
        nodes.set(p.id, node);
      });

      // Bajas: lo que ya no aparece arranca fade-out (no teleport, no borrado seco).
      nodes.forEach((node, id) => {
        if (!seen.has(id)) node.removing = true;
      });
    },

    update(dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      // Factor de suavizado estable a cualquier fps: 1 - exp(-dt*1000/LERP_MS).
      const k = step > 0 ? 1 - Math.exp((-step * 1000) / LERP_MS) : 0;

      // Itera sobre copia de las keys: podemos eliminar nodos durante el loop.
      Array.from(nodes.keys()).forEach((id) => {
        const node = nodes.get(id);
        if (!node) return;
        const g = node.group;

        if (node.fresh) {
          // Primer frame visible: ya está colocado en su sitio, no interpolar.
          node.fresh = false;
        } else if (k > 0) {
          // Posición: lerp exponencial actual→target.
          g.position.x += (node.target.x - g.position.x) * k;
          g.position.z += (node.target.z - g.position.z) * k;
          // Yaw: lerp por el camino corto (diferencia normalizada a [-π,π]).
          g.rotation.y += shortAngle(node.target.yaw - g.rotation.y) * k;
        }
        g.position.y = 0; // los avatares remotos pisan el suelo

        // Fades: in mientras esté presente, out mientras se esté retirando.
        if (node.removing) {
          node.opacity -= step > 0 ? (step * 1000) / FADE_OUT_MS : 1;
          if (node.opacity <= 0) {
            destroyNode(node);
            nodes.delete(id);
            return;
          }
        } else if (node.opacity < 1) {
          node.opacity += step > 0 ? (step * 1000) / FADE_IN_MS : 1;
          if (node.opacity > 1) node.opacity = 1;
        }
        applyOpacity(node, node.opacity);
      });
    },

    dispose() {
      nodes.forEach((node) => {
        disposeObject3D(node.group);
        // CanvasTexture propia de cada placa (no compartida) → disponer el .map.
        const map = (node.plate.material as THREE.SpriteMaterial).map;
        map?.dispose?.();
      });
      nodes.clear();
      // Por si quedó algo colgando del group raíz.
      disposeObject3D(group);
      group.clear();
    },
  };
}
