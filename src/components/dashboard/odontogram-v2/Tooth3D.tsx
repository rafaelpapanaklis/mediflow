"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Tooth3DProps, ToothMeta } from "./types";
import { COND_BY_ID, GROUP_COLOR } from "./data";

/* ============================================================
   Tooth3D — procedural 3D tooth (Three.js, imperative).
   Rotatable (drag) with 5 clickable face patches synced to record.
   Ported 1:1 from the design handoff (jsx/tooth3d.jsx).

   Render is ON-DEMAND (st.draw()) in addition to a rAF loop:
   rAF pauses in headless/background, so every interaction and
   every record/reset change calls st.draw() directly to guarantee
   a frame. Both mechanisms are intentionally kept.

   three is r0.184 here (design targeted r134, global THREE):
   - lights scaled by Math.PI (legacy→physically-correct intensity;
     useLegacyLights was removed in r165).
   - ColorManagement is left at its global default ON PURPOSE — it is
     a process-wide static and other viewers (CBCT/STL) rely on it.
   ============================================================ */

function buildTooth(meta: ToothMeta, dark: boolean): THREE.Group {
  const g = new THREE.Group();
  const enamel = new THREE.MeshStandardMaterial({ color: dark ? 0xe8e2d2 : 0xf2ece0, roughness: 0.5, metalness: 0.04 });
  const rootMat = new THREE.MeshStandardMaterial({ color: dark ? 0xddd0b8 : 0xe7dcc4, roughness: 0.62, metalness: 0.03 });

  // ----- crown -----
  let sx = 1.05, sy = 0.95, sz = 1.05;
  if (meta.type === "central" || meta.type === "lateral") { sx = 1.18; sy = 1.18; sz = 0.5; }
  else if (meta.type === "canine") { sx = 0.95; sy = 1.25; sz = 0.7; }
  else if (meta.type === "premolar") { sx = 0.92; sy = 1.0; sz = 1.0; }

  const crownGeo = new THREE.SphereGeometry(0.92, 44, 30);
  const pos = crownGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.2) pos.setY(i, -0.2); // flatten base
  }
  crownGeo.computeVertexNormals();
  const crown = new THREE.Mesh(crownGeo, enamel);
  crown.scale.set(sx, sy, sz);
  crown.position.y = 0.55;
  g.add(crown);

  // cusps for posterior / tip for canine
  const cuspGeo = new THREE.SphereGeometry(0.3, 24, 18);
  const addCusp = (x: number, z: number, r: number) => {
    const c = new THREE.Mesh(cuspGeo, enamel);
    c.position.set(x * sx, 0.55 + 0.78 * sy, z * sz);
    c.scale.setScalar(r);
    g.add(c);
  };
  if (meta.type === "molar") { addCusp(0.42, 0.42, 1); addCusp(-0.42, 0.42, 1); addCusp(0.42, -0.42, 0.92); addCusp(-0.42, -0.42, 0.92); }
  else if (meta.type === "premolar") { addCusp(0.0, 0.42, 1); addCusp(0.0, -0.42, 0.9); }
  else if (meta.type === "canine") { addCusp(0, 0, 1.0); }

  // ----- roots -----
  let rootPos: number[][];
  if (meta.roots <= 1) rootPos = [[0, 0]];
  else if (meta.roots === 2) rootPos = [[-0.45, 0], [0.45, 0]];
  else rootPos = [[-0.42, 0.26], [0.42, 0.26], [0, -0.34]];
  rootPos.forEach(([x, z]) => {
    const rg = new THREE.CylinderGeometry(0.05, 0.32, 1.5, 18);
    const r = new THREE.Mesh(rg, rootMat);
    r.position.set(x, -0.55, z);
    r.rotation.z = x * 0.18;
    r.rotation.x = -z * 0.2;
    g.add(r);
  });

  g.userData.crownTop = 0.55 + 0.95 * sy;
  g.userData.sx = sx; g.userData.sz = sz;
  return g;
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = "bold 76px 'Plus Jakarta Sans', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; // label is a color image
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.42, 0.42, 1);
  return sp;
}

