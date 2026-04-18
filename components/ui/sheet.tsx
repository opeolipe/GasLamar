import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Sheet({ open, onOpenChange, children }: SheetProps) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onOpenChange(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <SheetContext.Provider value={{ onOpenChange }}>
      {children}
    </SheetContext.Provider>,
    document.body
  );
}

interface SheetContextValue { onOpenChange: (open: boolean) => void }
const SheetContext = React.createContext<SheetContextValue>({ onOpenChange: () => {} });

interface SheetContentProps {
  side?: "bottom" | "top" | "left" | "right";
  className?: string;
  children: React.ReactNode;
}

function SheetContent({ side = "bottom", className, children }: SheetContentProps) {
  const { onOpenChange } = React.useContext(SheetContext);

  const sideClass = {
    bottom: "inset-x-0 bottom-0",
    top: "inset-x-0 top-0",
    left: "inset-y-0 left-0",
    right: "inset-y-0 right-0",
  }[side];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn("fixed z-50 bg-white shadow-xl", sideClass, className)}
      >
        {children}
      </div>
    </>
  );
}

export { Sheet, SheetContent };
