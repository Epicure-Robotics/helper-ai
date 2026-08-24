/**
 * Utility functions for handling template variables in saved replies
 */

/**
 * Extract all variables from a template string
 * Variables are in the format {variableName}
 * @param template - The template string to extract variables from
 * @returns Array of unique variable names (without braces)
 */
export function extractTemplateVariables(template: string): string[] {
  const variableRegex = /\{([a-zA-Z_][a-zA-Z0-9_\s]*)\}/g;
  const variables = new Set<string>();

  let match;
  while ((match = variableRegex.exec(template)) !== null) {
    if (match[1]) {
      variables.add(match[1]);
    }
  }

  return Array.from(variables).sort();
}

/**
 * Convert markdown-style formatting to HTML
 * @param text - Text with markdown formatting
 * @returns Text with HTML formatting
 */
function convertMarkdownToHtml(text: string): string {
  let result = text;

  // Convert ### headers to <strong> (for email compatibility)
  result = result.replace(/^###\s+(.+)$/gm, "<strong>$1</strong>");

  // Convert ## headers to <strong>
  result = result.replace(/^##\s+(.+)$/gm, "<strong>$1</strong>");

  // Convert # headers to <strong>
  result = result.replace(/^#\s+(.+)$/gm, "<strong>$1</strong>");

  // Convert **bold** to <strong>
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Convert *italic* to <em> (but not ** which was already handled)
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");

  return result;
}

/**
 * Escape HTML special characters in text
 * @param text - Plain text to escape
 * @returns HTML-safe text
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strip links from text
 * Removes markdown links [text](url) → text, and bare URLs
 * @param text - Text that may contain links
 * @returns Text with links removed
 */
function stripLinks(text: string): string {
  // Remove markdown-style links [text](url) → text
  let result = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Remove bare URLs (http/https)
  result = result.replace(/https?:\/\/\S+/g, "");
  return result;
}

/**
 * Convert plain text to HTML, preserving line breaks and formatting
 * @param text - Plain text content (may include markdown-style formatting)
 * @returns HTML formatted content
 */
function convertPlainTextToHtml(text: string): string {
  if (!text) return "";

  // First, convert any markdown-style formatting to HTML
  const processed = convertMarkdownToHtml(text);

  // Split into paragraphs (double newlines)
  const paragraphs = processed.split(/\n\n+/);

  return paragraphs
    .map((para) => {
      // Within each paragraph, convert single newlines to <br>
      const withBreaks = para
        .trim()
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("<br>");

      return withBreaks ? `<p>${withBreaks}</p>` : "";
    })
    .filter((p) => p.length > 0)
    .join("");
}

/**
 * Replace variables in a template with provided values
 * @param template - The template string with variables
 * @param values - Object mapping variable names to their values
 * @returns Template with variables replaced
 */
export function replaceTemplateVariables(template: string, values: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");

    // Strip links before inserting into the template
    const cleanValue = stripLinks(value);

    // Only apply full HTML conversion for multi-line content
    // Single-line values (like names) should remain inline
    const htmlValue = cleanValue.includes("\n") ? convertPlainTextToHtml(cleanValue) : escapeHtml(cleanValue);

    result = result.replace(regex, htmlValue);
  }

  return result;
}

/**
 * Validate that all required variables have values
 * @param variables - Array of required variable names
 * @param values - Object mapping variable names to their values
 * @returns Array of missing variable names
 */
export function getMissingVariables(variables: string[], values: Record<string, string>): string[] {
  return variables.filter((variable) => !values[variable] || values[variable].trim() === "");
}
