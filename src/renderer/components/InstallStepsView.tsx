/**
 * Install Steps View
 *
 * Step-by-step install instructions for a single CLI tool, shown in place
 * of the Environment Check tool list. Each step is independently
 * copyable, plus a copy-all shortcut for pasting the whole thing into
 * Terminal at once.
 */

import { useState } from "react";
import type { JSX } from "react";
import { Button, Typography } from "@heroui/react";

const { Heading, Paragraph, Code } = Typography;

interface InstallStepsViewProps {
  toolName: string;
  steps: string[];
  note?: string | undefined;
  onBack: () => void;
}

export const InstallStepsView = ({ toolName, steps, note, onBack }: InstallStepsViewProps): JSX.Element => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const copyStep = (index: number, command: string): void => {
    void navigator.clipboard.writeText(command);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 2000);
  };

  const copyAll = (): void => {
    void navigator.clipboard.writeText(steps.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Button size="sm" variant="ghost" onPress={onBack} style={{ marginBottom: 12, paddingLeft: 4 }}>
          ← Back
        </Button>
        <Heading level={6} style={{ margin: "0 0 4px" }}>
          Install {toolName}
        </Heading>
        <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
          Run these commands in Terminal, in order.
        </Paragraph>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((step, index) => (
          <div
            key={step}
            className="ls-card"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "var(--color-accent, #3b82f6)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {index + 1}
            </div>
            <Code style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "pre" }}>{step}</Code>
            <Button size="sm" variant="ghost" onPress={() => copyStep(index, step)} style={{ flexShrink: 0 }}>
              {copiedIndex === index ? "Copied ✓" : "Copy"}
            </Button>
          </div>
        ))}
      </div>

      {note && (
        <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
          {note}
        </Paragraph>
      )}

      {steps.length > 1 && (
        <Button size="sm" variant="secondary" onPress={copyAll} fullWidth>
          {copiedAll ? "Copied all ✓" : "Copy all steps"}
        </Button>
      )}
    </div>
  );
};
