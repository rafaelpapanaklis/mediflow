// ─────────────────────────────────────────────────────────────────────────────
// A7 — Capa viva: avatares (paciente sentado + doctor de pie), anillo LED en el
// piso y placa flotante por sillón. Se construye una vez (un nodo por ancla) y
// se MUTA en cada poll sin reconstruir el mundo.
//
// TODO(A7): implementar createLiveLayer según este brief.
//
// Construcción (createLiveLayer): por cada world.chairs (WorldChairAnchor) crea
//   un sub-Group posicionado en (center.x, 0, center.z) y rotado rotationRad,
//   guardado en un Map<resourceId, nodos>. Cada nodo contiene:
//   - ring: anillo en el piso (RingGeometry y≈0.02, rotado plano) con
//     MeshBasicMaterial color por estado (STATUS_RING_COLOR), opacidad ~0.5.
//   - patient: avatar paciente (cápsula cuerpo ropa neutra #6b7280 + esfera
//     cabeza tono piel #e8b f.. ) en pose sentada/reclinada sobre el sillón
//     (un poco elevado en Y y ligeramente inclinado). visible solo si "ocupado".
//   - doctor: avatar doctor (cápsula BLANCA bata + cabeza) DE PIE al lado del
//     sillón (offset lateral ~0.6 m). visible solo si "ocupado".
//   - plate: Sprite con CanvasTexture (los Sprites SIEMPRE miran a cámara → no
//     hace falta billboard manual). Texto: nombre del sillón + estado; si
//     ocupado, paciente/doctor + "termina HH:MM". Colócala ~2.1 m de alto.
//   Avatares estilizados low-poly (CapsuleGeometry + SphereGeometry), NO realismo.
//
// update(states): por cada ancla, busca state = states.get(resourceId). Si no
//   hay → trátalo como "libre". Aplica:
//   - ring.material.color = STATUS_RING_COLOR[status]; (anillo pulsante opcional
//     vía escala, pero sin guardar timers aquí).
//   - patient.visible = doctor.visible = (status === "ocupado").
//   - Si el color del Resource (state.color/anchor.color) existe, tíntalo en la
//     ropa del paciente o en un detalle del sillón para identificar el sillón.
//   - Regenera la textura de la placa SOLO si su texto cambió (cachea el último
//     texto por ancla); dispone la textura vieja antes de crear la nueva
//     (evita fuga). Usa fmtHM del live-mode para "termina HH:MM" desde
//     appointmentEndsAt (parsea ISO → Date; si inválida, omite la hora).
//
// dispose(): traversa group y dispone geometrías/materiales; dispone TODAS las
//   CanvasTextures de las placas; vacía el Map. (El orquestador igual traversa
//   la escena, pero las texturas de canvas conviene liberarlas aquí explícito.)
//
// helper makePlateTexture(lines: string[]) → THREE.CanvasTexture (panel
//   redondeado oscuro semitransparente, texto blanco, varias líneas). Reusa un
//   <canvas> por ancla.
//
// Devuelve { group, update, dispose }. El group se añade a la escena por el
// orquestador. group.name = "live".
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { fmtHM } from "@/lib/floor-plan/live-mode";
import { STATUS_RING_COLOR, type Chair3DState, type ChairLiveStatus, type WorldChairAnchor, type WorldModel } from "./world-types";

export interface LiveLayer {
  group: THREE.Group;
  /** Aplica los estados vivos (clave = resourceId). Sin reconstruir el mundo. */
  update(states: Map<string, Chair3DState>): void;
  /** Grupos paciente/doctor visibles y con patientId → candidatos del raycast (A4). */
  getInteractables(): THREE.Object3D[];
  /** Cajas-hit invisibles de sillones NO ocupados → candidatos del raycast "agendar" (A6/V3). */
  getScheduleTargets(): THREE.Object3D[];
  dispose(): void;
}

// ── Paleta de avatares (low-poly, no realismo) ───────────────────────────────
const SKIN = "#e8b894";          // tono piel cabeza
const CLOTH_PATIENT = "#6b7280"; // ropa neutra paciente
const COAT_WHITE = "#f4f6f8";    // bata blanca doctor
const HAIR_DOCTOR = "#3a3f47";   // cabello/detalle doctor

// ── Geometría de la placa (Sprite + CanvasTexture) ───────────────────────────
const PLATE_W = 512; // px del canvas (alta densidad → texto nítido)
const PLATE_H = 256;
const PLATE_WORLD_W = 1.6; // ancho del sprite en metros
const PLATE_Y = 2.1;       // alto flotante

