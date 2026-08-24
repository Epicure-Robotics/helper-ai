import "@/components/linkCta.css";
import DOMPurify from "isomorphic-dompurify";
import MessageMarkdown from "@/components/messageMarkdown";
import { extractEmailPartsFromDocument } from "@/lib/shared/html";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { cn } from "@/lib/utils";

const extractEmailParts = (htmlString: string) =>
  extractEmailPartsFromDocument(
    new DOMParser().parseFromString(DOMPurify.sanitize(htmlString, { FORBID_TAGS: ["script", "style"] }), "text/html"),
  );

const adjustAttributes = (html: string) => {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    for (const tag of Array.from(doc.querySelectorAll("a"))) {
      tag.setAttribute("target", "_blank");
    }

    for (const img of Array.from(doc.querySelectorAll("img"))) {
      img.setAttribute("onerror", "this.style.display='none'");
      img.style.maxWidth = "250px";
      img.style.height = "auto";
      img.style.borderRadius = "0.5rem";
    }

    // Remove empty paragraphs and divs
    for (const tag of Array.from(doc.querySelectorAll("p, div"))) {
      if (tag.textContent?.trim() === "" && !tag.querySelector("img, br")) {
        tag.remove();
      }
    }

    // Convert literal newlines in text nodes to <br> elements.
    // Email clients (e.g. Gmail) often render bare \n as line breaks in HTML emails,
    // but browsers don't — this makes the dashboard match the sent email's appearance.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodesToProcess: Text[] = [];
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const node = textNode as Text;
      // Only process text nodes that have actual content (not pure whitespace) and contain newlines
      if (node.nodeValue?.includes("\n") && node.nodeValue.trim()) {
        textNodesToProcess.push(node);
      }
    }
    for (const node of textNodesToProcess) {
      const parts = node.nodeValue!.split("\n");
      if (parts.length <= 1) continue;
      const fragment = doc.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i > 0) fragment.appendChild(doc.createElement("br"));
        if (part) fragment.appendChild(doc.createTextNode(part));
      });
      node.parentNode?.replaceChild(fragment, node);
    }

    // Collapse multiple consecutive br tags into a single one
    let processedHtml = doc.body.innerHTML;
    // Replace 2+ consecutive br tags with just one
    processedHtml = processedHtml.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");

    return processedHtml;
  } catch (error) {
    captureExceptionAndLog(error);
    return html;
  }
};

const PlaintextContent = ({ text }: { text: string }) => text.split("\n").map((line, i) => <p key={i}>{line}</p>);

export const renderMessageBody = ({
  body,
  htmlBody,
  isMarkdown,
  className,
}: {
  body: string | null;
  htmlBody?: string | null;
  isMarkdown: boolean;
  className?: string;
}) => {
  if (isMarkdown) {
    return {
      mainContent: <MessageMarkdown className={cn(className, "prose max-w-none")}>{body}</MessageMarkdown>,
      quotedContext: null,
    };
  }

  // If htmlBody is present, render it directly without processing
  // (htmlBody is already sanitized server-side and is used for HTML templates)
  // Don't add prose class as HTML templates have their own complete styling
  if (htmlBody) {
    return {
      mainContent: <div dangerouslySetInnerHTML={{ __html: htmlBody }} />,
      quotedContext: null,
    };
  }

  // For regular body content (emails), extract quoted parts and adjust attributes
  if (body && body.includes("<") && body.includes(">")) {
    const { mainContent: parsedMain, quotedContext: parsedQuoted } = extractEmailParts(body);
    const adjustedMain = adjustAttributes(parsedMain);
    const adjustedQuoted = parsedQuoted ? adjustAttributes(parsedQuoted) : "";

    return {
      mainContent: (
        <div className={cn(className, "prose max-w-none")} dangerouslySetInnerHTML={{ __html: adjustedMain }} />
      ),
      quotedContext: adjustedQuoted ? (
        <div className={className} dangerouslySetInnerHTML={{ __html: adjustedQuoted }} />
      ) : null,
    };
  }

  return {
    mainContent: (
      <div className={cn(className, "prose max-w-none")}>
        {!body || body.trim() === "" ? (
          <span className="text-muted-foreground">(no content)</span>
        ) : (
          <PlaintextContent text={body} />
        )}
      </div>
    ),
    quotedContext: null,
  };
};
