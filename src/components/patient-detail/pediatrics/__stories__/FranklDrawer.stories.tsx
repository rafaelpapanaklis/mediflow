// Pediatrics — Storybook story para FranklDrawer. Spec: §1.14, commit 20

import { useState } from "react";
import { FranklDrawer } from "../drawers/FranklDrawer";

export default {
  title: "Pediatrics/Drawers/FranklDrawer",
  component: FranklDrawer,
  parameters: { layout: "fullscreen" },
};

export const Default = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" className="pedi-btn pedi-btn--brand" onClick={() => setOpen(true)}>
          Capturar Frankl
        </button>
        <FranklDrawer
          open={open}
          onClose={() => setOpen(false)}
          patientId="demo-patient"
        />
      </>
    );
  },
};
