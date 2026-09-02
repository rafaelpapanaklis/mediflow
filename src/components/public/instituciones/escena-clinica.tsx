"use client";

import * as THREE from "three";
import { cedeElHilo, useEscena3D, type ContextoEscena } from "./escena-motor";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA CLÍNICA ISOMÉTRICA — el piso de una sede, con sus sillones.
 *
 * 🔴 LA PROYECCIÓN NO SE ELIGIÓ A OJO. El plano de piso del producto
 * (src/lib/floor-plan/iso.ts) proyecta la retícula así:
 *
 *     x = (col − fila) · C        y = (col + fila) · C/2
 *
 * es decir, dos de ancho por uno de alto. Con una cámara ORTOGRÁFICA a 45°
 * de azimut, un paso de una celda en X se proyecta con ancho cos45 y alto
 * cos45·sen(elevación); para que la razón sea exactamente 1/2 hace falta
 * sen(elevación) = 0,5, o sea **30 grados**. Por eso la cámara de abajo
 * está a 45° y 30°, y no en la isométrica "de libro" (35,26°): esta escena
 * y el plano del panel dibujan el MISMO piso.
 *
 * Todo procedural: el suelo con su cuadrícula pintada en un lienzo, los
 * muros bajos y cuatro cajas por sillón. Las piezas repetidas van en
 * `InstancedMesh`, así que seis sillones son cuatro llamadas de dibujo.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Media anchura de celda, la misma que el plano del producto. */
const CELDA = 1;
const COLS = 7;
const FILAS = 5;

/** Dónde va cada sillón, en coordenadas de la retícula. */
const SILLONES: Array<{ col: number; fila: number; encendido: boolean }> = [
  { col: 1.0, fila: 1.0, encendido: true },
  { col: 3.1, fila: 1.0, encendido: true },
  { col: 5.2, fila: 1.0, encendido: false },
  { col: 1.0, fila: 3.2, encendido: true },
  { col: 3.1, fila: 3.2, encendido: false },
  { col: 5.2, fila: 3.2, encendido: true },
];

