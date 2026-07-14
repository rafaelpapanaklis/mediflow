import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-[.45]",
  { variants: { variant: {
    default: "bg-brand-600 text-white shadow-[var(--shadow-1)] hover:bg-brand-700 hover:shadow-[var(--shadow-2)] active:scale-[0.98]",
    outline: "border border-border bg-card text-foreground shadow-[var(--shadow-1)] hover:bg-muted active:scale-[0.98]",
    ghost:   "text-foreground hover:bg-muted active:scale-[0.98]",
    danger:  "bg-rose-600 text-white shadow-[var(--shadow-1)] hover:bg-rose-700 hover:shadow-[var(--shadow-2)] active:scale-[0.98]",
    secondary: "bg-muted text-foreground hover:bg-muted/80 active:scale-[0.98]",
  }, size: {
    default: "h-10 px-4 py-2",
    sm:      "h-8 px-3 text-xs",
    lg:      "h-11 px-6 text-base",
    icon:    "h-9 w-9",
  }}, defaultVariants: { variant: "default", size: "default" }}
);
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean; }
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";
export { Button, buttonVariants };
