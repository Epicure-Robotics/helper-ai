"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface HtmlTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

/**
 * Simple HTML template editor with monospace font and basic features
 * Shows detected template variables below the editor
 */
export function HtmlTemplateEditor({
  value,
  onChange,
  placeholder = "Enter HTML template...",
  className,
  minHeight = "300px",
}: HtmlTemplateEditorProps) {
  const [isFocused, setIsFocused] = useState(false);

  // Extract variables from the template
  const extractVariables = (template: string): string[] => {
    const variableRegex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const variables = new Set<string>();

    let match;
    while ((match = variableRegex.exec(template)) !== null) {
      if (match[1]) {
        variables.add(match[1]);
      }
    }

    return Array.from(variables).sort();
  };

  const variables = extractVariables(value);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "relative rounded-md border border-input bg-background transition-colors",
          isFocused && "ring-2 ring-ring ring-offset-2",
        )}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className={cn(
            "w-full resize-y rounded-md bg-transparent p-3 font-mono text-sm",
            "focus:outline-none",
            "placeholder:text-muted-foreground",
          )}
          style={{ minHeight }}
          spellCheck={false}
        />
      </div>

      {variables.length > 0 && (
        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          <div className="mb-1 font-medium text-muted-foreground">Template Variables Detected:</div>
          <div className="flex flex-wrap gap-2">
            {variables.map((variable) => (
              <code key={variable} className="rounded bg-background px-2 py-1 font-mono text-xs">
                {`{${variable}}`}
              </code>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            These variables will be prompted for when using this template.
          </div>
        </div>
      )}
    </div>
  );
}
