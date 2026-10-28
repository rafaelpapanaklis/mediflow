// El arnés que monta el CumsSelector REAL en Chromium para
// `cums-selector-chromium.test.ts`. Lo que el selector emite se deja en
// `window.__items` para que la prueba lo lea; nada de esto se usa en el producto.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CumsSelector, type PrescriptionItemDraft } from "../cums-selector";

declare global {
  interface Window {
    __items?: PrescriptionItemDraft[];
  }
}

function Arnes() {
  const [items, setItems] = useState<PrescriptionItemDraft[]>([]);
  window.__items = items;
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--text-2)" }}>Medicamentos *</label>
      <CumsSelector items={items} onChange={setItems} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Arnes />);
