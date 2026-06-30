"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", className)} {...props} />
  )
);
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// DialogContent: contenedor acotado a la altura del viewport (max-h-[90vh]) en
// columna flex con overflow oculto, con un pequeño margen lateral (w-calc) para
// que nunca toque los bordes en móvil. El HEADER (DialogHeader) y el FOOTER
// (DialogFooter) quedan fijos (shrink-0); el CUERPO entre ambos DEBE llevar
// "flex-1 overflow-y-auto min-h-0" para scrollear y que el botón de acción
// (Cobrar/Guardar) nunca quede fuera de pantalla en laptops de poca altura.
const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, onPointerDownOutside, onInteractOutside, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} aria-describedby={undefined}
        // El popover del DateField vive en un portal a <body> → Radix lo vería como
        // "afuera" y cerraría el modal al clic en mes/año/día. Lo excluimos aquí para
        // TODOS los modales que usan este wrapper (sin tocar cada uno).
        onPointerDownOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[data-datefield-popover]")) { e.preventDefault(); return; }
          onPointerDownOutside?.(e);
        }}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[data-datefield-popover]")) { e.preventDefault(); return; }
          onInteractOutside?.(e);
        }}
        className={cn("fixed left-[50%] top-[50%] z-[200] translate-x-[-50%] translate-y-[-50%] bg-white rounded-2xl shadow-card-md w-[calc(100%-2rem)] max-w-lg flex max-h-[90vh] flex-col overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95", className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col px-6 pt-6 pb-0 shrink-0", className)} {...props} />
);
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0", className)} {...props} />
);
const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Title ref={ref} className={cn("text-base font-bold text-foreground mb-4", className)} {...props} />
  )
);
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle };
