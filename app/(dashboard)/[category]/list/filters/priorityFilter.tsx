import { Flame } from "lucide-react";
import { memo } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterButton } from "@/components/ui/filter-button";
import { LEAD_PRIORITY_LABELS, LEAD_PRIORITY_ORDER, type LeadPriorityValue } from "@/lib/leads/leadPriority";

export const PriorityFilter = memo(function PriorityFilter({
  priority,
  onChange,
}: {
  priority: LeadPriorityValue[];
  onChange: (priority: LeadPriorityValue[]) => void;
}) {
  const toggle = (value: LeadPriorityValue) =>
    onChange(priority.includes(value) ? priority.filter((p) => p !== value) : [...priority, value]);

  const label =
    priority.length === 0
      ? "Priority"
      : priority.length === 1
        ? LEAD_PRIORITY_LABELS[priority[0]!]
        : `${priority.length} priorities`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton isActive={priority.length > 0} icon={Flame} label={label} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-xs">
        {LEAD_PRIORITY_ORDER.map((value) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={priority.includes(value)}
            onCheckedChange={() => toggle(value)}
            onSelect={(event) => event.preventDefault()}
          >
            {LEAD_PRIORITY_LABELS[value]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
