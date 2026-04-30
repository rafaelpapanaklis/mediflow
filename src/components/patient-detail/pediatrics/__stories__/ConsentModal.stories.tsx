// Pediatrics — Storybook story para ConsentModal. Spec: §1.15, commit 20

import { useState } from "react";
import { ConsentModal } from "../modals/ConsentModal";

export default {
  title: "Pediatrics/Modals/ConsentModal",
  component: ConsentModal,
  parameters: { layout: "fullscreen" },
};

export const Default = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" className="pedi-btn pedi-btn--brand" onClick={() => setOpen(true)}>
          Abrir consentimiento
        </button>
        <ConsentModal
          open={open}
          onClose={() => setOpen(false)}
          consentId="demo"
          procedureLabel="Pulpotomía"
          patientName="Mateo Hernández García"
          guardianName="Laura García"
          minorAssentRequired={false}
        />
      </>
    );
  },
};

export const ConAsentimientoMenor = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <ConsentModal
        open={open}
        onClose={() => setOpen(false)}
        consentId="demo-2"
        procedureLabel="Sedación consciente"
        patientName="Diego Torres"
        guardianName="Marta Torres"
        minorAssentRequired
      />
    );
  },
};
