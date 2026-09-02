"use client";

import * as THREE from "three";
import { cedeElHilo, useEscena3D, type ContextoEscena } from "./escena-motor";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL VOLUMEN — la lectura tridimensional de una tomografía, recreada.
 *
 * El expediente del producto reconstruye el volumen a partir de los cortes
 * del estudio y lo dibuja lanzando rayos contra una textura 3D, con un mapa
 * de color de hueso (marrón oscuro → marfil). Esta escena habla ESE idioma
 * —misma técnica, mismo mapa de color— sobre un volumen INVENTADO aquí:
 *
 *   🔴 no se carga ningún estudio, ni real ni de ejemplo. Una tomografía
 *      es de una persona y no se publica en una página de ventas. El campo
 *      de densidad de abajo se calcula con una fórmula: una herradura
 *      dental con dieciséis coronas, sus raíces y el hueso que las sostiene.
 *
 * Y por eso mismo la página NUNCA nombra la unidad radiológica: el visor
 * del producto trabaja con valores relativos de densidad, y este dibujo
 * todavía menos.
 *
 * Exige WebGL 2 (las texturas 3D no existen en WebGL 1). Donde no lo hay,
 * la puerta se queda con el dibujo estático y no descarga nada.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lado del volumen. 64³ son 262 144 muestras: se calculan en unos ms. */
const S = 64;

