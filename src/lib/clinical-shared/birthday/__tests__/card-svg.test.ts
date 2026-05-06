// Clinical-shared — tests del builder SVG de tarjeta de cumpleaños.
// Caso 2 spec: Sofía Méndez 8 años (próximo 9).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBirthdayCardDataUrl, buildBirthdayCardSvg } from "../card-svg";

describe("buildBirthdayCardSvg", () => {
  it("Sofía cumple 9 — el SVG menciona el nombre y la edad", () => {
    const svg = buildBirthdayCardSvg({
      childName: "Sofía",
      ageTurning: 9,
      clinicName: "Clínica Demo",
      birthdayDate: "2027-02-15T00:00:00.000Z",
    });
    assert.match(svg, /<svg /);
    assert.match(svg, /Sofía/);
    assert.match(svg, /cumples 9 años/);
    assert.match(svg, /Clínica Demo/);
  });

  it("ageTurning=1 usa singular", () => {
    const svg = buildBirthdayCardSvg({
      childName: "Bebé",
      ageTurning: 1,
      clinicName: "C",
      birthdayDate: "2027-02-15",
    });
    assert.match(svg, /cumples 1 año/);
    // No debe haber "1 años" plural
    assert.ok(!/cumples 1 años/.test(svg));
  });

  it("escapa caracteres XML inseguros en el nombre", () => {
    const svg = buildBirthdayCardSvg({
      childName: "<script>alert(1)</script>",
      ageTurning: 5,
      clinicName: "C",
      birthdayDate: "2027-01-01",
    });
    assert.ok(!svg.includes("<script>"), "no debe inyectar script tag");
    assert.match(svg, /&lt;script&gt;/);
  });

  it("rechaza colores no-hex y cae al default", () => {
    const svg = buildBirthdayCardSvg({
      childName: "X",
      ageTurning: 3,
      clinicName: "C",
      birthdayDate: "2027-01-01",
      primaryColor: 'red"; payload',
    });
    assert.ok(!svg.includes("payload"));
    assert.match(svg, /#7c3aed/);
  });

  it("buildBirthdayCardDataUrl produce un data URL svg+xml", () => {
    const url = buildBirthdayCardDataUrl({
      childName: "Sofía",
      ageTurning: 9,
      clinicName: "C",
      birthdayDate: "2027-02-15",
    });
    assert.match(url, /^data:image\/svg\+xml;base64,/);
  });
});
