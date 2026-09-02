"use client";

import * as THREE from "three";
import { cedeElHilo, texturaSombra, useEscena3D, type ContextoEscena } from "./escena-motor";

/**
 * LA ARCADA DE LA PORTADA — dieciséis dientes girando despacio.
 *
 * Todo es PROCEDURAL: un perfil torneado (LatheGeometry) repetido con
 * `InstancedMesh` y una encía tubular sobre la misma parábola que dibuja
 * el respaldo estático. No hay ni un modelo que descargar; el único peso
 * es el trozo de three.js, y ése solo lo pide la puerta cuando hay alguien
 * mirando.
 *
 * Un solo material y una sola geometría para los dieciséis dientes: una
 * llamada de dibujo. Las molares son anchas y las incisivas planas porque
 * cada instancia lleva su propia escala, no porque haya dos mallas.
 */

const ARCO_A = 1.52; // media anchura
const ARCO_B = 1.86; // profundidad
const N = 16;

/**
 * Perfil de un diente, de la punta de la raíz a la corona, y su tamaño
 * respecto a la arcada.
 *
 * 🔴 LA PROPORCIÓN NO ES DECORATIVA. Una arcada de adulto mide unos 55 mm
 * de ancho y un diente unos 8 mm: el diente ocupa cerca de un 29% de la
 * MEDIA anchura. Con el perfil en crudo cada diente medía 0,7 de ancho
 * contra una media anchura de 1,52 —un 46%— y dieciséis de esos no caben
 * en el arco: se encimaban y la cámara tenía que alejarse tanto que la
 * escena parecía una fila de molares gigantes. Los dos factores de abajo
 * llevan el perfil a la proporción real: ~0,44 de ancho por ~0,93 de largo
 * (algo más de 1 : 2, que es la de un diente con su raíz).
 */
const ANCHO_DIENTE = 0.62;
const LARGO_DIENTE = 0.55;

const PERFIL: THREE.Vector2[] = (
  [
    // La raíz llega a −0,80 y no a −1,12: lo que se ve de un diente es la
    // CORONA, y una raíz larga solo obliga a engordar la encía para
    // taparla — que era lo que hacía que el tubo se comiera la escena.
    [0.05, -0.8],
    [0.15, -0.62],
    [0.22, -0.4],
    [0.26, -0.16],
    [0.25, 0.02],
    [0.33, 0.26],
    [0.35, 0.5],
    [0.29, 0.72],
    [0.16, 0.86],
    [0.0, 0.9],
  ] as Array<[number, number]>
).map(([r, y]) => new THREE.Vector2(r * ANCHO_DIENTE, y * LARGO_DIENTE));

