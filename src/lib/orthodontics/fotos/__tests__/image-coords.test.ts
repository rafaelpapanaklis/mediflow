// Ortodoncia — Parte 7. Tests de la conversión px-de-contenedor ↔ px-naturales-de-foto (H19).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { containRect, containerPointToImagePoint, imagePointToContainerPoint } from "../image-coords";

describe("containRect", () => {
  it("imagen más ancha que el contenedor (relativo a su alto): franjas arriba/abajo", () => {
    // Contenedor 400x400 (cuadrado), imagen 800x400 (2:1) → escala 0.5, pintada 400x200, centrada verticalmente.
    const r = containRect({ width: 400, height: 400 }, { width: 800, height: 400 });
    assert.deepEqual(r, { left: 0, top: 100, width: 400, height: 200 });
  });

  it("imagen más alta que el contenedor (relativo a su ancho): franjas a los lados", () => {
    // Contenedor 300x400 (3:4), imagen 400x400 (cuadrada) → escala 0.75, pintada 300x300, centrada horizontalmente.
    const r = containRect({ width: 300, height: 400 }, { width: 400, height: 400 });
    assert.deepEqual(r, { left: 0, top: 50, width: 300, height: 300 });
  });

  it("misma proporción: sin franjas", () => {
    const r = containRect({ width: 300, height: 400 }, { width: 600, height: 800 });
    assert.deepEqual(r, { left: 0, top: 0, width: 300, height: 400 });
  });

  it("contenedor o imagen sin medir todavía (0x0): no revienta", () => {
    const r = containRect({ width: 0, height: 0 }, { width: 800, height: 400 });
    assert.deepEqual(r, { left: 0, top: 0, width: 0, height: 0 });
  });
});

describe("containerPointToImagePoint", () => {
  const container = { width: 400, height: 400 };
  const image = { width: 800, height: 400 }; // franja de 100px arriba y abajo (ver test de containRect)

  it("el centro del contenedor cae en el centro de la imagen", () => {
    const p = containerPointToImagePoint({ x: 200, y: 200 }, container, image);
    assert.deepEqual(p, { x: 400, y: 200 });
  });

  it("una esquina de la imagen (no del contenedor) se resuelve en (0,0)", () => {
    const p = containerPointToImagePoint({ x: 0, y: 100 }, container, image);
    assert.deepEqual(p, { x: 0, y: 0 });
  });

  it("un clic en la franja negra (fuera de la imagen) da null, no se acepta", () => {
    const p = containerPointToImagePoint({ x: 200, y: 50 }, container, image);
    assert.equal(p, null);
  });

  it("un clic justo en el borde de la franja SÍ se acepta (frontera inclusiva)", () => {
    const p = containerPointToImagePoint({ x: 200, y: 100 }, container, image);
    assert.deepEqual(p, { x: 400, y: 0 });
  });

  it("no deforma: un desplazamiento igual en x e y del contenedor da el mismo desplazamiento en x e y de la imagen cuando escala es uniforme", () => {
    // escala = 0.5 en ambos ejes (no 3:4 forzado como el bug original)
    const a = containerPointToImagePoint({ x: 150, y: 150 }, container, image)!;
    const b = containerPointToImagePoint({ x: 170, y: 170 }, container, image)!;
    assert.equal(b.x - a.x, b.y - a.y);
  });
});

describe("imagePointToContainerPoint", () => {
  it("es la inversa de containerPointToImagePoint", () => {
    const container = { width: 300, height: 400 };
    const image = { width: 400, height: 400 };
    const original = { x: 250, y: 180 };
    const back = imagePointToContainerPoint(original, container, image);
    const forward = containerPointToImagePoint(back, container, image);
    assert.equal(Math.round(forward!.x), original.x);
    assert.equal(Math.round(forward!.y), original.y);
  });
});
