/* ============================================================
   tooth3d-paint — parche de shader que pinta los hallazgos SOBRE la
   malla real del diente, cara por cara.

   El material del glTF (MeshStandard/Physical) se conserva entero —
   textura, normal map, colores de vértice, luces— y solo se inyecta, tras
   `color_fragment`, una mezcla del color base con el color de cada región
   ponderado por los pesos por vértice de tooth3d-faces (aFaceW/aFaceW2).
   Como los pesos son continuos, la mancha sigue la forma del diente y el
   borde entre caras queda suave; como cada región tiene su color y estilo
   en un uniform, cambiar un hallazgo no toca la geometría (solo un draw).

   Estilos por región (mismo criterio visual que Surface2D):
     0 fill · 1 outline (solo el borde de la cara) · 2 stipple (punteado
     fino) · 3 dots (puntos gruesos) · 4 banda cervical (desde el cuello).
   ============================================================ */
import * as THREE from "three";

export const STYLE_FILL = 0;
export const STYLE_OUTLINE = 1;
export const STYLE_STIPPLE = 2;
export const STYLE_DOTS = 3;
export const STYLE_BAND = 4;

export interface PaintUniforms {
  uFaceColor: { value: THREE.Vector4[] };
  uFaceStyle: { value: number[] };
  uHover: { value: number };
  uHoverColor: { value: THREE.Color };
  uHideRoot: { value: number };
  uHideCrown: { value: number };
  /** descarta (corta) los vértices con altura hacia la punta < uApexH (m) */
  uApexH: { value: number };
  uTipSign: { value: number };
  uNeckY: { value: number };
  /** anchura de la banda cervical (m) para el estilo 4, por región */
  uBandM: { value: number[] };
  /** 0..1 — desatura y aclara (ausente, no erupcionado) */
  uGhost: { value: number };
}

export function createPaintUniforms(): PaintUniforms {
  return {
    uFaceColor: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uFaceStyle: { value: [0, 0, 0, 0, 0, 0] },
    uHover: { value: -1 },
    uHoverColor: { value: new THREE.Color(0x2a6fdb) },
    uHideRoot: { value: 0 },
    uHideCrown: { value: 0 },
    uApexH: { value: -1e9 },
    uTipSign: { value: 1 },
    uNeckY: { value: 0 },
    uBandM: { value: [0.002, 0.002, 0.002, 0.002, 0.002, 0.002] },
    uGhost: { value: 0 },
  };
}

const VERT_DECL = /* glsl */ `
attribute vec4 aFaceW;
attribute vec2 aFaceW2;
varying vec4 vFaceW;
varying vec2 vFaceW2;
varying vec3 vToothPos;
`;
const VERT_BODY = /* glsl */ `
vFaceW = aFaceW;
vFaceW2 = aFaceW2;
vToothPos = position;
`;
const FRAG_DECL = /* glsl */ `
uniform vec4 uFaceColor[6];
uniform float uFaceStyle[6];
uniform float uHover;
uniform vec3 uHoverColor;
uniform float uHideRoot;
uniform float uHideCrown;
uniform float uApexH;
uniform float uTipSign;
uniform float uNeckY;
uniform float uBandM[6];
uniform float uGhost;
varying vec4 vFaceW;
varying vec2 vFaceW2;
varying vec3 vToothPos;
`;
const FRAG_BODY = /* glsl */ `
{
  float tw[6];
  tw[0] = vFaceW.x; tw[1] = vFaceW.y; tw[2] = vFaceW.z; tw[3] = vFaceW.w; tw[4] = vFaceW2.x; tw[5] = vFaceW2.y;
  float hTip = uTipSign * vToothPos.y;
  if (uHideRoot > 0.5 && tw[5] > 0.5) discard;
  if (uHideCrown > 0.5 && tw[5] < 0.5) discard;
  if (hTip < uApexH) discard;
  if (uGhost > 0.0) {
    float g = dot(diffuseColor.rgb, vec3(0.3333));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g) * 0.55 + 0.42, uGhost);
  }
  vec3 mm = vToothPos * 1000.0;
  vec3 acc = vec3(0.0);
  float aacc = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = tw[i];
    float a = uFaceColor[i].a;
    if (a <= 0.0 || w <= 0.001) continue;
    float st = uFaceStyle[i];
    if (st > 0.5 && st < 1.5) {
      // outline: solo la franja de transición de la cara
      float band = smoothstep(0.06, 0.3, w) * (1.0 - smoothstep(0.42, 0.7, w));
      a *= band * 1.25;
    } else if (st > 1.5 && st < 3.5) {
      // stipple (2) / dots (3): retícula 3D de puntos en mm
      float freq = st > 2.5 ? 1.35 : 2.6;
      float rad = st > 2.5 ? 0.30 : 0.22;
      vec3 gcell = fract(mm * freq) - 0.5;
      float d = length(gcell);
      a *= w * (1.0 - smoothstep(rad - 0.05, rad + 0.03, d));
    } else if (st > 3.5) {
      // banda cervical: desde el cuello, hacia la punta en la corona y hacia el ápice en la raíz
      float dy = (vToothPos.y - uNeckY) * uTipSign; // >0 hacia la corona
      float dist = (i == 5) ? -dy : dy;
      float bw = uBandM[i];
      float band = 1.0 - smoothstep(bw * 0.85, bw, dist);
      a *= w * band;
    } else {
      a *= w;
    }
    acc += uFaceColor[i].rgb * a;
    aacc += a;
  }
  if (aacc > 0.0) {
    vec3 col = acc / aacc;
    diffuseColor.rgb = mix(diffuseColor.rgb, col, min(aacc, 1.0));
  }
  if (uHover >= 0.0) {
    float hw = 0.0;
    for (int i = 0; i < 6; i++) { if (float(i) == uHover) hw = tw[i]; }
    diffuseColor.rgb = mix(diffuseColor.rgb, uHoverColor, hw * 0.45);
  }
}
`;

/** Inyecta el pintado por caras en un material del glTF (clonado por el caller). */
export function patchToothMaterial(mat: THREE.Material, u: PaintUniforms) {
  const m = mat as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_DECL)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_DECL)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_BODY);
  };
  m.customProgramCacheKey = () => "odo-tooth-faces-v1";
  m.needsUpdate = true;
}
