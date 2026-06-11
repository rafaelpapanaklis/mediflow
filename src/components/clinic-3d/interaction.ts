// ─────────────────────────────────────────────────────────────────────────────
// A4 — Interacción: raycast desde el CENTRO de la cámara (crosshair, estilo
// Minecraft) hacia avatares de paciente/doctor; highlight + tooltip; al
// interactuar abre el expediente del paciente en pestaña nueva.
//
// Este módulo es NUEVO. ADEMÁS debes editar live-layer.ts (ver más abajo).
//
// TODO(A4): implementar createInteraction según este brief.
//
// INTERACTABLES: opts.getInteractables() devuelve los Object3D candidatos (los
//   GRUPOS de avatar paciente y doctor de la capa viva, solo de sillones
//   OCUPADOS). Cada uno DEBE traer userData = { patientId, patientName }. El
//   doctor de la cita lleva el patientId DEL PACIENTE que atiende (abre el mismo
//   expediente). Esto lo provee live-layer (tu edición).
//
// update(): raycaster desde el centro NDC (0,0) con la cámara. Interseca los
//   interactables (recursive:true). Toma el primer hit a distancia ≤ INTERACT_RANGE
//   cuyo ancestro tenga userData.patientId. Resuelve ese ancestro como target.
//   - Si cambió el target: quita highlight del anterior, ponlo en el nuevo
//     (emissive boost: guarda emissive original de cada Mesh y súbele
//     emissiveIntensity / set emissive a un tono cálido; restáuralo al salir).
//   - Guarda tooltip = `Abrir expediente de ${patientName}` y targeting=true.
//   - Sin hit válido → target=null, tooltip=null, targeting=false.
//
// interactCenter(): si hay target, abre window.open(`/dashboard/patients/
//   ${patientId}`, "_blank", "noopener"). (No navega la propia pestaña.)
//
// interactAt(ndcX, ndcY): raycast en ese punto NDC (para TAP en móvil), mismo
//   filtro de distancia/patientId; si hay hit, abre el expediente directo.
//
// getTooltip(): string|null — para el HUD. isTargeting(): boolean — para el
//   crosshair. Ambos baratos (devuelven el último estado calculado en update).
//
// dispose(): restaura cualquier highlight activo (no dejes materiales tintados).
//   No dispone geometrías (los avatares los gestiona live-layer).
//
// ── EDICIÓN ADICIONAL EN live-layer.ts (A4) ──────────────────────────────────
// 1) En update(states): cuando el sillón está "ocupado", setea en el grupo del
//    paciente Y en el del doctor: group.userData = { patientId: state.patientId
//    ?? null, patientName: state.patientName ?? n.anchor.name }. Cuando no está
//    ocupado, limpia userData (o déjalo pero getInteractables filtra por visible).
// 2) Agrega a la interface LiveLayer y al objeto devuelto:
//    getInteractables(): THREE.Object3D[] → devuelve, recorriendo el Map de
//    nodos con .forEach (NO for...of), los grupos patient y doctor que estén
//    .visible === true y con userData.patientId truthy.
//    (No rompas la firma existente de update/dispose/group.)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import { INTERACT_RANGE } from "./world-types";

export interface InteractionSystem {
  /** Raycast desde el centro: actualiza highlight, tooltip y targeting. */
  update(): void;
  /** Abre el expediente del target central (click desktop con pointer lock). */
  interactCenter(): void;
  /** Raycast + abrir en un punto NDC (tap móvil). */
  interactAt(ndcX: number, ndcY: number): void;
  getTooltip(): string | null;
  isTargeting(): boolean;
  dispose(): void;
}

export interface InteractionOpts {
  camera: THREE.Camera;
  getInteractables: () => THREE.Object3D[];
}

// ── Highlight (emissive boost cálido; guarda/restaura el original por Mesh) ───
const HIGHLIGHT_COLOR = new THREE.Color("#ffb347"); // tono cálido
const HIGHLIGHT_INTENSITY = 0.55;

/** Snapshot del emissive original de un material para poder restaurarlo. */
interface EmissiveSnapshot {
  mat: THREE.MeshStandardMaterial;
  color: number;
  intensity: number;
}

export function createInteraction(opts: InteractionOpts): InteractionSystem {
  const raycaster = new THREE.Raycaster();
  const centerNdc = new THREE.Vector2(0, 0);
  const pointNdc = new THREE.Vector2();

  let target: THREE.Object3D | null = null;
  let tooltip: string | null = null;
  let targeting = false;
  let highlighted: EmissiveSnapshot[] = [];

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Sube por la jerarquía buscando el primer ancestro con userData.patientId. */
  function findPatientAncestor(o: THREE.Object3D | null): THREE.Object3D | null {
    let cur: THREE.Object3D | null = o;
    while (cur) {
      if (cur.userData && cur.userData.patientId) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /** Resuelve el primer hit válido (≤ INTERACT_RANGE y con ancestro paciente). */
  function pick(ndc: THREE.Vector2): THREE.Object3D | null {
    raycaster.setFromCamera(ndc, opts.camera);
    const hits = raycaster.intersectObjects(opts.getInteractables(), true);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h.distance > INTERACT_RANGE) continue; // los hits vienen ordenados por distancia
      const anc = findPatientAncestor(h.object);
      if (anc) return anc;
    }
    return null;
  }

  /** Abre el expediente del paciente en una pestaña nueva (sin navegar la actual). */
  function openRecord(node: THREE.Object3D | null): void {
    const pid = node?.userData?.patientId;
    if (!pid) return;
    window.open(`/dashboard/patients/${pid}`, "_blank", "noopener");
  }

  function clearHighlight(): void {
    for (let i = 0; i < highlighted.length; i++) {
      const s = highlighted[i];
      s.mat.emissive.setHex(s.color);
      s.mat.emissiveIntensity = s.intensity;
    }
    highlighted = [];
  }

  function applyHighlight(node: THREE.Object3D): void {
    const snaps: EmissiveSnapshot[] = [];
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i] as THREE.MeshStandardMaterial;
        if (!m || !m.emissive) continue; // solo materiales con emissive (Standard)
        snaps.push({ mat: m, color: m.emissive.getHex(), intensity: m.emissiveIntensity });
        m.emissive.copy(HIGHLIGHT_COLOR);
        m.emissiveIntensity = HIGHLIGHT_INTENSITY;
      }
    });
    highlighted = snaps;
  }

  function setTarget(next: THREE.Object3D | null): void {
    if (next === target) return;
    clearHighlight();
    target = next;
    if (target) applyHighlight(target);
  }

  // ── API ──────────────────────────────────────────────────────────────────

  return {
    update() {
      const next = pick(centerNdc);
      setTarget(next);
      if (target) {
        const name = (target.userData?.patientName as string) || "paciente";
        tooltip = `Abrir expediente de ${name}`;
        targeting = true;
      } else {
        tooltip = null;
        targeting = false;
      }
    },
    interactCenter() {
      if (target) openRecord(target);
    },
    interactAt(ndcX, ndcY) {
      pointNdc.set(ndcX, ndcY);
      const hit = pick(pointNdc);
      if (hit) openRecord(hit);
    },
    getTooltip() {
      return tooltip;
    },
    isTargeting() {
      return targeting;
    },
    dispose() {
      clearHighlight();
      target = null;
      tooltip = null;
      targeting = false;
    },
  };
}
