"use client";
// Orthodontics — STL viewer 3D dynamic con Three.js + STLLoader. SPEC §6.10.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface STLViewer3DProps {
  url: string;
  onClose?: () => void;
}

export default function STLViewer3D({ url, onClose }: STLViewer3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d11);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 80);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(50, 50, 50);
    scene.add(ambient);
    scene.add(directional);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    let mesh: THREE.Mesh | null = null;
    const loader = new STLLoader();
    loader.load(
      url,
      (geometry) => {
        geometry.center();
        const material = new THREE.MeshPhongMaterial({
          color: 0xc8d4e2,
          specular: 0x222222,
          shininess: 80,
        });
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        // Auto-fit camera al bounding box.
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3()).length();
        camera.position.set(0, 0, size * 1.4);
        controls.update();
      },
      undefined,
      (err) => {
        console.error("STL load failed", err);
      },
    );

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [url]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          Modelo 3D STL · arrastra para rotar, scroll para zoom
        </span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cerrar
          </button>
        ) : null}
      </header>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 600,
          background: "#0b0d11",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      />
    </div>
  );
}
