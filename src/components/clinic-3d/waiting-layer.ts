// ─────────────────────────────────────────────────────────────────────────────
// V3 — A3+A4 — SALA DE ESPERA VIVA + LLAMADO ANIMADO. Un solo módulo dueño de:
//   (A3) avatares SENTADOS en los muebles de espera (silla_espera=1, banca=3),
//   (A4) "walkers": cuando a un paciente lo llaman, se LEVANTA y CAMINA hasta su
//        sillón con balanceo de piernas/brazos, y al llegar hace fade-out.
// Es PURAMENTE visual: la data del poll SIEMPRE manda; un walker jamás contradice
// el estado. Se construye una vez (pool de asientos del layout) y se MUTA por poll.
//
// TODO(A3/A4): implementar createWaitingLayer según este brief (reemplaza stub).
//
// ── CONSTRUCCIÓN (createWaitingLayer(world)) ─────────────────────────────────
// 1) SLOTS de espera: recorre world.elements; por cada uno con
//    isWaitingSeatType(el.type) (silla_espera / banca) genera sus plazas:
//    - silla_espera: 1 plaza en el centro del elemento (el.center).
//    - banca (3 plazas a lo largo de su ANCHO): la banca sin rotar es 3×1
//      (cols a lo largo de X). Plazas en offsets locales X = {-1, 0, +1}, Z=0
//      respecto al centro; rota cada offset por el.rotationRad y súmalo a
//      el.center → 3 posiciones de mundo. (Genérico: nº de plazas =
//      seatCapacityFor(type); distribúyelas a lo largo del eje más largo del
//      footprint base, centradas.)
//    Cada slot guarda { x, z, yaw } donde yaw = el.rotationRad (el sentado mira
//    "hacia afuera" del respaldo; usa el.rotationRad, ajusta +π si hace falta
//    para que NO mire al respaldo — elige el signo que se vea sentado al frente).
//    ORDENA los slots de forma DETERMINISTA por (z, x) (row-major) para que la
//    asignación orden-de-llegada→plaza sea estable entre polls.
// 2) RECEPCIÓN (para los que sobran de pie): busca un elemento type "mostrador";
//    si existe, ancla el grupo de pie ~1.2 m frente a su centro (hacia el centro
//    de world.bounds); si no, usa world.spawn. Guarda este ancla.
// 3) POOL de avatares SENTADOS: crea hasta `slots.length` avatares sentados
//    (geometría/material COMPARTIDOS vía un pool; reutiliza, no recrees por poll)
//    y colócalos ocultos. Avatar sentado = variante del paciente de live-layer:
//    cápsula torso vertical + esfera cabeza piel + DOS muslos horizontales y
//    DOS pantorrillas hacia abajo (piernas dobladas, pose sentada) en boxes/
//    cápsulas finas. Ropa neutra #6b7280. Placa de nombre opcional con
//    makeNamePlateSprite(name) de three-helpers a ~1.7 m (más baja que la del
//    sillón). castShadow en el torso.
//
// ── setWaiting(waiting: WaitingPatient[], chairStates) — POR POLL ────────────
// Detecta el LLAMADO comparando con el waiting ANTERIOR (guarda prevWaiting):
// 1) Para cada appointmentId que estaba en prevWaiting y YA NO está en waiting:
//    - Destino: si su entrada previa traía resourceId R y world.chairs tiene un
//      ancla con ese resourceId → destino = center de ese ancla. Si no, intenta
//      casar por patientName con un chairState status "ocupado" del mismo nombre
//      → destino = su ancla. Si no hay destino conocido → NO camina (su sentado
//      simplemente se oculta; ya no está esperando).
//    - Si hay destino Y conocíamos su plaza (posición sentada): SPAWNEA un walker
//      desde esa plaza hasta el destino con findPath(world, asiento, destino).
//        · Si findPath devuelve ruta → walker la sigue.
//        · Si devuelve null → walker hace fade-out en el sitio y fade-in NO (o un
//          salto directo): NUNCA se bloquea ni queda colgado.
//      El walker arranca con fade-in (aparece de pie en la plaza) y al llegar
//      (WALKER_ARRIVE_DIST) hace fade-out y se libera.
// 2) Reasigna sentados: ordena `waiting` por orden de llegada (ya viene así de la
//    API) y asígnalos a slots[0..N). Los primeros slots.length pacientes →
//    sentados (mueve un avatar del pool a esa plaza, visible, placa con su
//    nombre); el resto (extras) → de pie en grupo cerca del ancla de recepción
//    (cluster compacto: rejilla ~0.6 m de separación). Oculta los avatares del
//    pool que sobren. Cachea el nombre por avatar para no regenerar la placa si
//    no cambió (dispón la textura vieja al cambiar — evita fuga).
// 3) Si un appointmentId con walker activo REAPARECE en waiting → cancela su
//    walker (la data manda: vuelve a estar sentado).
// 4) Guarda waiting como prevWaiting (mapa appointmentId → {patientName, resourceId,
//    seat}) para el siguiente poll.
//
// ── update(dt) — POR FRAME ───────────────────────────────────────────────────
// Anima cada walker: avanza por sus waypoints a AVATAR_WALK_SPEED (m/s); orienta
// el yaw hacia el waypoint actual (lerp corto). Balanceo: piernas/brazos rotan
// con sin(t * 2π * WALK_BOB_HZ) (fase por walker); leve bob vertical del cuerpo.
// Avanza fades (in/out) con WALKER_FADE_MS. Al terminar el último waypoint
// (o tras fade-out) libera el walker (devuelve su avatar al pool o dispóngalo).
// Los sentados no se animan (o micro-bob opcional). Sin timers globales aquí.
//
// ── dispose() ────────────────────────────────────────────────────────────────
// disposeObject3D(group) (three-helpers) + dispón placas (CanvasTexture propia,
// NO compartida). Vacía pools y mapas. Cero fugas.
//
// Devuelve { group (name "waiting"), setWaiting, update, dispose }. El walker es
// fantasma: no colisiona con nadie. Varios walkers a la vez = cada uno su ruta.
//
// GOTCHAS: tsconfig sin ES2015 target → NUNCA for...of sobre Map/Set; usa
// .forEach / Array.from / for clásico sobre arrays. Reusa geometrías/materiales
// (pool) — no crees por poll. El visor jamás crashea por datos raros (waiting no
// array, nombres vacíos, slots 0): degrada a vacío.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import {
  AVATAR_WALK_SPEED,
  WALKER_FADE_MS,
  WALKER_ARRIVE_DIST,
  WALK_BOB_HZ,
  isWaitingSeatType,
  seatCapacityFor,
  type Chair3DState,
  type WaitingPatient,
  type WorldElement,
  type WorldModel,
} from "./world-types";
import { findPath } from "./pathfinding";
import { makeNamePlateSprite, disposeObject3D } from "./three-helpers";

