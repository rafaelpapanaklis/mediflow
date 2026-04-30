"use client";
// Pediatrics — wrapper genérico que estandariza header/footer de los drawers de captura. Spec: §1.14, §4.A.8

import type { ReactNode } from "react";
import { Drawer, type DrawerWidth } from "@/components/ui/design-system/Drawer";

export interface CaptureDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: DrawerWidth;
  loading?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  onSubmit: () => void;
  children: ReactNode;
}

export function CaptureDrawer(props: CaptureDrawerProps) {
  const { saving, saveDisabled, saveLabel = "Guardar", onSubmit, onClose, children, ...rest } = props;
  return (
    <Drawer
      {...rest}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pedi-btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="pedi-btn pedi-btn--brand"
            onClick={onSubmit}
            disabled={saveDisabled || saving}
          >
            {saving ? "Guardando…" : saveLabel}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving && !saveDisabled) onSubmit();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (!saving && !saveDisabled) onSubmit();
          }
        }}
        className="pedi-form"
      >
        {children}
      </form>
    </Drawer>
  );
}
