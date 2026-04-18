import * as React from "react";
import { cn } from "@/components/ui/utils";

interface AccordionContextValue {
  value: string | null;
  onValueChange: (v: string | null) => void;
  collapsible: boolean;
}

const AccordionContext = React.createContext<AccordionContextValue>({
  value: null,
  onValueChange: () => {},
  collapsible: false,
});

interface AccordionProps {
  type: "single";
  collapsible?: boolean;
  className?: string;
  children: React.ReactNode;
}

function Accordion({ collapsible = false, className, children }: AccordionProps) {
  const [value, setValue] = React.useState<string | null>(null);

  function onValueChange(v: string | null) {
    if (collapsible && v === value) setValue(null);
    else setValue(v);
  }

  return (
    <AccordionContext.Provider value={{ value, onValueChange, collapsible }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

interface AccordionItemContextValue { itemValue: string }
const AccordionItemContext = React.createContext<AccordionItemContextValue>({ itemValue: "" });

interface AccordionItemProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

function AccordionItem({ value: itemValue, className, children }: AccordionItemProps) {
  return (
    <AccordionItemContext.Provider value={{ itemValue }}>
      <div className={className}>{children}</div>
    </AccordionItemContext.Provider>
  );
}

interface AccordionTriggerProps {
  className?: string;
  children: React.ReactNode;
}

function AccordionTrigger({ className, children }: AccordionTriggerProps) {
  const { value, onValueChange } = React.useContext(AccordionContext);
  const { itemValue } = React.useContext(AccordionItemContext);
  const open = value === itemValue;

  return (
    <button
      type="button"
      onClick={() => onValueChange(itemValue)}
      aria-expanded={open}
      className={cn("flex w-full items-center justify-between", className)}
    >
      {children}
      <svg
        className={cn("h-4 w-4 shrink-0 transition-transform duration-200", open && "rotate-180")}
        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

interface AccordionContentProps {
  className?: string;
  children: React.ReactNode;
}

function AccordionContent({ className, children }: AccordionContentProps) {
  const { value } = React.useContext(AccordionContext);
  const { itemValue } = React.useContext(AccordionItemContext);
  const open = value === itemValue;

  return (
    <div hidden={!open} className={className}>
      {children}
    </div>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
