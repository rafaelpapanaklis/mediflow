"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-brand-600 text-white shadow-[0_4px_16px_rgba(37,99,235,0.30)] hover:bg-brand-700 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(37,99,235,0.40)]",
        destructive:
          "bg-red-600 text-white hover:bg-red-700 hover:-translate-y-0.5",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted hover:border-brand-600 hover:text-brand-600",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground",
        link:
          "underline-offset-4 hover:underline text-brand-600 p-0 h-auto font-medium",
        gradient:
          "bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)] hover:shadow-[0_6px_24px_rgba(37,99,235,0.45)] hover:-translate-y-0.5",
        white:
          "bg-white text-brand-700 font-bold shadow-sm hover:bg-brand-50 hover:-translate-y-0.5",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:      "h-8 rounded-md px-3 text-xs",
        lg:      "h-12 rounded-xl px-7 text-base",
        xl:      "h-14 rounded-xl px-8 text-base font-bold",
        icon:    "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