/** Nodos vivos de un ancla. El <canvas> se reusa por ancla (sin realloc). */
interface ChairNodes {
  anchor: WorldChairAnchor;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  patient: THREE.Group;
  patientCloth: THREE.MeshStandardMaterial; // se tinta con el color del Resource
  doctor: THREE.Group;
  plate: THREE.Sprite;
  plateMat: THREE.SpriteMaterial;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  lastText: string;
  /** Caja-hit invisible para apuntar al sillón VACÍO (raycast "agendar", A6/V3). */
  scheduleHit: THREE.Mesh;
  scheduleHitMat: THREE.MeshBasicMaterial;
  /** Último estado calculado (filtra elegibilidad en getScheduleTargets). */
  status: ChairLiveStatus;
}

/** Avatar low-poly: cápsula cuerpo + esfera cabeza. Devuelve {group, cloth}. */
function makeAvatar(clothColor: string, headColor: string): {
  group: THREE.Group;
  cloth: THREE.MeshStandardMaterial;
} {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.85, metalness: 0 });
  // Cuerpo: cápsula (radio 0.18, alto del cilindro 0.5) → ~0.86 m de tronco.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 10), cloth);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  // Cabeza: esfera tono piel.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.7, metalness: 0 }),
  );
  head.position.y = 1.02;
  head.castShadow = true;
  group.add(head);
  return { group, cloth };
}

export function createLiveLayer(world: WorldModel): LiveLayer {
  const group = new THREE.Group();
  group.name = "live";
  const nodes = new Map<string, ChairNodes>();

  for (const a of world.chairs) {
    // Sub-Group por ancla: posicionado en el centro del sillón y rotado como el
    // sillón. Todo lo de dentro vive en coordenadas LOCALES del sillón, así el
    // paciente queda recostado a lo largo de su eje y el doctor a su costado.
    const node = new THREE.Group();
    node.name = `live-chair-${a.resourceId}`;
    node.position.set(a.center.x, 0, a.center.z);
    node.rotation.y = a.rotationRad;
    group.add(node);

    // Anillo LED en el piso (MeshBasicMaterial → brilla sin depender de luces).
    const ringMat = new THREE.MeshBasicMaterial({
      color: STATUS_RING_COLOR.libre,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    node.add(ring);

    // Paciente: recostado sobre el sillón (elevado en Y, ligeramente inclinado,
    // cabeza hacia el respaldo). Sillón "sillon" es 2×3 → el largo es el eje Z.
    const { group: patient, cloth: patientCloth } = makeAvatar(CLOTH_PATIENT, SKIN);
    patient.position.set(0, 0.62, 0.15);
    patient.rotation.x = -Math.PI / 2 + 0.32; // reclinado, no totalmente plano
    patient.rotation.z = Math.PI;             // cabeza hacia el cabezal
    patient.visible = false;
    node.add(patient);

    // Doctor: de pie al costado del sillón (~0.6 m), mirando al paciente.
    const { group: doctor } = makeAvatar(COAT_WHITE, SKIN);
    // Mechón/cabello para distinguir al doctor de la bata blanca.
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: HAIR_DOCTOR, roughness: 0.8, metalness: 0 }),
    );
    hair.position.y = 1.06;
    doctor.add(hair);
    doctor.position.set(0.7, 0, 0);
    doctor.rotation.y = -Math.PI / 2; // de cara al sillón
    doctor.visible = false;
    node.add(doctor);

    // Placa flotante (Sprite → siempre mira a la cámara, sin billboard manual).
    const canvas = document.createElement("canvas");
    canvas.width = PLATE_W;
    canvas.height = PLATE_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const plateMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const plate = new THREE.Sprite(plateMat);
    plate.position.set(0, PLATE_Y, 0);
    plate.scale.set(PLATE_WORLD_W, PLATE_WORLD_W * (PLATE_H / PLATE_W), 1);
    plate.renderOrder = 999; // sobre el resto
    node.add(plate);

    // Caja-hit invisible (raycast "agendar"): cubre el volumen del sillón a la
    // altura del asiento. opacity 0 → no dibuja nada; visible:true para que el
    // raycaster la considere. La elegibilidad (no ocupado) la filtra
    // getScheduleTargets, no la visibilidad de la caja.
    const scheduleHitMat = new THREE.MeshBasicMaterial({
      color: "#a78bfa",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const scheduleHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 1.4), scheduleHitMat);
    scheduleHit.position.y = 0.6; // altura del asiento (local)
    scheduleHit.visible = true;
    scheduleHit.userData = { resourceId: a.resourceId, name: a.name, scheduleHit: true };
    node.add(scheduleHit);

    nodes.set(a.resourceId, {
      anchor: a,
      ring,
      ringMat,
      patient,
      patientCloth,
      doctor,
      plate,
      plateMat,
      canvas,
      texture,
      lastText: "",
      scheduleHit,
      scheduleHitMat,
      status: "libre",
    });
  }

  return {
    group,
    update(states) {
      nodes.forEach((n, rid) => {
        const st = states.get(rid);
        const status = st?.status ?? "libre";
        const occupied = status === "ocupado";

        // Recordar el estado vigente (getScheduleTargets filtra por él).
        n.status = status;

        // Anillo: color por estado.
        n.ringMat.color.set(STATUS_RING_COLOR[status]);

        // Avatares: solo visibles si el sillón está ocupado.
        n.patient.visible = occupied;
        n.doctor.visible = occupied;

        // userData para el raycast de interacción (A4): paciente Y doctor llevan
        // el patientId del paciente atendido → click abre el mismo expediente.
        // Limpia al quedar libre para que getInteractables no lo considere.
        if (occupied) {
          const ud = { patientId: st?.patientId ?? null, patientName: st?.patientName ?? n.anchor.name };
          n.patient.userData = ud;
          n.doctor.userData = ud;
        } else {
          n.patient.userData = {};
          n.doctor.userData = {};
        }

        // Tinte de identidad del sillón en la ropa del paciente (color del
        // Resource; cae al color del ancla). Si no hay color, ropa neutra.
        const tint = st?.color ?? n.anchor.color;
        n.patientCloth.color.set(tint ?? CLOTH_PATIENT);

        // Placa: regenerar SOLO si el texto cambió (cachea + dispone vieja).
        const lines: string[] = [n.anchor.name];
        if (occupied) {
          if (st?.patientName) lines.push(st.patientName);
          if (st?.doctorName) lines.push(`Dr. ${st.doctorName}`);
          if (st?.appointmentEndsAt) {
            const ends = new Date(st.appointmentEndsAt);
            if (!Number.isNaN(ends.getTime())) lines.push(`termina ${fmtHM(ends)}`);
          }
        } else {
          lines.push(status === "proximo" ? "Próxima cita" : "Libre");
        }
        const text = lines.join("\n");
        if (text !== n.lastText) {
          n.lastText = text;
          const next = makePlateTexture(n.canvas, lines, STATUS_RING_COLOR[status]);
          n.texture.dispose();
          n.texture = next;
          n.plateMat.map = next;
          n.plateMat.needsUpdate = true;
        }
      });
    },
    getInteractables() {
      // Candidatos del raycast: grupos paciente y doctor visibles con patientId.
      // Recorre el Map con .forEach (NUNCA for...of sobre Map/Set).
      const out: THREE.Object3D[] = [];
      nodes.forEach((n) => {
        if (n.patient.visible && n.patient.userData?.patientId) out.push(n.patient);
        if (n.doctor.visible && n.doctor.userData?.patientId) out.push(n.doctor);
      });
      return out;
    },
    getScheduleTargets() {
      // Cajas-hit de sillones NO ocupados (libre/proximo) → candidatos "agendar".
      // Recorre el Map con .forEach (NUNCA for...of sobre Map/Set).
      const out: THREE.Object3D[] = [];
      nodes.forEach((n) => {
        if (n.status !== "ocupado") out.push(n.scheduleHit);
      });
      return out;
    },
    dispose() {
      // Geometrías/materiales del árbol completo.
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
        else mat?.dispose?.();
      });
      // Texturas de canvas de TODAS las placas (no las suelta el traverse).
      nodes.forEach((n) => n.texture.dispose());
      nodes.clear();
    },
  };
}