export interface WaitingLayer {
  group: THREE.Group;
  /** Aplica el nuevo set de pacientes en espera; detecta llamados (transiciones). */
  setWaiting(waiting: WaitingPatient[], chairStates: Map<string, Chair3DState>): void;
  /** Anima walkers (caminar + balanceo) y fades. Llamar por frame. */
  update(dt: number): void;
  dispose(): void;
}

// ── Paleta del paciente (igual que live-layer para coherencia visual) ─────────
const CLOTH_PATIENT = "#6b7280"; // ropa neutra
const SKIN = "#e8b894";          // tono piel
const PLATE_SEAT_Y = 1.7;        // alto de placa del sentado (más baja que sillón 2.1)
const PLATE_WALK_Y = 1.95;       // alto de placa del walker (de pie)
const STAND_GAP = 0.6;           // separación de la rejilla de los que están de pie
const RECEPTION_OFFSET = 1.2;    // m frente al mostrador hacia el centro del mundo
const FADE_S = WALKER_FADE_MS / 1000;

/** Una plaza de espera en el mundo. */
interface Slot {
  x: number;
  z: number;
  yaw: number; // mirando "hacia afuera" del respaldo
}

/** Entrada del waiting anterior, para detectar llamados entre polls. */
interface PrevEntry {
  patientName: string;
  resourceId: string | null;
  /** Plaza donde estaba sentado (si lo estaba) → origen del walker. */
  seat: { x: number; z: number } | null;
}

/** Un avatar sentado del pool (reutilizable; geometría/material compartidos). */
interface SeatedAvatar {
  group: THREE.Group;
  plate: THREE.Sprite | null;
  plateText: string; // texto cacheado (no regenerar si no cambió)
}

