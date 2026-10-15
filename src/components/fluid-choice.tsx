"use client";

import { Fragment } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from "./ui/select";
import type { IconComponent } from "@/lib/icon-context";

export interface ChoiceItem { id: string; label: string; color?: string; group?: string }

export function FluidChoice({ label, value, items, onChange, disabled, placeholder, icon, className }: {
  label: string; value: string; items: ChoiceItem[]; onChange: (value: string) => void;
  disabled?: boolean; placeholder?: string; icon?: IconComponent; className?: string;
}) {
  const row = (item: ChoiceItem) => <SelectItem key={item.id} index={items.indexOf(item)} value={item.id}>
    {item.color ? <span className="finish-choice"><span style={{ background: item.color }} aria-hidden="true" />{item.label}</span> : item.label}
  </SelectItem>;
  // Порядок групп — порядок первого появления; индексы строк сквозные, их
  // ждёт fluid hover.
  const groups = [...new Set(items.map((item) => item.group))];
  return <Select value={value} onValueChange={onChange} disabled={disabled} size="compact">
    <SelectTrigger aria-label={label} placeholder={placeholder} icon={icon} className={className} />
    <SelectContent className="choice-content">
      {groups.length > 1 || groups[0] !== undefined
        ? groups.map((group, index) => <Fragment key={group}>
            {/* Линия между группами: без неё подписи теряются и непонятно,
                где кончается iPhone и начинается Android. */}
            {index > 0 && <SelectSeparator />}
            <SelectGroup aria-label={group}><SelectLabel>{group}</SelectLabel>{items.filter((item) => item.group === group).map(row)}</SelectGroup>
          </Fragment>)
        : items.map(row)}
    </SelectContent>
  </Select>;
}
