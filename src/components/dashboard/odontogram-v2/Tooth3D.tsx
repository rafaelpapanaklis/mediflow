"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Tooth3DProps, ToothMeta } from "./types";
import { COND_BY_ID, GROUP_COLOR } from "./data";
import { acquireTooth, releaseTooth, MODEL_CREDIT, type LoadedTooth } from "./tooth3d-model";
import { letterAtFace, faceSlotOf, mesialSign } from "./tooth3d-faces";
import { createPaintUniforms, patchToothMaterial } from "./tooth3d-paint";
import { buildToothPlan, disposeObject } from "./tooth3d-marks";

/* ============================================================
   Tooth3D — el diente real en 3D (Three.js, imperativo).

   Carga el modelo anatómico .glb del diente (tooth3d-model: University of
   Dundee, CC BY 4.0; el crédito se pinta en el escenario), clasifica sus
   caras sobre la malla (tooth3d-faces) y pinta los hallazgos con un parche
   de shader (tooth3d-paint) más marcas de diente entero (tooth3d-marks).
   Clic en una cara → onSurface(letra), igual que antes; la cara bajo el
   ratón se resalta. Si el modelo no carga, cae al diente PROCEDURAL de
   siempre (buildTooth + 5 parches), que se conserva como respaldo.

   Render ON-DEMAND (st.draw()): drag/hover, record/reset y resize llaman
   a st.draw() directamente. Sin bucle rAF perpetuo — un diente quieto
   cuesta 0 CPU/GPU entre interacciones.

   three es r0.184 (el diseño apuntaba a r134, THREE global):
   - luces × Math.PI (intensidad legacy → físicamente correcta;
     useLegacyLights se quitó en r165).
   - ColorManagement se deja en su valor global A PROPÓSITO — es un
     estático de todo el proceso y otros visores (CBCT/STL) dependen de él.
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

/** Vista inicial: la oclusal/incisal un poco hacia el espectador y el lado
 *  mesial ligeramente girado hacia delante. Con la corona hacia −Y
 *  (superiores) la inclinación va al revés que con la corona hacia +Y. */
function homeRotation(meta: ToothMeta, real: boolean): { rotX: number; rotY: number } {
  if (!real) return { rotX: -0.15, rotY: 0.5 };
  return { rotX: meta.upper ? -0.45 : 0.45, rotY: -0.4 * mesialSign(meta) };
}

interface LoadStatus { loading: boolean; pct: number; real: boolean }

