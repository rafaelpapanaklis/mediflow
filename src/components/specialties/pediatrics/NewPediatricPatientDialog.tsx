"use client";
// Pediatrics — wizard de alta de paciente pediátrico. Implementado en commit 25.
// Stub mínimo en commit 23 para mantener tipos del PediatricPatientList.

import { Drawer } from "@/components/ui/design-system/Drawer";

export interface NewPediatricPatientDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewPediatricPatientDialog(props: NewPediatricPatientDialogProps) {
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="Nuevo paciente pediátrico"
      subtitle="Wizard"
    >
      <p className="pedi-form__hint">
        Wizard en construcción.
      </p>
    </Drawer>
  );
}
