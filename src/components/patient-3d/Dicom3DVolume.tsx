"use client";
// Render 3D VOLUMÉTRICO del CBCT: construye una textura 3D (Data3DTexture) a
// partir de los cortes ya decodificados y la renderiza con ray casting usando
// el shader de volumen oficial de three.js (VolumeRenderShader1).
//
// Por DEFECTO usa el modo SÓLIDO (iso-superficie con sombreado Phong) + un
// colormap ÓSEO (marrón oscuro → marfil) para que el hueso/diente se vea como
// "tejido duro" estilo software dental (Planmeca Romexis). El modo MIP
// (proyección de máxima intensidad, look radiográfico) queda como secundario.
//
// Orientación anatómica: el eje Z del volumen es superior↔inferior; lo
// invertimos al construir la textura para que el cráneo quede DERECHO (frente
// arriba, mandíbula abajo) con camera.up = +Z. Rotación con OrbitControls.
// Submuestrea el volumen para que quepa en GPU.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VolumeRenderShader1 } from "three/examples/jsm/shaders/VolumeShader.js";

export interface VolSlice {
  rows: number;
  cols: number;
  pixels: Float32Array;
}

const MAX_DIM = 256; // tope por eje para no agotar VRAM (CBCT son enormes)

// Colormap ÓSEO/MARFIL: interpola de marrón oscuro → marfil/crema (R y G altos,
// B medio) para que el hueso se vea natural y con relieve. El alfa sube rápido
// con la densidad: aire/tejido blando transparente, hueso opaco. Sirve igual
// para MIP (descarta el aire) que para Superficie/ISO (hueso sólido).
function boneColormap(): THREE.DataTexture {
  const stops: Array<[number, number, number, number, number]> = [
    // t,    R,    G,    B,    A
    [0.0, 50, 35, 22, 0],
    [0.1, 135, 100, 65, 200],
    [0.25, 200, 165, 120, 255],
    [0.45, 230, 205, 165, 255],
    [0.7, 245, 230, 200, 255],
    [1.0, 255, 250, 235, 255],
  ];
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const span = b[0] - a[0] || 1;
    let f = (t - a[0]) / span;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    data[i * 4] = Math.round(a[1] + (b[1] - a[1]) * f);
    data[i * 4 + 1] = Math.round(a[2] + (b[2] - a[2]) * f);
    data[i * 4 + 2] = Math.round(a[3] + (b[3] - a[3]) * f);
    data[i * 4 + 3] = Math.round(a[4] + (b[4] - a[4]) * f);
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export default function Dicom3DVolume({ slices }: { slices: VolSlice[] }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [renderstyle, setRenderstyle] = useState<0 | 1>(1); // 1 = Sólido/ISO (defecto), 0 = MIP
  const [iso, setIso] = useState(0.36); // umbral que aísla hueso/diente
  const styleRef = useRef(renderstyle);
  styleRef.current = renderstyle;
  const isoRef = useRef(iso);
  isoRef.current = iso;
  // Render BAJO DEMANDA: el efecto del visor publica aquí su "pedir un frame"
  // para que los cambios de estilo/umbral (estado de React, que NO re-ejecutan
  // el efecto) puedan despertar el loop y pintar un cuadro nuevo.
  const requestRenderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || slices.length === 0) return;

    const cols = slices[0].cols;
    const rows = slices[0].rows;
    const depth = slices.length;

    // Factor de submuestreo por eje.
    const sx = Math.max(1, Math.ceil(cols / MAX_DIM));
    const sy = Math.max(1, Math.ceil(rows / MAX_DIM));
    const sz = Math.max(1, Math.ceil(depth / MAX_DIM));
    const W = Math.max(1, Math.floor(cols / sx));
    const H = Math.max(1, Math.floor(rows / sy));
    const D = Math.max(1, Math.floor(depth / sz));

    // Mapeo plano-de-textura → corte del estudio con el eje Z INVERTIDO: el
    // cráneo venía boca abajo, así que el corte más alto del set se coloca al
    // tope del volumen para que, con camera.up = +Z, quede derecho.
    const srcZ = (z: number) => slices[Math.min(depth - 1, (D - 1 - z) * sz)].pixels;

    // Construye el volumen normalizado a 0-255. min/max en el mismo paso.
    const vol = new Uint8Array(W * H * D);
    let minV = Infinity;
    let maxV = -Infinity;
    // 1ª pasada: min/max del volumen submuestreado.
    for (let z = 0; z < D; z++) {
      const px = srcZ(z);
      for (let y = 0; y < H; y++) {
        const row = y * sy * cols;
        for (let x = 0; x < W; x++) {
          const v = px[row + x * sx];
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
    }
    if (!Number.isFinite(minV)) {
      minV = 0;
      maxV = 255;
    }
    const range = maxV - minV || 1;
    // 2ª pasada: normaliza.
    let p = 0;
    for (let z = 0; z < D; z++) {
      const px = srcZ(z);
      for (let y = 0; y < H; y++) {
        const row = y * sy * cols;
        for (let x = 0; x < W; x++) {
          let g = ((px[row + x * sx] - minV) / range) * 255;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          vol[p++] = g;
        }
      }
    }

    const texture = new THREE.Data3DTexture(vol, W, H, D);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    (texture as any).unpackAlignment = 1;
    texture.needsUpdate = true;

    const width = mount.clientWidth || 600;
    const height = 460;

    // antialias:false → el MSAA solo suaviza los bordes del cubo contenedor; el
    // ray casting de volumen no se beneficia, así que es coste inútil de GPU.
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const aspect = width / height;
    const frustum = Math.max(W, H, D) * 1.4;
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.01,
      frustum * 12,
    );
    // Vista frontal anatómica: cámara delante de la cara (Y anterior), un poco a
    // un lado y arriba para dar volumen. "Arriba" en pantalla = eje Z = superior
    // del cráneo (con la inversión de Z de arriba → frente arriba, mandíbula
    // abajo, mirando al frente).
    camera.up.set(0, 0, 1);
    camera.position.set(W * 0.6, -H * 1.5, D * 0.62);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(W / 2, H / 2, D / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.update();

    const cmtex = boneColormap();
    const uniforms = THREE.UniformsUtils.clone(VolumeRenderShader1.uniforms);
    uniforms.u_data.value = texture;
    uniforms.u_size.value.set(W, H, D);
    uniforms.u_clim.value.set(0.12, 0.9);
    uniforms.u_renderstyle.value = styleRef.current;
    uniforms.u_renderthreshold.value = isoRef.current;
    uniforms.u_cmdata.value = cmtex;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VolumeRenderShader1.vertexShader,
      fragmentShader: VolumeRenderShader1.fragmentShader,
      side: THREE.BackSide,
    });

    const geometry = new THREE.BoxGeometry(W, H, D);
    geometry.translate(W / 2, H / 2, D / 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // --- RENDER BAJO DEMANDA ---------------------------------------------
    // Antes se llamaba renderer.render() en CADA frame aunque la imagen
    // estuviera quieta: el ray casting de volumen (fragment shader pesado)
    // mantenía la GPU al 100% y fundía la batería con el modelo inmóvil.
    // Ahora solo pintamos cuando algo cambió.
    let needsRender = true; // pinta el primer cuadro
    const requestRender = () => {
      needsRender = true;
    };
    // OrbitControls dispara 'change' en cada cambio de cámara (arrastre, zoom,
    // pan) y en cada paso de la inercia del damping hasta que se asienta.
    controls.addEventListener("change", requestRender);
    requestRenderRef.current = requestRender;

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      // autoRotate (si se activa) mueve la cámara solo: hay que seguir pintando.
      if (controls.autoRotate) needsRender = true;
      // update() aplica el damping; al mover la cámara emite 'change' (que
      // vuelve a pedir frame) hasta que la inercia cae bajo el umbral y para.
      controls.update();
      if (needsRender) {
        uniforms.u_renderstyle.value = styleRef.current;
        uniforms.u_renderthreshold.value = isoRef.current;
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth || 600;
      renderer.setSize(nw, height);
      const a = nw / height;
      camera.left = (-frustum * a) / 2;
      camera.right = (frustum * a) / 2;
      camera.updateProjectionMatrix();
      requestRender(); // el cambio de tamaño necesita un cuadro nuevo
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.removeEventListener("change", requestRender);
      requestRenderRef.current = null;
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      cmtex.dispose();
      renderer.dispose();
      (renderer as any).forceContextLoss?.();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [slices]);

  // Estilo (MIP/ISO) y umbral viven en estado de React: cambiarlos NO
  // re-ejecuta el efecto del visor, así que pedimos un frame para reflejarlos.
  useEffect(() => {
    requestRenderRef.current?.();
  }, [renderstyle, iso]);

  return (
    <div>
      <div
        ref={mountRef}
        style={{ width: "100%", height: 460, background: "#000", borderRadius: 8, overflow: "hidden" }}
      />
      <div className="mt-3 flex items-center gap-3 flex-wrap bg-muted/40 rounded-lg p-3 border border-border">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setRenderstyle(1)}
            title="Superficie ósea sombreada (ISO) — estilo tejido duro"
            className={`text-[11px] px-2.5 py-1 rounded ${renderstyle === 1 ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            Sólido
          </button>
          <button
            type="button"
            onClick={() => setRenderstyle(0)}
            title="Proyección de máxima intensidad (look radiográfico)"
            className={`text-[11px] px-2.5 py-1 rounded ${renderstyle === 0 ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            MIP
          </button>
        </div>
        {renderstyle === 1 && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground flex-1 min-w-[160px]">
            Umbral
            <input
              type="range"
              min={0.12}
              max={0.6}
              step={0.01}
              value={iso}
              onChange={(e) => setIso(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              aria-label="Umbral de hueso (talla más o menos tejido)"
            />
          </label>
        )}
        <span className="text-[10px] text-muted-foreground">Arrastra para rotar · scroll para zoom</span>
      </div>
    </div>
  );
}