export function Tooth3D({ meta, record, onSurface, style, resetKey }: Tooth3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<any>({});
  const [status, setStatus] = useState<LoadStatus>({ loading: true, pct: 0, real: false });

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
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x2a3548 : 0x9aa3b0, 0.9 * PI));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.7 * PI); d1.position.set(2, 3, 5); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.35 * PI); d2.position.set(-3, -2, 4); scene.add(d2);

    const st = stateRef.current;
    st.scene = scene; st.camera = camera; st.renderer = renderer;
    st.raycaster = new THREE.Raycaster();
    st.hover = null; st.pickables = []; st.pick = () => null;
    st.applyRecord = null; st.draw = null;
    const home = homeRotation(meta, false);
    st.rotX = home.rotX; st.rotY = home.rotY;
    const labelColor = dark ? "#9fb4d6" : "#7c8aa3";
    let cancelled = false;
    let acquired = false;
    let procedural = false;
    let ownMaterials: THREE.Material[] = [];
    let labels: THREE.Sprite[] = [];
    let root: THREE.Group | null = null;

    /* ---------------- interacción (común) ---------------- */
    let dragging = false, pressed = false, moved = 0, lastX = 0, lastY = 0, hoverRaf = 0;
    const el = renderer.domElement;
    const ndc = new THREE.Vector2();
    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // solo botón principal: el derecho ni rota ni aplica
      dragging = true; pressed = true; moved = 0; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId);
      // mientras se arrastra no hay cara "bajo el ratón": se apaga el resalte
      if (st.hover) { st.hover = null; if (st.draw) st.draw(); }
    };
    const onMove = (e: PointerEvent) => {
      setNdc(e);
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        st.rotY += dx * 0.01; st.rotX += dy * 0.01;
        st.rotX = Math.max(-1.1, Math.min(1.1, st.rotX));
        lastX = e.clientX; lastY = e.clientY;
        if (st.draw) st.draw();
      } else if (!hoverRaf) {
        // hover: un raycast por frame como mucho (la malla real tiene ~50k triángulos)
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          const h = st.pick(ndc);
          if (h !== st.hover) { st.hover = h; if (st.draw) st.draw(); }
          el.style.cursor = st.hover ? "pointer" : "grab";
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      // solo cuenta como clic si el pointerdown ocurrió AQUÍ (no al soltar una
      // selección de texto que empezó fuera) y fue corto
      const wasPressed = pressed;
      dragging = false; pressed = false;
      setNdc(e);
      const h = st.pick(ndc);
      if (wasPressed && e.button === 0 && moved < 6 && h && st.onSurface) st.onSurface(h);
      // al soltar, vuelve el resalte de la cara que quedó bajo el puntero
      if (h !== st.hover) { st.hover = h; if (st.draw) st.draw(); }
      el.style.cursor = h ? "pointer" : "grab";
    };
    const onCancel = () => { dragging = false; pressed = false; };
    const onLeave = () => { if (st.hover) { st.hover = null; if (st.draw) st.draw(); } };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("pointerleave", onLeave);
    el.style.cursor = "grab";
    // iOS: el drag rota el diente; sin esto Safari lo trata como scroll y dispara pointercancel
    el.style.touchAction = "none";

    const onResize = () => {
      const w = mount.clientWidth || 300, h = mount.clientHeight || 280;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      if (st.draw) st.draw(); // repaint on demand (setSize clears the buffer)
    };
    window.addEventListener("resize", onResize);

    /* ---------------- diente REAL (glb) ---------------- */
    const mountReal = (loaded: LoadedTooth) => {
      const info = loaded.faces;
      const u = createPaintUniforms();
      u.uTipSign.value = info.tipSign;
      u.uNeckY.value = info.neckY;
      root = new THREE.Group();
      root.scale.setScalar(1000); // metros → mm (unidades de escena)
      const meshes: THREE.Mesh[] = [];
      loaded.geometries.forEach((g, i) => {
        const mat = loaded.materials[i].clone();
        patchToothMaterial(mat, u);
        ownMaterials.push(mat);
        const m = new THREE.Mesh(g, mat);
        root.add(m);
        meshes.push(m);
      });
      // etiquetas de cara
      const dirs: Record<string, THREE.Vector3> = {
        [meta.center]: new THREE.Vector3(0, info.tipSign, 0),
        M: new THREE.Vector3(info.mesialSign, 0, 0),
        D: new THREE.Vector3(-info.mesialSign, 0, 0),
        V: new THREE.Vector3(0, 0, 1),
        L: new THREE.Vector3(0, 0, -1),
      };
      const letters = [meta.center, "M", "D", "V", "L"];
      letters.forEach((letter, k) => {
        const sp = makeLabelSprite(letter, labelColor);
        sp.position.copy(info.labelPos[k]);
        sp.scale.set(0.0026, 0.0026, 1);
        sp.userData.dir = dirs[letter];
        root!.add(sp);
        labels.push(sp);
      });
      scene.add(root);

      // encuadre: todo el diente, con el centro de la vista un poco hacia la corona
      const Lmm = info.length * 1000;
      const dist = (Lmm / 2) * 1.1 / Math.tan((camera.fov / 2) * Math.PI / 180);
      const cy = info.tipSign * Lmm * 0.08;
      camera.position.set(0, cy, dist);
      camera.lookAt(0, cy, 0);
      camera.near = dist * 0.1; camera.far = dist * 4; camera.updateProjectionMatrix();

      const h0 = homeRotation(meta, true);
      st.rotX = h0.rotX; st.rotY = h0.rotY;
      st.pickables = meshes;
      st.hidden = { crown: false, root: false };
      st.pick = (n: THREE.Vector2) => {
        st.raycaster.setFromCamera(n, camera);
        const hits = st.raycaster.intersectObjects(meshes, false);
        // el raycast no sabe de los `discard` del shader: se salta lo oculto
        // (corona con resto radicular, raíz con implante/póntico)
        for (const hit of hits) {
          if (hit.faceIndex == null) continue;
          const letter = letterAtFace((hit.object as THREE.Mesh).geometry, hit.faceIndex, meta.center);
          if (letter === null) { if (st.hidden.root) continue; return null; }
          if (st.hidden.crown) continue;
          return letter;
        }
        return null;
      };

      // three cuelga un listener 'dispose' por renderer en cada geometría y
      // textura que sube a la GPU, y renderer.dispose() no lo quita. Como las
      // geometrías/texturas viven en la caché entre montajes, se anotan los
      // listeners previos y al desmontar se quitan los que añadió ESTE renderer.
      const shared: THREE.EventDispatcher[] = [...loaded.geometries];
      loaded.materials.forEach((m: any) => {
        ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"].forEach((k) => { if (m[k]) shared.push(m[k]); });
      });
      // Los míos son exactamente los que aparecen durante MI primer render
      // (foto antes y foto justo después, síncronas): así, si otro Tooth3D
      // del mismo diente está vivo a la vez, sus listeners no se tocan.
      const listenersBefore = new Map<THREE.EventDispatcher, unknown[]>();
      shared.forEach((o: any) => listenersBefore.set(o, [...(o._listeners?.dispose ?? [])]));
      let mine: [THREE.EventDispatcher, unknown][] = [];
      st.captureRendererListeners = () => {
        shared.forEach((o: any) => {
          const before = listenersBefore.get(o) || [];
          [...(o._listeners?.dispose ?? [])].forEach((l: any) => { if (!before.includes(l)) mine.push([o, l]); });
        });
        st.captureRendererListeners = null;
      };
      st.detachRendererListeners = () => {
        mine.forEach(([o, l]) => (o as any).removeEventListener("dispose", l));
        mine = [];
      };

      st.applyRecord = () => {
        const rec = st.record || { surfaces: {}, tooth: [] };
        const plan = buildToothPlan(rec, meta, info);
        plan.faceColor.forEach((c, i) => u.uFaceColor.value[i].copy(c));
        plan.faceStyle.forEach((s, i) => { u.uFaceStyle.value[i] = s; });
        u.uHideRoot.value = plan.hideRoot ? 1 : 0;
        u.uHideCrown.value = plan.hideCrown ? 1 : 0;
        u.uApexH.value = plan.apexH;
        u.uGhost.value = plan.ghost;
        plan.bandM.forEach((b, i) => { u.uBandM.value[i] = b; });
        st.hidden = { crown: plan.hideCrown, root: plan.hideRoot };
        // con algo descartado la malla queda abierta: se ven las caras internas
        const open = plan.hideCrown || plan.hideRoot || plan.apexH > -1e8;
        ownMaterials.forEach((m: any) => {
          const side = open ? THREE.DoubleSide : THREE.FrontSide;
          if (m.side !== side) { m.side = side; m.needsUpdate = true; }
          const transparent = plan.opacity < 1;
          // transparent es un define (OPAQUE) en r184: sin needsUpdate no recompila
          if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
          m.opacity = plan.opacity;
        });
        if (st.marks) { root!.remove(st.marks); disposeObject(st.marks); }
        st.marks = new THREE.Group();
        plan.marks.forEach((o) => st.marks.add(o));
        root!.add(st.marks);
      };

      const _q = new THREE.Quaternion(), _d = new THREE.Vector3();
      st.draw = () => {
        root!.rotation.set(st.rotX, st.rotY, 0);
        root!.updateMatrixWorld();
        root!.getWorldQuaternion(_q);
        labels.forEach((sp) => {
          _d.copy(sp.userData.dir).applyQuaternion(_q);
          (sp.material as THREE.SpriteMaterial).opacity = _d.z > -0.05 ? 0.95 : 0.28;
        });
        const hs = st.hover ? faceSlotOf(st.hover) : -1;
        u.uHover.value = hs;
        renderer.render(scene, camera);
      };
      st.applyRecord();
      st.draw();
      if (st.captureRendererListeners) st.captureRendererListeners();
    };

    /* ---------------- respaldo PROCEDURAL ---------------- */
    const mountProcedural = () => {
      procedural = true;
      const tooth = buildTooth(meta, dark);
      tooth.scale.setScalar(0.92);
      scene.add(tooth);
      root = tooth;

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
        tooth.add(m);
        patches[letter] = m;
        const lab = makeLabelSprite(letter, labelColor);
        const lp: [number, number, number] = [pl.p[0], pl.p[1], pl.p[2]];
        const out = 0.34;
        if (letter === "M") lp[0] += out; else if (letter === "D") lp[0] -= out;
        else if (letter === "V") lp[2] += out; else if (letter === "L") lp[2] -= out;
        else lp[1] += out;
        lab.position.set(lp[0], lp[1], lp[2]);
        tooth.add(lab);
      });

      const h0 = homeRotation(meta, false);
      st.rotX = h0.rotX; st.rotY = h0.rotY;
      st.pickables = Object.values(patches);
      st.pick = (n: THREE.Vector2) => {
        st.raycaster.setFromCamera(n, camera);
        const hits = st.raycaster.intersectObjects(st.pickables, false);
        return hits.length ? hits[0].object.userData.letter : null;
      };

      const _wp = new THREE.Vector3(), _nrm = new THREE.Vector3(), _cd = new THREE.Vector3();
      st.applyRecord = () => {
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
        st.applyRecord();
        renderer.render(scene, camera);
      };
      st.draw();
    };

    /* ---------------- carga ---------------- */
    setStatus({ loading: true, pct: 0, real: false });
    acquired = true;
    const onProgress = (pct: number) => { if (!cancelled) setStatus({ loading: true, pct, real: false }); };
    const fallback = (why: string, err: unknown) => {
      if (cancelled) return;
      console.warn(`[Tooth3D] ${why}, se usa el diente procedural`, meta.fdi, err);
      // si el montaje real se quedó a medias, se retira antes de dibujar el procedural
      if (root) { scene.remove(root); root = null; }
      if (st.marks) { disposeObject(st.marks); st.marks = null; }
      camera.position.set(0, 0.45, 6.5); camera.lookAt(0, 0.05, 0);
      camera.near = 0.1; camera.far = 100; camera.updateProjectionMatrix();
      mountProcedural();
      setStatus({ loading: false, pct: 0, real: false });
    };
    acquireTooth(meta, onProgress)
      .then((loaded) => {
        if (cancelled) return;
        try {
          mountReal(loaded);
          setStatus({ loading: false, pct: 100, real: true });
        } catch (err) {
          fallback("fallo montando el modelo", err);
        }
      })
      .catch((err) => fallback("modelo no disponible", err));

    return () => {
      cancelled = true;
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerleave", onLeave);
      // dispose: lo propio (materiales clonados, sprites, marcas, procedural).
      // Las geometrías y texturas del glb son de la caché de tooth3d-model.
      if (st.marks) { disposeObject(st.marks); st.marks = null; }
      labels.forEach((sp) => { (sp.material as any).map?.dispose(); sp.material.dispose(); });
      labels = [];
      ownMaterials.forEach((m) => m.dispose());
      ownMaterials = [];
      if (st.detachRendererListeners) { st.detachRendererListeners(); st.detachRendererListeners = null; }
      if (root && procedural) disposeObject(root);
      if (acquired) releaseTooth(meta.fdi, onProgress);
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (el.parentNode) el.parentNode.removeChild(el);
      st.draw = null; st.applyRecord = null; st.pickables = []; st.pick = () => null;
    };
  }, [meta.fdi, style]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep latest callback (DetailPanel crea applyFace en cada render: NO repinta)
  useEffect(() => { stateRef.current.onSurface = onSurface; }, [onSurface]);

  // keep latest record, refresh colors
  useEffect(() => {
    const st = stateRef.current;
    st.record = record;
    if (st.applyRecord) st.applyRecord();
    if (st.draw) st.draw();
  }, [record]);

  // reset view
  useEffect(() => {
    const st = stateRef.current;
    if (st && resetKey != null) {
      const home = homeRotation(meta, !!status.real);
      st.rotX = home.rotX; st.rotY = home.rotY;
      if (st.draw) st.draw();
    }
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="odo-3d-mount" style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      {status.loading && (
        <div className="odo-3d-loading">Cargando modelo 3D… {status.pct}%</div>
      )}
      {status.real && <div className="odo-3d-credit">{MODEL_CREDIT}</div>}
    </div>
  );
}