/** Ruido barato y determinista: mismo volumen en cada carga. */
function hash(i: number, j: number, k: number): number {
  const n = Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * El campo de densidad. Coordenadas normalizadas en [-1, 1]:
 *   · una parábola en el plano XZ es la arcada;
 *   · encima de ella, dieciséis coronas moduladas con un coseno;
 *   · debajo, las raíces y el hueso alveolar que las sostiene;
 *   · y un cuerpo óseo tenue por dentro, que es lo que da la silueta.
 */
function volumen(): Uint8Array {
  const datos = new Uint8Array(S * S * S);
  let p = 0;
  for (let k = 0; k < S; k++) {
    const z = (2 * k) / (S - 1) - 1;
    for (let j = 0; j < S; j++) {
      const y = (2 * j) / (S - 1) - 1;
      for (let i = 0; i < S; i++, p++) {
        const x = (2 * i) / (S - 1) - 1;

        const zArco = 0.95 * x * x - 0.6;
        const banda = Math.max(0, 1 - Math.abs(z - zArco) / 0.2);
        const dentro = Math.max(0, 1 - Math.abs(x) / 0.84);

        let d = 0;
        if (banda > 0 && dentro > 0) {
          const lateral = Math.pow(banda, 0.6) * Math.pow(dentro, 0.32);
          const cuspide = 0.5 + 0.5 * Math.cos((x + 1) * Math.PI * 8);
          if (y > 0.02) {
            const tope = 0.4 + 0.17 * cuspide;
            d = y < tope ? lateral * (0.84 + 0.16 * cuspide) : 0;
            d *= Math.max(0, 1 - Math.max(0, (y - tope + 0.13) / 0.15));
          } else {
            const prof = Math.max(0, (y + 0.7) / 0.72);
            d = lateral * (0.3 + 0.52 * prof);
          }
        }

        const cuerpo =
          Math.max(0, 1 - Math.hypot(x / 0.92, (z + 0.12) / 0.86)) *
          Math.max(0, 1 - Math.abs(y + 0.4) / 0.32);
        d = Math.max(d, cuerpo * 0.4);

        if (d > 0) d *= 0.9 + 0.1 * hash(i, j, k);
        datos[p] = Math.max(0, Math.min(255, Math.round(d * 255)));
      }
    }
  }
  return datos;
}

/**
 * El mapa de color óseo: de marrón oscuro a marfil, con el alfa subiendo
 * con la densidad para que el aire no tape nada. Es el mismo criterio del
 * visor del expediente; los cortes están suavizados para que aquí se lea
 * como una pieza translúcida y no como un bloque.
 */
function mapaDeColor(): THREE.DataTexture {
  const paradas: Array<[number, number, number, number, number]> = [
    [0.0, 40, 28, 18, 0],
    [0.12, 120, 88, 56, 0],
    [0.24, 176, 138, 92, 110],
    [0.42, 218, 186, 140, 205],
    [0.66, 240, 222, 190, 245],
    [1.0, 255, 248, 234, 255],
  ];
  const n = 256;
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let a = 0;
    while (a < paradas.length - 2 && t > paradas[a + 1][0]) a++;
    const [t0, r0, g0, b0, a0] = paradas[a];
    const [t1, r1, g1, b1, a1] = paradas[a + 1];
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    px[i * 4] = Math.round(r0 + (r1 - r0) * f);
    px[i * 4 + 1] = Math.round(g0 + (g1 - g0) * f);
    px[i * 4 + 2] = Math.round(b0 + (b1 - b0) * f);
    px[i * 4 + 3] = Math.round(a0 + (a1 - a0) * f);
  }
  const tex = new THREE.DataTexture(px, n, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const VERTEX = /* glsl */ `
  varying vec3 vOrigen;
  varying vec3 vDireccion;
  void main() {
    vOrigen = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vDireccion = position - vOrigen;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  /**
   * 🔴 LA SALIDA SE DECLARA A MANO. En GLSL 3 three.js NO define
   * \`gl_FragColor\` para un ShaderMaterial propio —ese atajo solo lo pone
   * para sus materiales de fábrica—, así que escribir ahí no compila:
   *   ERROR: 'gl_FragColor' : undeclared identifier
   * y, como el error solo salta al ENLAZAR y no al llamar a
   * compileAsync, la escena se montaba "bien" y pintaba la caja vacía.
   * Una sola salida sin \`layout\` cae en la posición 0, que es la buena.
   */
  out vec4 salida;

  varying vec3 vOrigen;
  varying vec3 vDireccion;

  uniform sampler3D uDatos;
  uniform sampler2D uMapa;
  uniform float uPasos;
  uniform float uAlfa;
  uniform float uCorte;

  // Entrada y salida del rayo en la caja unitaria centrada en el origen.
  vec2 caja(vec3 orig, vec3 dir) {
    vec3 inv = 1.0 / dir;
    vec3 a = (vec3(-0.5) - orig) * inv;
    vec3 b = (vec3(0.5) - orig) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    return vec2(max(lo.x, max(lo.y, lo.z)), min(hi.x, min(hi.y, hi.z)));
  }

  void main() {
    vec3 dir = normalize(vDireccion);
    vec2 t = caja(vOrigen, dir);
    if (t.x > t.y) discard;
    t.x = max(t.x, 0.0);

    vec3 p = vOrigen + t.x * dir;
    float paso = (t.y - t.x) / uPasos;
    vec3 avance = dir * paso;

    vec4 acc = vec4(0.0);
    for (float i = 0.0; i < 160.0; i += 1.0) {
      if (i >= uPasos) break;
      float d = texture(uDatos, p + 0.5).r;
      if (d > 0.03) {
        vec4 c = texture(uMapa, vec2(d, 0.5));
        // El corte que recorre el volumen: una lámina azul que enciende lo
        // que atraviesa, como la cruz del visor sobre los cortes.
        // La lámina se mide en el espacio del objeto, donde la caja va de
        // −0,5 a 0,5 y un paso del rayo mide ~0,011: por debajo de 0,03 de
        // ancho no la toca ningún paso y el corte no se ve.
        float lamina = 1.0 - smoothstep(0.0, 0.032, abs(p.y - uCorte));
        vec3 col = mix(c.rgb, vec3(0.78, 0.86, 1.0), lamina * 0.85);
        float a = clamp(c.a * uAlfa + lamina * 0.14, 0.0, 1.0);
        acc.rgb += (1.0 - acc.a) * a * col;
        acc.a += (1.0 - acc.a) * a;
        if (acc.a > 0.96) break;
      }
      p += avance;
    }
    if (acc.a < 0.004) discard;
    // El acumulado va PREMULTIPLICADO por su alfa (así se compone de
    // frente hacia atrás). La mezcla normal de three vuelve a multiplicar,
    // así que se deshace aquí: si no, el volumen sale al cuadrado de
    // oscuro y el hueso se ve gris.
    salida = vec4(acc.rgb / max(acc.a, 0.0001), acc.a);
  }
`;

function construir({ guarda, ancho, webgl2 }: ContextoEscena) {
  if (!webgl2) throw new Error("el volumen necesita WebGL 2");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);

  const datos = new THREE.Data3DTexture(volumen(), S, S, S);
  datos.format = THREE.RedFormat;
  datos.type = THREE.UnsignedByteType;
  datos.minFilter = THREE.LinearFilter;
  datos.magFilter = THREE.LinearFilter;
  datos.unpackAlignment = 1;
  datos.needsUpdate = true;
  guarda(datos);

  const mapa = guarda(mapaDeColor());

  // Menos pasos en pantallas chicas: lanzar rayos es coste de píxel, y un
  // teléfono tiene muchos por pulgada y menos con qué pintarlos.
  const pasos = ancho < 540 ? 54 : 88;

  const material = guarda(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDatos: { value: datos },
        uMapa: { value: mapa },
        uPasos: { value: pasos },
        // Cuánto tapa cada muestra. Sale de dividir un "opacidad total"
        // entre los pasos: así el volumen se ve IGUAL de sólido con 54 pasos
        // en un teléfono que con 88 en un escritorio.
        uAlfa: { value: 15 / pasos },
        uCorte: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );

  const gira = new THREE.Group();
  const geoCubo = guarda(new THREE.BoxGeometry(1, 1, 1));
  const cubo = new THREE.Mesh(geoCubo, material);
  // La caja se ciñe a lo que de verdad ocupa el campo de densidad (la
  // herradura llega a ±0,84 de 1 en X y Z): con la caja más holgada, el
  // hueso se quedaba flotando en medio de un cubo medio vacío.
  cubo.scale.set(1.95, 1.4, 1.95);
  gira.add(cubo);

  // La caja del estudio, dibujada: es lo que encuadra el volumen en el visor.
  const marco = guarda(new THREE.EdgesGeometry(geoCubo));
  const lineas = new THREE.LineSegments(
    marco,
    guarda(new THREE.LineBasicMaterial({ color: 0x6c88c6, transparent: true, opacity: 0.45 })),
  );
  lineas.scale.copy(cubo.scale);
  gira.add(lineas);

  scene.add(gira);

  const encuadre = (w: number, h: number) => {
    camera.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const porAlto = 2.7 / 2 / tan;
    const porAncho = 3.4 / 2 / (tan * camera.aspect);
    camera.position.set(0, 0.55, Math.max(porAlto, porAncho));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const frame = (dt: number, t: number) => {
    gira.rotation.y += dt * 0.2;
    // El corte sube y baja despacio, de la base a las coronas.
    material.uniforms.uCorte.value = Math.sin(t * 0.42) * 0.4;
  };

  return { scene, camera, frame, encuadre };
}

export default function EscenaVolumen({
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
    { onReady, onFail, dprMax: 1.3, exigeWebgl2: true },
  );
  return <canvas ref={ref} className="dcei-canvas" />;
}