/** Un walker activo: avatar de pie con extremidades que se balancean. */
interface Walker {
  appointmentId: string;
  group: THREE.Group;
  /** Materiales que llevan opacity (para el fade). */
  fadeMats: THREE.Material[];
  /** Extremidades a rotar cada frame. */
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  body: THREE.Object3D; // para micro-bob vertical
  plate: THREE.Sprite | null;
  /** Waypoints en mundo (incluye origen exacto y destino exacto). */
  path: { x: number; z: number }[];
  wp: number;         // índice del waypoint objetivo actual
  phase: number;      // fase del balanceo (rad)
  fade: number;       // 0..1 opacidad actual
  state: "in" | "walk" | "out"; // fase de vida
}

export function createWaitingLayer(world: WorldModel): WaitingLayer {
  const group = new THREE.Group();
  group.name = "waiting";

  // ── Recursos COMPARTIDOS por esta instancia (un set reusado por todos los
  // avatares; se disponen UNA vez en dispose). Evita realloc por poll/avatar. ──
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  // Geometrías compartidas (low-poly).
  const torsoGeo = track(new THREE.CapsuleGeometry(0.18, 0.5, 4, 10));
  const headGeo = track(new THREE.SphereGeometry(0.15, 12, 10));
  const thighGeo = track(new THREE.BoxGeometry(0.13, 0.12, 0.32)); // muslo horizontal (largo en Z)
  const shinGeo = track(new THREE.BoxGeometry(0.12, 0.34, 0.12));  // pantorrilla hacia abajo
  const limbGeo = track(new THREE.CapsuleGeometry(0.06, 0.34, 3, 6)); // pierna/brazo del walker
  const armGeo = track(new THREE.CapsuleGeometry(0.05, 0.3, 3, 6));

  // Materiales compartidos. Los del walker necesitan transparencia para el fade,
  // pero el sentado NO comparte material con el walker porque el walker muta
  // opacity en vivo. Mantén dos juegos: estático (sentado) y fade (walker).
  const clothMat = trackMat(new THREE.MeshStandardMaterial({ color: CLOTH_PATIENT, roughness: 0.85, metalness: 0 }));
  const skinMat = trackMat(new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, metalness: 0 }));

  // ── 1) SLOTS de espera desde el layout ──────────────────────────────────────
  const slots: Slot[] = [];
  const elements = Array.isArray(world?.elements) ? world.elements : [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || !isWaitingSeatType(el.type)) continue;
    const cap = seatCapacityFor(el.type);
    if (cap <= 0) continue;
    const cx = el.center?.x ?? 0;
    const cz = el.center?.z ?? 0;
    const rot = Number.isFinite(el.rotationRad) ? el.rotationRad : 0;
    // Plazas a lo largo del eje base más largo del footprint (sin rotar).
    const baseCols = el.baseCols ?? 1;
    const baseRows = el.baseRows ?? 1;
    const alongX = baseCols >= baseRows; // banca 3×1 → a lo largo de X
    const span = (alongX ? baseCols : baseRows);
    // Offsets locales centrados: para cap plazas en `span` celdas → paso = 1 celda
    // si span==cap (banca), si cap==1 → 0. Centrado: índices - (cap-1)/2.
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    // El sentado mira hacia afuera del respaldo: +π respecto a rotationRad para
    // que NO mire al respaldo (el respaldo de la silla queda atrás del avatar).
    const yaw = rot + Math.PI;
    for (let s = 0; s < cap; s++) {
      const t = cap === 1 ? 0 : s - (cap - 1) / 2; // -1,0,+1 para banca
      // Distribuye a lo largo del eje largo manteniendo el paso ≈1 celda pero sin
      // salirse: factor = (span-? )/cap → usa el paso natural de 1 celda salvo que
      // el span sea menor (cap==span en bancas reales, así que paso = 1).
      const step = cap >= 2 ? (span - 1) / (cap - 1) : 0;
      const local = t * step; // posición local sobre el eje largo, centrada en 0
      const lx = alongX ? local : 0;
      const lz = alongX ? 0 : local;
      // Rota el offset local por la rotación del elemento (Y-up: x'=x·cos - z·sin
      // sería para rad estándar; aquí rotationRad ya es negativo grilla→three, así
      // que aplicamos la rotación 2D estándar y queda consistente con el resto).
      const wx = cx + lx * cosR - lz * sinR;
      const wz = cz + lx * sinR + lz * cosR;
      slots.push({ x: wx, z: wz, yaw });
    }
  }
  // ORDEN DETERMINISTA row-major (z luego x) → asignación estable entre polls.
  slots.sort((a, b) => (a.z - b.z) || (a.x - b.x));

  // ── 2) ANCLA de recepción (para los que sobran de pie) ──────────────────────
  let reception = { x: 0, z: 0 };
  let mostrador: WorldElement | null = null;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i]?.type === "mostrador") {
      mostrador = elements[i];
      break;
    }
  }
  const bounds = world?.bounds;
  if (mostrador) {
    const mx = mostrador.center?.x ?? 0;
    const mz = mostrador.center?.z ?? 0;
    // Centro del mundo (bbox de lo construido) para empujar el grupo "hacia adentro".
    const bcx = bounds ? (bounds.minX + bounds.maxX) / 2 : mx;
    const bcz = bounds ? (bounds.minZ + bounds.maxZ) / 2 : mz;
    let dx = bcx - mx;
    let dz = bcz - mz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      dx /= d;
      dz /= d;
    } else {
      dz = 1; // sin dirección clara → un metro "hacia +z"
    }
    reception = { x: mx + dx * RECEPTION_OFFSET, z: mz + dz * RECEPTION_OFFSET };
  } else if (world?.spawn) {
    reception = { x: world.spawn.x, z: world.spawn.z };
  }

  // ── 3) POOL de avatares SENTADOS (hasta slots.length, ocultos) ──────────────
  const seatedPool: SeatedAvatar[] = [];
  function buildSeated(): SeatedAvatar {
    const g = new THREE.Group();
    // Torso vertical (sentado: un poco más bajo que de pie).
    const torso = new THREE.Mesh(torsoGeo, clothMat);
    torso.position.y = 0.62;
    torso.castShadow = true;
    g.add(torso);
    // Cabeza.
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.04;
    head.castShadow = true;
    g.add(head);
    // Piernas dobladas: dos muslos horizontales hacia adelante + dos pantorrillas
    // hacia abajo. El asiento queda a ~0.45 m, así que muslos a ~0.45.
    const hipY = 0.45;
    const thighFwd = 0.18; // los muslos salen hacia +z local (al frente del torso)
    const offsets = [-0.1, 0.1];
    for (let k = 0; k < 2; k++) {
      const ox = offsets[k];
      const thigh = new THREE.Mesh(thighGeo, clothMat);
      thigh.position.set(ox, hipY, thighFwd);
      g.add(thigh);
      const shin = new THREE.Mesh(shinGeo, clothMat);
      // La pantorrilla cuelga desde la rodilla (extremo frontal del muslo).
      shin.position.set(ox, hipY - 0.18, thighFwd + 0.16);
      g.add(shin);
    }
    g.visible = false;
    group.add(g);
    return { group: g, plate: null, plateText: "" };
  }

  // ── Walkers (pool reutilizable; crecen on-demand pero se reciclan) ──────────
  const walkers: Walker[] = [];   // activos
  const walkerPool: Walker[] = []; // libres para reusar

  function buildWalkerAvatar(): Walker {
    const g = new THREE.Group();
    // Materiales PROPIOS del walker (mutan opacity en el fade) — se trackean para
    // disponerlos en dispose junto con el resto.
    const cloth = trackMat(
      new THREE.MeshStandardMaterial({ color: CLOTH_PATIENT, roughness: 0.85, metalness: 0, transparent: true, opacity: 0 }),
    );
    const skin = trackMat(
      new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, metalness: 0, transparent: true, opacity: 0 }),
    );
    const fadeMats: THREE.Material[] = [cloth, skin];

    // Cuerpo (de pie).
    const body = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, cloth);
    torso.position.y = 0.78;
    torso.castShadow = true;
    body.add(torso);
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.26;
    head.castShadow = true;
    body.add(head);
    g.add(body);

    // Piernas (pivote en la cadera ~0.5; la cápsula cuelga hacia abajo).
    const mkLimb = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, len: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = -len / 2; // cuelga desde el pivote
      mesh.castShadow = true;
      pivot.add(mesh);
      g.add(pivot);
      return pivot;
    };
    const legL = mkLimb(limbGeo, cloth, -0.1, 0.5, 0.46);
    const legR = mkLimb(limbGeo, cloth, 0.1, 0.5, 0.46);
    const armL = mkLimb(armGeo, cloth, -0.24, 1.0, 0.4);
    const armR = mkLimb(armGeo, cloth, 0.24, 1.0, 0.4);

    g.visible = false;
    group.add(g);
    return {
      appointmentId: "",
      group: g,
      fadeMats,
      legL,
      legR,
      armL,
      armR,
      body,
      plate: null,
      path: [],
      wp: 1,
      phase: 0,
      fade: 0,
      state: "in",
    };
  }

  /** Aplica opacidad a los materiales del walker (fade in/out). */
  function setWalkerOpacity(w: Walker, o: number): void {
    const v = Math.max(0, Math.min(1, o));
    for (let i = 0; i < w.fadeMats.length; i++) {
      const m = w.fadeMats[i] as THREE.Material & { opacity: number };
      m.opacity = v;
    }
    if (w.plate) {
      const pm = w.plate.material as THREE.SpriteMaterial;
      pm.opacity = v;
    }
  }

  /** Pone (o cambia) la placa de nombre de un avatar; dispone la textura vieja. */
  function setPlate(
    holder: { plate: THREE.Sprite | null; plateText: string },
    parent: THREE.Object3D,
    name: string,
    y: number,
  ): void {
    const text = name || "—";
    if (holder.plate && holder.plateText === text) return; // sin cambios → no regenerar
    if (holder.plate) {
      const old = holder.plate.material as THREE.SpriteMaterial;
      old.map?.dispose?.(); // CanvasTexture propia → liberar
      old.dispose?.();
      parent.remove(holder.plate);
      holder.plate = null;
    }
    const sprite = makeNamePlateSprite(text);
    sprite.position.set(0, y, 0);
    sprite.renderOrder = 999;
    parent.add(sprite);
    holder.plate = sprite;
    holder.plateText = text;
  }

  /** Dispone la placa de un holder (textura propia + material) y la quita. */
  function disposePlate(holder: { plate: THREE.Sprite | null; plateText: string }): void {
    if (!holder.plate) return;
    const m = holder.plate.material as THREE.SpriteMaterial;
    m.map?.dispose?.();
    m.dispose?.();
    if (holder.plate.parent) holder.plate.parent.remove(holder.plate);
    holder.plate = null;
    holder.plateText = "";
  }

  // Estado entre polls.
  let prevWaiting = new Map<string, PrevEntry>();
  // appointmentId → seat asignado en el poll actual (para resolver origen del walker).
  let seatByAppt = new Map<string, { x: number; z: number }>();

  /** Resuelve el destino (centro del sillón) de un paciente llamado. */
  function destinationFor(
    prev: PrevEntry,
    chairStates: Map<string, Chair3DState>,
  ): { x: number; z: number } | null {
    const chairs = Array.isArray(world?.chairs) ? world.chairs : [];
    // 1) Por resourceId del registro previo — SOLO si ese sillón está AHORA
    //    "ocupado": el paciente apareció como cita ACTIVA ahí (faithful al llamado;
    //    si canceló/checkout y el sillón no se ocupó, no camina a un sillón vacío).
    if (prev.resourceId && chairStates?.get(prev.resourceId)?.status === "ocupado") {
      for (let i = 0; i < chairs.length; i++) {
        if (chairs[i]?.resourceId === prev.resourceId) {
          return { x: chairs[i].center.x, z: chairs[i].center.z };
        }
      }
    }
    // 2) Por nombre del paciente contra un sillón "ocupado" del mismo nombre.
    if (prev.patientName && chairStates) {
      let foundRid: string | null = null;
      chairStates.forEach((st) => {
        if (foundRid) return;
        if (st?.status === "ocupado" && st?.patientName && st.patientName === prev.patientName) {
          foundRid = st.resourceId;
        }
      });
      if (foundRid) {
        for (let i = 0; i < chairs.length; i++) {
          if (chairs[i]?.resourceId === foundRid) {
            return { x: chairs[i].center.x, z: chairs[i].center.z };
          }
        }
      }
    }
    return null;
  }

  /** Saca un walker del pool (o crea uno) y lo prepara para `appointmentId`. */
  function spawnWalker(
    appointmentId: string,
    from: { x: number; z: number },
    to: { x: number; z: number },
    name: string,
  ): void {
    const w = walkerPool.pop() ?? buildWalkerAvatar();
    w.appointmentId = appointmentId;
    // Ruta: pathfinder (origen→destino). Si null → fade-out directo en el sitio.
    let path: { x: number; z: number }[] | null = null;
    const res = findPath(world, from, to);
    if (res && Array.isArray(res.points) && res.points.length >= 1) {
      path = res.points.map((p) => ({ x: p.x, z: p.z }));
    }
    if (!path || path.length < 2) {
      // Sin ruta: aparece en la plaza y hace SOLO fade-out (nunca se cuelga).
      w.path = [{ x: from.x, z: from.z }];
      w.state = "out";
    } else {
      w.path = path;
      w.state = "in";
    }
    w.wp = 1;
    w.phase = Math.random() * Math.PI * 2; // desfasa el balanceo entre walkers
    w.fade = 0;
    setWalkerOpacity(w, 0);
    // Posición inicial = primer waypoint (la plaza real).
    const p0 = w.path[0];
    w.group.position.set(p0.x, 0, p0.z);
    // Yaw inicial hacia el siguiente waypoint si existe.
    if (w.path.length >= 2) {
      const n = w.path[1];
      w.group.rotation.y = Math.atan2(n.x - p0.x, n.z - p0.z);
    }
    // Placa de pie.
    const holder = { plate: w.plate, plateText: "" };
    setPlate(holder, w.group, name, PLATE_WALK_Y);
    w.plate = holder.plate;
    w.group.visible = true;
    walkers.push(w);
  }

  /** Devuelve un walker al pool: oculto, placa liberada, fuera de `walkers`. */
  function retireWalker(w: Walker): void {
    w.group.visible = false;
    setWalkerOpacity(w, 0);
    // Resetea extremidades.
    w.legL.rotation.x = 0;
    w.legR.rotation.x = 0;
    w.armL.rotation.x = 0;
    w.armR.rotation.x = 0;
    w.body.position.y = 0;
    // Libera la placa (texto único por paciente → no la reusamos).
    const holder = { plate: w.plate, plateText: "" };
    disposePlate(holder);
    w.plate = null;
    w.path = [];
    w.appointmentId = "";
    walkerPool.push(w);
  }

  /** Cancela cualquier walker activo de un appointmentId (la data manda). */
  function cancelWalker(appointmentId: string): void {
    for (let i = walkers.length - 1; i >= 0; i--) {
      if (walkers[i].appointmentId === appointmentId) {
        const w = walkers[i];
        walkers.splice(i, 1);
        retireWalker(w);
      }
    }
  }

  return {
    group,

    setWaiting(waiting, chairStates) {
      // Robustez: data rara → trátala como vacía (nunca crashea).
      const list = Array.isArray(waiting) ? waiting : [];
      const states = chairStates instanceof Map ? chairStates : new Map<string, Chair3DState>();

      // Set actual de appointmentIds en espera.
      const nowIds = new Set<string>();
      for (let i = 0; i < list.length; i++) {
        const id = list[i]?.appointmentId;
        if (id) nowIds.add(id);
      }

      // 1) LLAMADOS: estaban en prevWaiting y YA NO están → caminan (si hay destino
      //    y conocíamos su plaza). Recorre prevWaiting con forEach (es un Map).
      prevWaiting.forEach((prev, apptId) => {
        if (nowIds.has(apptId)) return; // sigue esperando → no es llamado
        if (!prev.seat) return;          // no estaba sentado → solo desaparece
        const dest = destinationFor(prev, states);
        if (!dest) return;               // destino desconocido → no camina
        // Evita duplicar walker si ya hay uno activo para este apptId.
        let exists = false;
        for (let i = 0; i < walkers.length; i++) {
          if (walkers[i].appointmentId === apptId) {
            exists = true;
            break;
          }
        }
        if (!exists) spawnWalker(apptId, prev.seat, dest, prev.patientName);
      });

      // 3) Si un appointmentId con walker activo REAPARECE en espera → cancélalo
      //    (la data manda: vuelve a estar sentado).
      for (let i = walkers.length - 1; i >= 0; i--) {
        if (nowIds.has(walkers[i].appointmentId)) {
          const w = walkers[i];
          walkers.splice(i, 1);
          retireWalker(w);
        }
      }

      // 2) Reasigna SENTADOS: waiting[0..slots.length) → plazas; el resto, de pie.
      seatByAppt = new Map<string, { x: number; z: number }>();
      const nSeated = Math.min(list.length, slots.length);

      // Asegura tamaño del pool de sentados (hasta slots.length).
      while (seatedPool.length < nSeated) seatedPool.push(buildSeated());

      // Sienta a los primeros nSeated.
      for (let i = 0; i < nSeated; i++) {
        const p = list[i];
        const slot = slots[i];
        const av = seatedPool[i];
        av.group.position.set(slot.x, 0, slot.z);
        av.group.rotation.y = slot.yaw;
        av.group.visible = true;
        const holder = { plate: av.plate, plateText: av.plateText };
        setPlate(holder, av.group, p?.patientName ?? "", PLATE_SEAT_Y);
        av.plate = holder.plate;
        av.plateText = holder.plateText;
        if (p?.appointmentId) seatByAppt.set(p.appointmentId, { x: slot.x, z: slot.z });
      }

      // Oculta los avatares del pool que sobran (y libera sus placas para no fugar).
      for (let i = nSeated; i < seatedPool.length; i++) {
        const av = seatedPool[i];
        if (!av.group.visible && !av.plate) continue;
        av.group.visible = false;
        const holder = { plate: av.plate, plateText: av.plateText };
        disposePlate(holder);
        av.plate = null;
        av.plateText = "";
      }

      // EXTRAS (de pie en la recepción, rejilla compacta). No tienen plaza → si los
      // llaman luego, prev.seat será null y simplemente desaparecen (no caminan).
      // Reutilizamos avatares sentados del pool en pose "de pie" no aplica; para
      // mantenerlo simple y sin más geometría, dibujamos extras como sentados del
      // pool COLOCADOS en el cluster (es la sala de espera; de pie/sentado el
      // lector entiende "gente esperando"). Crecemos el pool si hace falta.
      const nExtra = list.length - nSeated;
      if (nExtra > 0) {
        // Cuántos avatares por fila (rejilla ~cuadrada).
        const perRow = Math.max(1, Math.ceil(Math.sqrt(nExtra)));
        // Base de orientación: mira hacia el centro del mundo (como recepción).
        const bcx = bounds ? (bounds.minX + bounds.maxX) / 2 : reception.x;
        const bcz = bounds ? (bounds.minZ + bounds.maxZ) / 2 : reception.z;
        const faceYaw = Math.atan2(bcx - reception.x, bcz - reception.z);
        const cosF = Math.cos(faceYaw);
        const sinF = Math.sin(faceYaw);
        for (let e = 0; e < nExtra; e++) {
          const idx = nSeated + e;
          while (seatedPool.length <= idx) seatedPool.push(buildSeated());
          const av = seatedPool[idx];
          const p = list[idx];
          const rowI = Math.floor(e / perRow);
          const colI = e % perRow;
          // Rejilla local centrada en X, creciendo "hacia atrás" (−adelante).
          const lx = (colI - (perRow - 1) / 2) * STAND_GAP;
          const lz = -rowI * STAND_GAP;
          // Rota la rejilla por la orientación de la recepción.
          const wx = reception.x + lx * cosF - lz * sinF;
          const wz = reception.z + lx * sinF + lz * cosF;
          av.group.position.set(wx, 0, wz);
          av.group.rotation.y = faceYaw;
          av.group.visible = true;
          const holder = { plate: av.plate, plateText: av.plateText };
          setPlate(holder, av.group, p?.patientName ?? "", PLATE_SEAT_Y);
          av.plate = holder.plate;
          av.plateText = holder.plateText;
          // Los extras NO registran seat (no caminan al ser llamados).
        }
        // Oculta el sobrante por encima del total real.
        for (let i = nSeated + nExtra; i < seatedPool.length; i++) {
          const av = seatedPool[i];
          if (!av.group.visible && !av.plate) continue;
          av.group.visible = false;
          const holder = { plate: av.plate, plateText: av.plateText };
          disposePlate(holder);
          av.plate = null;
          av.plateText = "";
        }
      }

      // 4) Guarda el waiting actual como prevWaiting (con la plaza asignada).
      const next = new Map<string, PrevEntry>();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p?.appointmentId) continue;
        next.set(p.appointmentId, {
          patientName: p.patientName ?? "",
          resourceId: p.resourceId ?? null,
          seat: seatByAppt.get(p.appointmentId) ?? null,
        });
      }
      prevWaiting = next;
    },

    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) dt = 0;
      const step = AVATAR_WALK_SPEED * dt;
      const swing = dt * Math.PI * 2 * WALK_BOB_HZ;
      // Recorre walkers de atrás hacia adelante (podemos retirar al vuelo).
      for (let i = walkers.length - 1; i >= 0; i--) {
        const w = walkers[i];

        // ── Fade-in al aparecer ──
        if (w.state === "in") {
          w.fade += dt / FADE_S;
          if (w.fade >= 1) {
            w.fade = 1;
            w.state = w.path.length >= 2 ? "walk" : "out";
          }
          setWalkerOpacity(w, w.fade);
        }

        // ── Caminar por los waypoints ──
        if (w.state === "walk") {
          // Balanceo de extremidades + micro-bob.
          w.phase += swing;
          const sw = Math.sin(w.phase);
          w.legL.rotation.x = sw * 0.6;
          w.legR.rotation.x = -sw * 0.6;
          w.armL.rotation.x = -sw * 0.5;
          w.armR.rotation.x = sw * 0.5;
          w.body.position.y = Math.abs(Math.sin(w.phase)) * 0.04;

          let remaining = step;
          // Consume distancia hacia el waypoint actual; puede cruzar varios por frame.
          while (remaining > 1e-5 && w.wp < w.path.length) {
            const tgt = w.path[w.wp];
            const px = w.group.position.x;
            const pz = w.group.position.z;
            const dx = tgt.x - px;
            const dz = tgt.z - pz;
            const dist = Math.hypot(dx, dz);
            // Orienta el yaw hacia el waypoint (lerp corto, sin saltos bruscos).
            if (dist > 1e-4) {
              const desired = Math.atan2(dx, dz);
              let diff = desired - w.group.rotation.y;
              // Normaliza a (−π, π].
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              w.group.rotation.y += diff * Math.min(1, dt * 10);
            }
            if (dist <= remaining) {
              // Alcanza el waypoint: avanza al siguiente.
              w.group.position.set(tgt.x, 0, tgt.z);
              remaining -= dist;
              w.wp++;
            } else {
              w.group.position.x += (dx / dist) * remaining;
              w.group.position.z += (dz / dist) * remaining;
              remaining = 0;
            }
          }

          // ¿Llegó al destino final? (último waypoint dentro del umbral).
          const last = w.path[w.path.length - 1];
          const ddx = last.x - w.group.position.x;
          const ddz = last.z - w.group.position.z;
          if (w.wp >= w.path.length || Math.hypot(ddx, ddz) <= WALKER_ARRIVE_DIST) {
            w.state = "out";
          }
        }

        // ── Fade-out al llegar (o sin ruta) → retirar ──
        if (w.state === "out") {
          w.fade -= dt / FADE_S;
          if (w.fade <= 0) {
            w.fade = 0;
            walkers.splice(i, 1);
            retireWalker(w);
            continue;
          }
          setWalkerOpacity(w, w.fade);
        }
      }
    },

    dispose() {
      // Retira walkers activos (libera sus placas) y vacía el pool.
      for (let i = walkers.length - 1; i >= 0; i--) {
        const w = walkers[i];
        const holder = { plate: w.plate, plateText: "" };
        disposePlate(holder);
        w.plate = null;
      }
      walkers.length = 0;
      for (let i = 0; i < walkerPool.length; i++) {
        const holder = { plate: walkerPool[i].plate, plateText: "" };
        disposePlate(holder);
        walkerPool[i].plate = null;
      }
      walkerPool.length = 0;
      // Libera las placas de los sentados (CanvasTextures propias).
      for (let i = 0; i < seatedPool.length; i++) {
        const holder = { plate: seatedPool[i].plate, plateText: "" };
        disposePlate(holder);
        seatedPool[i].plate = null;
      }
      seatedPool.length = 0;
      // Dispone el árbol completo (mallas/sprites restantes) y luego los recursos
      // compartidos rastreados (geometrías/materiales reusados por el pool).
      disposeObject3D(group);
      group.clear();
      for (let i = 0; i < geos.length; i++) geos[i].dispose();
      for (let i = 0; i < mats.length; i++) mats[i].dispose();
      geos.length = 0;
      mats.length = 0;
      prevWaiting.clear();
      seatByAppt.clear();
    },
  };
}
