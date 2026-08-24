"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HtmlTemplatePreviewProps {
  templateName: string;
  htmlContent: string;
  onRemove: () => void;
  onChange?: (content: string) => void;
  className?: string;
}

/**
 * Inline editable preview for HTML email templates
 * Shows the HTML with contentEditable in an iframe to preserve styles
 * Click directly in the preview to edit
 */
export function HtmlTemplatePreview({
  templateName,
  htmlContent,
  onRemove,
  onChange,
  className,
}: HtmlTemplatePreviewProps) {
  const [editedContent, setEditedContent] = useState(htmlContent);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isUpdatingFromIframe = useRef(false);

  // Update iframe content when it changes
  useEffect(() => {
    if (iframeRef.current && !isUpdatingFromIframe.current) {
      const iframe = iframeRef.current;
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(editedContent);
        iframeDoc.close();

        // Make the body content editable
        if (iframeDoc.body) {
          iframeDoc.body.contentEditable = "true";
          iframeDoc.body.style.outline = "none";
          iframeDoc.body.style.padding = "16px";
          iframeDoc.body.style.minHeight = "200px";

          // Listen for input changes in the iframe
          iframeDoc.body.addEventListener("input", () => {
            isUpdatingFromIframe.current = true;
            const newContent = iframeDoc.documentElement.outerHTML;
            setEditedContent(newContent);
            onChange?.(newContent);
            setTimeout(() => {
              isUpdatingFromIframe.current = false;
            }, 0);
          });
        }
      }
    }
  }, [editedContent, onChange]);

  return (
    <div className={cn("flex flex-col border rounded-lg bg-background", className)}>
      <div className="flex items-center justify-between border-b p-3 bg-muted/50">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">{templateName}</div>
          <span className="text-xs text-muted-foreground">HTML Template - Click to edit</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0" title="Remove template">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="w-full bg-white overflow-auto max-h-[500px]">
        <iframe
          ref={iframeRef}
          className="w-full border-0 block"
          style={{ height: "auto", minHeight: "200px" }}
          title={`Preview: ${templateName}`}
          sandbox="allow-same-origin"
          onLoad={(e) => {
            const iframe = e.currentTarget;
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                const height = iframeDoc.documentElement.scrollHeight;
                iframe.style.height = `${Math.max(height, 200)}px`;
              }
            } catch {
              // Cross-origin restrictions, keep default height
            }
          }}
        />
      </div>
    </div>
  );
}