function construir({ guarda }: ContextoEscena) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);

  const marfil = guarda(
    new THREE.MeshStandardMaterial({ color: 0xf1e9db, roughness: 0.33, metalness: 0.02 }),
  );
  const encia = guarda(
    new THREE.MeshStandardMaterial({ color: 0x35508f, roughness: 0.82, metalness: 0.04 }),
  );

  const inclina = new THREE.Group(); // el vistazo desde arriba, fijo
  const gira = new THREE.Group(); // lo que da vueltas
  inclina.rotation.x = -0.52; // ~30°: se lee como un ARCO, no como una fila
  inclina.add(gira);
  scene.add(inclina);

  // ── Los dientes ───────────────────────────────────────────────────────
  const geoDiente = guarda(new THREE.LatheGeometry(PERFIL, 18));
  const dientes = new THREE.InstancedMesh(geoDiente, marfil, N);
  guarda(dientes);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eje = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const esc = new THREE.Vector3();

  for (let i = 0; i < N; i++) {
    const t = -1 + (2 * i) / (N - 1);
    const at = Math.abs(t);
    // 🔴 El signo de la Z importa: con la parábola abriendo hacia ATRÁS, los
    // incisivos quedaban al fondo y los molares delante — la arcada se veía
    // desde la garganta. Aquí los incisivos son lo más CERCA de la cámara,
    // que es como se mira una boca. Y la Y sube 0,30 para que las raíces
    // entren en la encía en vez de quedarse colgando al aire.
    pos.set(ARCO_A * t, 0.22, ARCO_B * 0.5 - ARCO_B * t * t);

    // Ancho hacia atrás (molares) y hoja plana al frente (incisivos).
    esc.set(0.72 + 0.62 * Math.pow(at, 1.3), 1.12 - 0.24 * at, 0.58 + 0.78 * Math.pow(at, 1.2));

    // Se abren un poco hacia afuera, como una arcada de verdad: el giro va
    // sobre la TANGENTE de la parábola en ese punto, así que cada diente se
    // inclina hacia el exterior de su tramo del arco y no todos hacia el
    // mismo lado.
    eje.set(ARCO_A, 0, -2 * ARCO_B * t).normalize();
    q.setFromAxisAngle(eje, 0.13);

    m.compose(pos, q, esc);
    dientes.setMatrixAt(i, m);
  }
  dientes.instanceMatrix.needsUpdate = true;
  gira.add(dientes);

  // ── La encía: un tubo sobre la misma parábola ─────────────────────────
  // Va justo bajo el cuello del diente y con radio suficiente para TAPAR
  // las raíces: una arcada con las raíces al aire no se lee como una boca,
  // se lee como un diagrama.
  const puntos: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = -1.09 + (2.18 * i) / 40;
    puntos.push(new THREE.Vector3(ARCO_A * t, -0.02, ARCO_B * 0.5 - ARCO_B * t * t));
  }
  const curva = new THREE.CatmullRomCurve3(puntos);
  const geoEncia = guarda(new THREE.TubeGeometry(curva, 60, 0.26, 14, false));
  gira.add(new THREE.Mesh(geoEncia, encia));

  // ── Sombra de contacto ────────────────────────────────────────────────
  const sombra = texturaSombra();
  if (sombra) {
    guarda(sombra);
    const matSombra = guarda(
      new THREE.MeshBasicMaterial({ map: sombra, transparent: true, depthWrite: false }),
    );
    const plano = new THREE.Mesh(guarda(new THREE.PlaneGeometry(4.6, 4.6)), matSombra);
    plano.rotation.x = -Math.PI / 2;
    plano.position.y = -0.5;
    inclina.add(plano);
  }

  // ── Luz ───────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xdbe6ff, 0x0b1226, 0.75));
  const clave = new THREE.DirectionalLight(0xfff4e4, 2.1);
  clave.position.set(3, 5, 3);
  const contra = new THREE.DirectionalLight(0x7d9ad8, 1.35);
  contra.position.set(-4, 1.5, -3);
  scene.add(clave, contra);

  /**
   * Encuadre. La caja que ocupa la arcada, medida y no adivinada:
   *   ancho  = 2·(1,52 + 0,29) ≈ 3,6
   *   fondo  = 2·(0,93 + 0,29) ≈ 2,4
   *   alto   = del bajo de la encía a la corona ≈ 1,05, centrado en y ≈ 0,25
   * Con la inclinación de 30° el alto PROYECTADO es
   * 1,05·cos30 + 2,4·sen30 ≈ 2,1. Se piden 2,6 de alto y 4,2 de ancho para
   * dejar aire, y se toma la distancia que satisface las dos.
   */
  const encuadre = (ancho: number, alto: number) => {
    camera.aspect = ancho / alto;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const porAlto = 2.6 / 2 / tan;
    const porAncho = 4.2 / 2 / (tan * camera.aspect);
    camera.position.set(0, 0.46, Math.max(porAlto, porAncho));
    camera.lookAt(0, 0.25, 0);
    camera.updateProjectionMatrix();
  };

  const frame = (dt: number) => {
    gira.rotation.y += dt * 0.26;
  };

  return { scene, camera, frame, encuadre };
}

export default function EscenaArcada({
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
