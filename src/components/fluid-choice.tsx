"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import type { IconComponent } from "@/lib/icon-context";

export interface ChoiceItem { id: string; label: string; color?: string }

export function FluidChoice({ label, value, items, onChange, disabled, placeholder, icon, className }: {
  label: string; value: string; items: ChoiceItem[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; icon?: IconComponent; className?: string;
}) {
  return <Select value={value} onValueChange={onChange} disabled={disabled} size="compact">
    <SelectTrigger aria-label={label} placeholder={placeholder} icon={icon} className={className} />
    <SelectContent className="choice-content">
      {items.map((item, index) => <SelectItem key={item.id} index={index} value={item.id}>
        {item.color ? <span className="finish-choice"><span style={{ background: item.color }} aria-hidden="true" />{item.label}</span> : item.label}
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
