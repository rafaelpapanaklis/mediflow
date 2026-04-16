import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  { variants: { variant: {
    default: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-[0.98]",
    outline: "border border-border bg-card text-foreground hover:bg-muted",
    ghost:   "text-foreground hover:bg-muted",
    danger:  "bg-rose-600 text-white hover:bg-rose-700",
    secondary: "bg-muted text-foreground hover:bg-muted/80",
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
