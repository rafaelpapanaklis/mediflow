// Pediatrics — Storybook story para Drawer base. Spec: §4.A.3, commit 20

import { useState } from "react";
import { Drawer } from "@/components/ui/design-system/Drawer";

export default {
  title: "Pediatrics/Drawer",
  component: Drawer,
  parameters: { layout: "fullscreen" },
};

export const Empty = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" className="pedi-btn" onClick={() => setOpen(true)}>Abrir</button>
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title="Drawer demo"
          subtitle="Story · estado vacío"
          width="md"
          footer={
            <button type="button" className="pedi-btn pedi-btn--brand">Guardar</button>
          }
        >
          <p className="pedi-form__hint">Cuerpo del drawer.</p>
        </Drawer>
      </>
    );
  },
};

export const Loading = {
  render: () => (
    <Drawer
      open
      onClose={() => undefined}
      title="Cargando datos"
      width="md"
      loading
    >
      <p className="pedi-form__hint">Body.</p>
    </Drawer>
  ),
};

export const SmallWidth = {
  render: () => (
    <Drawer open onClose={() => undefined} title="Drawer compacto" width="sm">
      <p className="pedi-form__hint">Variante 320px.</p>
    </Drawer>
  ),
};
