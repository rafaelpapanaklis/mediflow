// Ortodoncia — Parte 7. Tests de la geometría pura compartida.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  angleAtVertex,
  angleBetweenLines,
  distance,
  pxToMm,
  signedDistanceToLine,
  signedDistanceToPerpendicularLine,
} from "../geometria-plana";

describe("angleAtVertex", () => {
  it("ángulo recto entre dos rayos perpendiculares", () => {
    const v = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 0, y: 10 };
    assert.equal(Math.round(angleAtVertex(v, p1, p2)), 90);
  });

  it("ángulo 0° cuando los dos rayos coinciden", () => {
    const v = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    assert.equal(angleAtVertex(v, p1, p1), 0);
  });

  it("ángulo 180° con rayos opuestos", () => {
    const v = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: -10, y: 0 };
    assert.equal(Math.round(angleAtVertex(v, p1, p2)), 180);
  });
});

describe("angleBetweenLines", () => {
  it("dos líneas paralelas dan 0°", () => {
    const a = angleBetweenLines({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 });
    assert.equal(Math.round(a), 0);
  });

  it("líneas perpendiculares dan 90° aunque no se toquen", () => {
    const a = angleBetweenLines({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 100 });
    assert.equal(Math.round(a), 90);
  });
});

describe("signedDistanceToLine", () => {
  it("distancia 0 para un punto sobre la recta", () => {
    const d = signedDistanceToLine({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    assert.equal(d, 0);
  });

  it("signos opuestos a cada lado de la recta", () => {
    const above = signedDistanceToLine({ x: 5, y: -5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    const below = signedDistanceToLine({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    assert.equal(Math.sign(above), -Math.sign(below));
  });
});

describe("distance", () => {
  it("distancia euclidiana 3-4-5", () => {
    assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});

describe("pxToMm", () => {
  it("convierte con calibración válida", () => {
    assert.equal(pxToMm(100, 10), 10);
  });

  it("devuelve null sin calibración (0 o negativa)", () => {
    assert.equal(pxToMm(100, 0), null);
    assert.equal(pxToMm(100, -5), null);
  });
});

describe("signedDistanceToPerpendicularLine", () => {
  // FH horizontal (Or→Po en +x); la perpendicular por N es entonces una
  // vertical (+y) que pasa por N — equivalente a medir la componente X.
  const OR = { x: 0, y: 100 };
  const PO = { x: 100, y: 100 };
  const N = { x: 50, y: 0 };

  it("distancia 0 para un punto sobre la perpendicular", () => {
    const d = signedDistanceToPerpendicularLine({ x: 50, y: 40 }, N, OR, PO);
    assert.equal(Math.round(d), 0);
  });

  it("misma magnitud que la distancia X directa cuando FH es horizontal", () => {
    const p = { x: 80, y: 40 }; // 30 a la derecha de la vertical por N
    const d = signedDistanceToPerpendicularLine(p, N, OR, PO);
    assert.equal(Math.round(Math.abs(d)), 30);
  });

  it("signos opuestos a cada lado de la perpendicular", () => {
    const left = signedDistanceToPerpendicularLine({ x: 20, y: 40 }, N, OR, PO);
    const right = signedDistanceToPerpendicularLine({ x: 80, y: 40 }, N, OR, PO);
    assert.equal(Math.sign(left), -Math.sign(right));
  });
});
