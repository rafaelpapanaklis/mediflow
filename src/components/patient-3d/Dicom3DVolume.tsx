"use client";
// Render 3D VOLUMÉTRICO del CBCT: construye una textura 3D (Data3DTexture) a
// partir de los cortes ya decodificados y la renderiza con ray casting usando
// el shader de volumen oficial de three.js (VolumeRenderShader1). Modo MIP
// (proyección de máxima intensidad — resalta hueso/dientes) y modo Superficie
// (iso-umbral). Rotación con OrbitControls. Submuestrea el volumen para que
// quepa en GPU.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VolumeRenderShader1 } from "three/examples/jsm/shaders/VolumeShader.js";

export interface VolSlice {
  rows: number;
  cols: number;
  pixels: Float32Array;
}

const MAX_DIM = 220; // tope por eje para no agotar VRAM (CBCT son enormes)

function grayColormap(): THREE.DataTexture {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    data[i * 4] = i;
    data[i * 4 + 1] = i;
    data[i * 4 + 2] = i;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export default function Dicom3DVolume({ slices }: { slices: VolSlice[] }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [renderstyle, setRenderstyle] = useState<0 | 1>(0); // 0 = MIP, 1 = ISO
  const [iso, setIso] = useState(0.28);
  const styleRef = useRef(renderstyle);
  styleRef.current = renderstyle;
  const isoRef = useRef(iso);
  isoRef.current = iso;

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

    // Construye el volumen normalizado a 0-255. min/max en el mismo paso.
    const vol = new Uint8Array(W * H * D);
    let minV = Infinity;
    let maxV = -Infinity;
    // 1ª pasada: min/max del volumen submuestreado.
    for (let z = 0; z < D; z++) {
      const px = slices[Math.min(depth - 1, z * sz)].pixels;
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
      const px = slices[Math.min(depth - 1, z * sz)].pixels;
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    camera.position.set(W * 0.7, -H, D * 1.8);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(W / 2, H / 2, D / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.update();

    const cmtex = grayColormap();
    const uniforms = THREE.UniformsUtils.clone(VolumeRenderShader1.uniforms);
    uniforms.u_data.value = texture;
    uniforms.u_size.value.set(W, H, D);
    uniforms.u_clim.value.set(0.12, 0.85);
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

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      uniforms.u_renderstyle.value = styleRef.current;
      uniforms.u_renderthreshold.value = isoRef.current;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const nw = mount.clientWidth || 600;
      renderer.setSize(nw, height);
      const a = nw / height;
      camera.left = (-frustum * a) / 2;
      camera.right = (frustum * a) / 2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
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
            onClick={() => setRenderstyle(0)}
            className={`text-[11px] px-2.5 py-1 rounded ${renderstyle === 0 ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            MIP
          </button>
          <button
            type="button"
            onClick={() => setRenderstyle(1)}
            className={`text-[11px] px-2.5 py-1 rounded ${renderstyle === 1 ? "bg-brand-600 text-white" : "bg-muted text-foreground border border-border"}`}
          >
            Superficie
          </button>
        </div>
        {renderstyle === 1 && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground flex-1 min-w-[160px]">
            Umbral
            <input
              type="range"
              min={0.03}
              max={0.6}
              step={0.01}
              value={iso}
              onChange={(e) => setIso(Number(e.target.value))}
              className="flex-1 accent-brand-500"
            />
          </label>
        )}
        <span className="text-[10px] text-white/40">Arrastra para rotar · scroll para zoom</span>
      </div>
    </div>
  );
}
