/**
 * Environment Check Modal
 *
 * Verifies required CLI tools for device communication (simctl, adb,
 * libimobiledevice, idevicelocation, ideviceimagemounter). Previously a
 * gating screen shown before the map; now opened on demand from the
 * primary rail's Settings button, floating over the map like every other
 * overlay in the shell.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";
import {
  Button,
  Spinner,
  Chip,
  Alert,
  AlertContent,
  AlertTitle,
  AlertDescription,
  AlertIndicator,
  Separator,
  Typography,
  Modal,
} from "@heroui/react";

const { Paragraph, Code } = Typography;

interface ToolCheck {
  id: string;
  name: string;
  description: string;
  status: "checking" | "ok" | "missing" | "skipped" | "installing";
  version?: string | undefined;
  detail?: string | undefined;
  error?: string | undefined;
  required: boolean;
  installCommand?: string;
  canInstall?: boolean;
}

interface EnvironmentCheckModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const initialTools: ToolCheck[] = [
  {
    id: "xcode",
    name: "Xcode Command Line Tools",
    description: "simctl for iOS Simulator control",
    status: "checking",
    required: false,
  },
  {
    id: "adb",
    name: "Android Platform Tools",
    description: "adb for emulator & device control",
    status: "checking",
    required: false,
  },
  {
    id: "libimobiledevice",
    name: "libimobiledevice",
    description: "Required for physical iOS device communication",
    status: "checking",
    required: false,
    installCommand: "brew install libimobiledevice",
    canInstall: true,
  },
  {
    id: "idevicelocation",
    name: "idevicelocation",
    description: "Required for physical iOS device spoofing (build from source)",
    status: "checking",
    required: false,
    installCommand:
      "git clone https://github.com/JonGabilondo-morphmo/idevicelocation && cd idevicelocation && make",
    canInstall: false, // Must be built from source
  },
  {
    id: "ideviceimagemounter",
    name: "ideviceimagemounter",
    description: "Needed to mount Developer Disk Image",
    status: "checking",
    required: false,
    installCommand: "brew install libimobiledevice",
    canInstall: true,
  },
];

export function EnvironmentCheckModal({
  isOpen,
  onOpenChange,
}: EnvironmentCheckModalProps): JSX.Element {
  const [tools, setTools] = useState<ToolCheck[]>(initialTools);
  const [isChecking, setIsChecking] = useState(true);

  // Re-run the checks each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setTools(initialTools);
    void checkAllTools();
  }, [isOpen]);

  const checkAllTools = async (): Promise<void> => {
    setIsChecking(true);

    for (const tool of initialTools) {
      await new Promise((r) => setTimeout(r, 300));

      const result = await checkTool(tool.id);

      setTools((prev) =>
        prev.map((t) =>
          t.id === tool.id
            ? {
                ...t,
                status: result.installed ? "ok" : "missing",
                version: result.version,
                detail: result.installed ? result.detail : `Not found — ${t.description}`,
              }
            : t,
        ),
      );
    }

    setIsChecking(false);
  };

  const checkTool = async (
    toolId: string,
  ): Promise<{ installed: boolean; version?: string; detail?: string }> => {
    try {
      return await window.api.checkTool(toolId);
    } catch {
      return { installed: false };
    }
  };

  const handleSkip = (toolId: string): void => {
    setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, status: "skipped" } : t)));
  };

  const handleInstall = async (toolId: string): Promise<void> => {
    setTools((prev) =>
      prev.map((t) => (t.id === toolId ? { ...t, status: "installing", error: undefined } : t)),
    );

    try {
      const result = await window.api.installTool(toolId);

      if (result.success) {
        setTools((prev) =>
          prev.map((t) =>
            t.id === toolId
              ? {
                  ...t,
                  status: "ok",
                  version: result.version,
                  detail: `${t.name} available`,
                  error: undefined,
                }
              : t,
          ),
        );
      } else {
        setTools((prev) =>
          prev.map((t) =>
            t.id === toolId
              ? { ...t, status: "missing", error: result.error?.message || "Installation failed" }
              : t,
          ),
        );
      }
    } catch (error) {
      setTools((prev) =>
        prev.map((t) =>
          t.id === toolId
            ? {
                ...t,
                status: "missing",
                error: error instanceof Error ? error.message : "Installation failed",
              }
            : t,
        ),
      );
    }
  };

  const okCount = tools.filter((t) => t.status === "ok").length;
  const missingCount = tools.filter((t) => t.status === "missing").length;

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Environment Check</Modal.Heading>
              <Modal.CloseTrigger aria-label="Close" />
            </Modal.Header>

            <Modal.Body>
              <Paragraph size="sm" color="muted" style={{ margin: "0 0 16px" }}>
                Verifying required CLI tools for device communication
              </Paragraph>

              {isChecking && (
                <Alert color="accent" style={{ marginBottom: 16 }}>
                  <AlertIndicator>
                    <Spinner size="sm" />
                  </AlertIndicator>
                  <AlertContent>
                    <AlertTitle>Scanning environment...</AlertTitle>
                    <AlertDescription>Checking for required CLI tools</AlertDescription>
                  </AlertContent>
                </Alert>
              )}

              {!isChecking && missingCount > 0 && (
                <Alert color="warning" style={{ marginBottom: 16 }}>
                  <AlertContent>
                    <AlertTitle>
                      {missingCount} tool{missingCount > 1 ? "s" : ""} not found
                    </AlertTitle>
                    <AlertDescription>
                      Some features may be unavailable. You can skip or install missing tools.
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}

              {!isChecking && missingCount === 0 && (
                <Alert color="success" style={{ marginBottom: 16 }}>
                  <AlertContent>
                    <AlertTitle>All checks passed!</AlertTitle>
                    <AlertDescription>
                      Your environment is ready for location simulation.
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {tools.map((tool, index) => (
                  <div key={tool.id}>
                    {index > 0 && <Separator />}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 0",
                      }}
                    >
                      <div style={{ flexShrink: 0 }}>
                        {(tool.status === "checking" || tool.status === "installing") && (
                          <Spinner size="sm" />
                        )}
                        {tool.status === "ok" && (
                          <Chip size="sm" color="success" variant="soft">
                            ✓
                          </Chip>
                        )}
                        {tool.status === "missing" && (
                          <Chip size="sm" color="danger" variant="soft">
                            ✕
                          </Chip>
                        )}
                        {tool.status === "skipped" && (
                          <Chip size="sm" color="default" variant="soft">
                            —
                          </Chip>
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <Paragraph style={{ fontWeight: 500, margin: 0 }}>
                            {tool.name}
                          </Paragraph>
                          {tool.version && <Code>{tool.version}</Code>}
                          {tool.status === "installing" && (
                            <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                              Installing...
                            </Paragraph>
                          )}
                        </div>
                        {tool.error ? (
                          <Paragraph size="sm" style={{ margin: 0, color: "var(--color-danger)" }}>
                            {tool.error}
                          </Paragraph>
                        ) : (
                          <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                            {tool.detail || tool.description}
                          </Paragraph>
                        )}
                      </div>

                      {tool.status === "missing" && (
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <Button size="sm" variant="ghost" onPress={() => handleSkip(tool.id)}>
                            Skip
                          </Button>
                          {tool.canInstall && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={() => handleInstall(tool.id)}
                            >
                              Install
                            </Button>
                          )}
                          {!tool.canInstall && tool.installCommand && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={() =>
                                navigator.clipboard.writeText(tool.installCommand || "")
                              }
                            >
                              Copy Command
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Modal.Body>

            <Modal.Footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                {okCount} of {tools.length} tools available
              </Paragraph>
              <Button variant="primary" onPress={() => onOpenChange(false)}>
                Close
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