/**
 * Pinta el panel de la placa en el <canvas> reusado del ancla y devuelve una
 * CanvasTexture nueva (panel redondeado oscuro semitransparente, texto blanco,
 * franja superior con el color del estado). El caller dispone la textura previa.
 */
function makePlateTexture(
  canvas: HTMLCanvasElement,
  lines: string[],
  statusColor: string,
): THREE.CanvasTexture {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  if (ctx) {
    ctx.clearRect(0, 0, W, H);
    // Panel redondeado oscuro semitransparente.
    const r = 36;
    const pad = 14;
    ctx.fillStyle = "rgba(17,24,39,0.82)";
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, r);
    ctx.fill();
    // Franja de estado (barra superior con el color del anillo).
    ctx.fillStyle = statusColor;
    roundRect(ctx, pad, pad, W - pad * 2, 18, r);
    ctx.fill();

    // Texto: primera línea (nombre del sillón) en grande/bold, resto menor.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = W / 2;
    const startY = 70;
    const lineH = 50;
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        ctx.font = "bold 44px system-ui, -apple-system, Segoe UI, sans-serif";
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.font = "32px system-ui, -apple-system, Segoe UI, sans-serif";
        ctx.fillStyle = "#d1d5db";
      }
      ctx.fillText(lines[i], cx, startY + i * lineH, W - pad * 2 - 24);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Rectángulo redondeado en el contexto 2D (path; el caller hace fill). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
