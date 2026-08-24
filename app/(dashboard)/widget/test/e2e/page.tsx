"use client";

export default function WidgetTestPage() {
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ background: "#f5f5f5", padding: "20px", borderRadius: "8px", marginBottom: "20px" }}>
        <h1 style={{ color: "#333" }}>Epicure Assist widget test</h1>
        <p style={{ lineHeight: 1.6 }}>This is a test page for the Helper chat widget end-to-end tests.</p>

        <div
          style={{
            background: "white",
            padding: "20px",
            border: "2px solid #4CAF50",
            borderRadius: "8px",
            margin: "20px 0",
          }}
        >
          <h2>Screenshot Test Content</h2>
          <p>This distinctive content should be visible in screenshots.</p>
          <ul>
            <li>Item 1: Test data for screenshot</li>
            <li>Item 2: Verification content</li>
            <li>Item 3: E2E test marker</li>
          </ul>
        </div>

        <button
          style={{
            background: "#f44336",
            color: "white",
            padding: "10px 20px",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          onClick={() => {
            // Intentionally trigger an error for testing, but handle it properly
            try {
              throw new Error("Test error");
            } catch (e) {
              console.error("Caught test error:", e);
              // In a real app, you'd send this to an error reporting service
            }
          }}
        >
          Trigger Error (for error handling tests)
        </button>

        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
          magna aliqua.
        </p>
      </div>
    </div>
  );
}