export function Tooth3D({ meta, record, onSurface, style, resetKey }: Tooth3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<any>({});

  // init scene — full teardown/rebuild only when the tooth or style changes
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const dark = style === "mono";
    const W = mount.clientWidth || 300, H = mount.clientHeight || 280;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
    camera.position.set(0, 0.45, 6.5);
    camera.lookAt(0, 0.05, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);

    // legacy r134 intensities → ×PI for r184 physically-correct lights
    const PI = Math.PI;
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x2a3548 : 0x9aa3b0, 0.95 * PI));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75 * PI); d1.position.set(3, 5, 4); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.35 * PI); d2.position.set(-3, 1, 3); scene.add(d2);

    const tooth = buildTooth(meta, dark);
    tooth.scale.setScalar(0.92);
    scene.add(tooth);

    // face patches
    const order = meta.center === "O" ? ["O", "M", "D", "V", "L"] : ["I", "M", "D", "V", "L"];
    const cy = 0.55, sx = tooth.userData.sx, sz = tooth.userData.sz;
    const placements: Record<string, { p: [number, number, number]; r: [number, number, number] }> = {
      O: { p: [0, tooth.userData.crownTop + 0.16, 0], r: [-Math.PI / 2, 0, 0] },
      I: { p: [0, tooth.userData.crownTop + 0.16, 0], r: [-Math.PI / 2, 0, 0] },
      M: { p: [sx * 0.92 + 0.18, cy, 0], r: [0, Math.PI / 2, 0] },
      D: { p: [-sx * 0.92 - 0.18, cy, 0], r: [0, -Math.PI / 2, 0] },
      V: { p: [0, cy, sz * 0.92 + 0.18], r: [0, 0, 0] },
      L: { p: [0, cy, -sz * 0.92 - 0.18], r: [0, Math.PI, 0] },
    };
    const patches: Record<string, THREE.Mesh> = {};
    order.forEach((letter) => {
      const pl = placements[letter];
      const isTop = letter === "O" || letter === "I";
      const geo = new THREE.PlaneGeometry(isTop ? 1.25 * sx : 0.98, isTop ? 1.25 * sz : 1.08);
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fb0c6, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pl.p[0], pl.p[1], pl.p[2]);
      m.rotation.set(pl.r[0], pl.r[1], pl.r[2]);
      m.userData.letter = letter;
      m.renderOrder = 3;
      scene.add(m);
      patches[letter] = m;
      // label
      const lab = makeLabelSprite(letter, dark ? "#9fb4d6" : "#7c8aa3");
      const lp: [number, number, number] = [pl.p[0], pl.p[1], pl.p[2]];
      const out = 0.34;
      if (letter === "M") lp[0] += out; else if (letter === "D") lp[0] -= out;
      else if (letter === "V") lp[2] += out; else if (letter === "L") lp[2] -= out;
      else lp[1] += out;
      lab.position.set(lp[0], lp[1], lp[2]);
      scene.add(lab);
    });

    const st = stateRef.current;
    st.scene = scene; st.camera = camera; st.renderer = renderer;
    st.tooth = tooth; st.patches = patches; st.raycaster = new THREE.Raycaster();
    st.rotX = -0.15; st.rotY = 0.5; st.hover = null;

    // interaction
    let dragging = false, moved = 0, lastX = 0, lastY = 0;
    const el = renderer.domElement;
    const ndc = new THREE.Vector2();
    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const onDown = (e: PointerEvent) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      setNdc(e);
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        st.rotY += dx * 0.01; st.rotX += dy * 0.01;
        st.rotX = Math.max(-1.1, Math.min(1.1, st.rotX));
        lastX = e.clientX; lastY = e.clientY;
        if (st.draw) st.draw();
      } else {
        // hover detection
        st.raycaster.setFromCamera(ndc, camera);
        const hits = st.raycaster.intersectObjects(Object.values(patches), false);
        const h = hits.length ? hits[0].object.userData.letter : null;
        if (h !== st.hover) { st.hover = h; if (st.draw) st.draw(); }
        el.style.cursor = st.hover ? "pointer" : "grab";
      }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (moved < 6) {
        setNdc(e);
        st.raycaster.setFromCamera(ndc, camera);
        const hits = st.raycaster.intersectObjects(Object.values(patches), false);
        if (hits.length && st.onSurface) st.onSurface(hits[0].object.userData.letter);
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.style.cursor = "grab";

    // Put patches+labels inside the tooth group so they rotate together
    Object.values(patches).forEach((p) => { scene.remove(p); tooth.add(p); });
    scene.children.filter((c) => c instanceof THREE.Sprite).forEach((s) => { scene.remove(s); tooth.add(s); });

    let raf = 0;
    const loop = () => { if (st.draw) st.draw(); raf = requestAnimationFrame(loop); };

    const onResize = () => {
      const w = mount.clientWidth || 300, h = mount.clientHeight || 280;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      if (st.draw) st.draw(); // repaint on demand (setSize clears the buffer)
    };
    window.addEventListener("resize", onResize);

    const _wp = new THREE.Vector3(), _nrm = new THREE.Vector3(), _cd = new THREE.Vector3();
    st.applyColors = () => {
      const rec = st.record || { surfaces: {} };
      Object.entries(patches).forEach(([letter, m]) => {
        const arr = rec.surfaces && rec.surfaces[letter];
        const hovered = st.hover === letter;
        m.getWorldPosition(_wp); m.getWorldDirection(_nrm);
        _cd.subVectors(camera.position, _wp).normalize();
        const facing = _nrm.dot(_cd) > -0.05;
        const dim = facing ? 1 : 0.16;
        const mat = m.material as THREE.MeshBasicMaterial;
        const c = arr && arr.length ? COND_BY_ID[arr[arr.length - 1]] : null;
        if (c) {
          mat.color.set(GROUP_COLOR[c.group]); // hex string from data.ts
          mat.opacity = (hovered ? 0.95 : 0.82) * dim;
        } else {
          mat.color.set(0x2a6fdb);
          mat.opacity = (hovered ? 0.34 : 0) * dim;
        }
      });
    };
    st.draw = () => {
      tooth.rotation.set(st.rotX, st.rotY, 0);
      st.applyColors();
      renderer.render(scene, camera);
    };
    st.draw();
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      // full dispose: geometries, materials, and sprite/canvas textures
      scene.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        const om = obj.material;
        if (om) {
          const mats = Array.isArray(om) ? om : [om];
          mats.forEach((mat: any) => { if (mat.map) mat.map.dispose(); mat.dispose(); });
        }
      });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (el.parentNode) el.parentNode.removeChild(el);
      st.draw = null;
    };
  }, [meta.fdi, style]);

  // keep latest record + callback, refresh colors
  useEffect(() => {
    const st = stateRef.current;
    st.record = record; st.onSurface = onSurface;
    if (st.draw) st.draw();
  }, [record, onSurface]);

  // reset view
  useEffect(() => {
    const st = stateRef.current;
    if (st && resetKey != null) { st.rotX = -0.15; st.rotY = 0.5; if (st.draw) st.draw(); }
  }, [resetKey]);

  return <div className="odo-3d-mount" ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