/** El suelo: cuadrícula pintada en un lienzo, sin una sola petición. */
function texturaSuelo(): THREE.CanvasTexture | null {
  const px = 128;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#eef2fa";
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = "#c4d1ec";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, px - 3, px - 3);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(COLS, FILAS);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function construir({ guarda }: ContextoEscena) {
  const scene = new THREE.Scene();

  // Ortográfica: es lo que hace que sea isometría y no perspectiva.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const AZIMUT = Math.PI / 4; // 45°
  const ELEVACION = Math.PI / 6; // 30° → la razón 2:1 del plano del producto
  const R = 30;
  camera.position.set(
    R * Math.cos(ELEVACION) * Math.cos(AZIMUT),
    R * Math.sin(ELEVACION),
    R * Math.cos(ELEVACION) * Math.sin(AZIMUT),
  );
  camera.lookAt(0, 0, 0);

  // Dos grupos y no uno: `gira` se queda en el origen y es lo que balancea;
  // `centro` mete la retícula hacia atrás para que su MEDIO caiga en ese
  // origen. Con un solo grupo desplazado, el balanceo giraría el piso
  // alrededor de su esquina y la escena se saldría de la caja.
  const gira = new THREE.Group();
  const centro = new THREE.Group();
  centro.position.set((-COLS * CELDA) / 2, 0, (-FILAS * CELDA) / 2);
  gira.add(centro);
  scene.add(gira);

  // ── Suelo ─────────────────────────────────────────────────────────────
  const suelo = texturaSuelo();
  const matSuelo = guarda(
    suelo
      ? new THREE.MeshStandardMaterial({ map: guarda(suelo), roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ color: 0xeef2fa, roughness: 0.95 }),
  );
  const geoSuelo = guarda(new THREE.PlaneGeometry(COLS * CELDA, FILAS * CELDA));
  const piso = new THREE.Mesh(geoSuelo, matSuelo);
  piso.rotation.x = -Math.PI / 2;
  piso.position.set((COLS * CELDA) / 2, 0, (FILAS * CELDA) / 2);
  centro.add(piso);

  // ── Muros bajos: le dan suelo a la escena sin taparla ────────────────
  const matMuro = guarda(new THREE.MeshStandardMaterial({ color: 0xdbe3f4, roughness: 0.9 }));
  const geoMuroX = guarda(new THREE.BoxGeometry(COLS * CELDA, 0.9, 0.12));
  const muroX = new THREE.Mesh(geoMuroX, matMuro);
  muroX.position.set((COLS * CELDA) / 2, 0.45, 0);
  const geoMuroZ = guarda(new THREE.BoxGeometry(0.12, 0.9, FILAS * CELDA));
  const muroZ = new THREE.Mesh(geoMuroZ, matMuro);
  muroZ.position.set(0, 0.45, (FILAS * CELDA) / 2);
  centro.add(muroX, muroZ);

  // ── Los sillones ──────────────────────────────────────────────────────
  // Cuatro piezas repetidas seis veces: base, asiento, respaldo y el brazo
  // de la lámpara. Cada pieza es un InstancedMesh → cuatro dibujos.
  const n = SILLONES.length;
  const matSillon = guarda(
    new THREE.MeshStandardMaterial({ color: 0x4665ac, roughness: 0.42, metalness: 0.08 }),
  );
  const matTapiz = guarda(
    new THREE.MeshStandardMaterial({ color: 0xc4d1ec, roughness: 0.6, metalness: 0.02 }),
  );
  const matBrazo = guarda(new THREE.MeshStandardMaterial({ color: 0xe3e9f6, roughness: 0.5 }));

  // Un sillón dental de verdad: pedestal, asiento largo, respaldo
  // RECLINADO, cabezal y el brazo de la lámpara por encima. Sin el
  // respaldo inclinado y sin el cabezal, dos cajas sobre un cilindro no se
  // leen como un sillón: se leen como un mueble cualquiera.
  const piezas: Array<{
    geo: THREE.BufferGeometry;
    mat: THREE.Material;
    dx: number;
    dy: number;
    dz: number;
    /** Reclinación sobre Z. La misma para los seis, va en la matriz. */
    rz?: number;
  }> = [
    { geo: guarda(new THREE.CylinderGeometry(0.19, 0.3, 0.36, 14)), mat: matSillon, dx: 0.05, dy: 0.18, dz: 0 },
    { geo: guarda(new THREE.BoxGeometry(1.15, 0.15, 0.5)), mat: matTapiz, dx: 0.08, dy: 0.44, dz: 0 },
    { geo: guarda(new THREE.BoxGeometry(0.72, 0.15, 0.46)), mat: matTapiz, dx: -0.72, dy: 0.6, dz: 0, rz: -0.5 },
    { geo: guarda(new THREE.BoxGeometry(0.26, 0.13, 0.34)), mat: matTapiz, dx: -1.06, dy: 0.79, dz: 0, rz: -0.5 },
    { geo: guarda(new THREE.CylinderGeometry(0.045, 0.045, 1.3, 8)), mat: matBrazo, dx: 0.66, dy: 0.65, dz: -0.4 },
    { geo: guarda(new THREE.BoxGeometry(0.62, 0.07, 0.1)), mat: matBrazo, dx: 0.38, dy: 1.28, dz: -0.4 },
  ];

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const ejeZ = new THREE.Vector3(0, 0, 1);
  const uno = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();

  for (const pieza of piezas) {
    const inst = new THREE.InstancedMesh(pieza.geo, pieza.mat, n);
    guarda(inst);
    q.setFromAxisAngle(ejeZ, pieza.rz ?? 0);
    SILLONES.forEach((s, i) => {
      pos.set(s.col * CELDA + pieza.dx, pieza.dy, s.fila * CELDA + pieza.dz);
      m.compose(pos, q, uno);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    centro.add(inst);
  }

  // Las lámparas de los sillones ocupados: lo único que late en la escena.
  q.identity();
  const geoLampara = guarda(new THREE.CylinderGeometry(0.17, 0.11, 0.12, 12));
  const matLampara = guarda(new THREE.MeshBasicMaterial({ color: 0xfcd34d }));
  const encendidos = SILLONES.filter((s) => s.encendido);
  const lamparas = new THREE.InstancedMesh(geoLampara, matLampara, encendidos.length);
  guarda(lamparas);
  encendidos.forEach((s, i) => {
    pos.set(s.col * CELDA + 0.14, 1.2, s.fila * CELDA - 0.4);
    m.compose(pos, q, uno);
    lamparas.setMatrixAt(i, m);
  });
  lamparas.instanceMatrix.needsUpdate = true;
  centro.add(lamparas);

  // ── Luz ───────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9bb0dc, 1.05));
  const clave = new THREE.DirectionalLight(0xffffff, 1.5);
  clave.position.set(6, 9, 4);
  scene.add(clave);

  /**
   * Encuadre ortográfico: la retícula proyectada mide (COLS+FILAS)·cos45 de
   * ancho. Se calcula el alto necesario y se reparte por el aspecto, así
   * que el piso entero cabe en cualquier caja sin recortarse.
   */
  const ANCHO_MUNDO = (COLS + FILAS) * CELDA * Math.SQRT1_2 + 0.7;
  const ALTO_MUNDO = ANCHO_MUNDO * 0.5 + 1.7;
  const encuadre = (w: number, h: number) => {
    const aspecto = w / h;
    let mediaW = ANCHO_MUNDO / 2;
    let mediaH = ALTO_MUNDO / 2;
    if (mediaW / mediaH < aspecto) mediaW = mediaH * aspecto;
    else mediaH = mediaW / aspecto;
    camera.left = -mediaW;
    camera.right = mediaW;
    camera.top = mediaH;
    camera.bottom = -mediaH;
    camera.updateProjectionMatrix();
  };

  const frame = (_dt: number, t: number) => {
    // Un balanceo lento de ±9°: la escena respira y sigue siendo isométrica.
    gira.rotation.y = Math.sin(t * 0.24) * 0.16;
    const pulso = 0.85 + 0.15 * Math.sin(t * 1.6);
    matLampara.color.setRGB(0.99 * pulso, 0.83 * pulso, 0.3 * pulso);
  };

  return { scene, camera, frame, encuadre };
}

export default function EscenaClinica({
  onReady,
  onFail,
}: {
  onReady: () => void;
  onFail: () => void;
}) {
  const ref = useEscena3D(
    async (ctx) => {
      const esc = construir(ctx);
      await cedeElHilo();
      return esc;
    },
    { onReady, onFail, dprMax: 1.75 },
  );
  return <canvas ref={ref} className="dcei-canvas" />;
}
