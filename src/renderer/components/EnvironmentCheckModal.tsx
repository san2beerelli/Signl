/**
 * Environment Check Modal
 *
 * Verifies required CLI tools for device communication (simctl, adb,
 * libimobiledevice, idevicelocation, ideviceimagemounter). Opened on
 * demand from the primary rail's Settings button, floating over the map
 * like every other overlay in the shell.
 *
 * Results are cached in localStorage so re-opening the modal shows the
 * last check instead of re-scanning every time — the Re-check button
 * (and the very first-ever open) is what actually re-runs the checks.
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
import { InstallStepsView } from "@/components/InstallStepsView.js";
import { RefreshIcon } from "@/icons.js";

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
  canInstall?: boolean;
  /** Ordered, individually-copyable commands shown in the Install Steps view. */
  installSteps?: string[];
  /** Extra guidance shown below the steps (e.g. where to put a built binary). */
  installNote?: string;
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
    installSteps: ["xcode-select --install"],
  },
  {
    id: "adb",
    name: "Android Platform Tools",
    description: "adb for emulator & device control",
    status: "checking",
    required: false,
    installSteps: ["brew install --cask android-platform-tools"],
  },
  {
    id: "libimobiledevice",
    name: "libimobiledevice",
    description: "Required for physical iOS device communication",
    status: "checking",
    required: false,
    canInstall: true,
    installSteps: ["brew install libimobiledevice"],
  },
  {
    id: "idevicelocation",
    name: "idevicelocation",
    description: "Required for physical iOS device spoofing (build from source)",
    status: "checking",
    required: false,
    canInstall: false, // Must be built from source
    installSteps: [
      "git clone https://github.com/JonGabilondo-morphmo/idevicelocation",
      "cd idevicelocation",
      "make",
    ],
    installNote:
      "Then move the built idevicelocation binary onto your PATH (e.g. /opt/homebrew/bin or /usr/local/bin) so this app can find it.",
  },
  {
    id: "ideviceimagemounter",
    name: "ideviceimagemounter",
    description: "Needed to mount Developer Disk Image",
    status: "checking",
    required: false,
    canInstall: true,
    installSteps: ["brew install libimobiledevice"],
  },
];

const ENVIRONMENT_CHECK_STORAGE_KEY = "location-simulator:environment-check:v1";

interface StoredToolResult {
  id: string;
  status: "ok" | "missing" | "skipped";
  version?: string | undefined;
  detail?: string | undefined;
}

interface StoredCheckResults {
  checkedAt: number;
  tools: StoredToolResult[];
}

const loadCachedResults = (): StoredCheckResults | null => {
  try {
    const raw = localStorage.getItem(ENVIRONMENT_CHECK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredCheckResults;
  } catch {
    return null;
  }
};

const saveCachedResults = (tools: ToolCheck[]): void => {
  const settled = tools.filter(
    (t): t is ToolCheck & { status: "ok" | "missing" | "skipped" } =>
      t.status === "ok" || t.status === "missing" || t.status === "skipped"
  );

  const payload: StoredCheckResults = {
    checkedAt: Date.now(),
    tools: settled.map((t) => ({ id: t.id, status: t.status, version: t.version, detail: t.detail })),
  };

  try {
    localStorage.setItem(ENVIRONMENT_CHECK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable — not critical, the modal just re-checks next time.
  }
};

/** Merges cached statuses onto the tool catalogue, keeping the static fields (name, steps, ...) fresh. */
const applyCachedResults = (cached: StoredCheckResults): ToolCheck[] =>
  initialTools.map((tool) => {
    const stored = cached.tools.find((t) => t.id === tool.id);
    if (!stored) return tool;
    return { ...tool, status: stored.status, version: stored.version, detail: stored.detail };
  });

const formatRelativeTime = (timestamp: number): string => {
  const diffMinutes = Math.round((Date.now() - timestamp) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
};

export const EnvironmentCheckModal = ({
  isOpen,
  onOpenChange,
}: EnvironmentCheckModalProps): JSX.Element => {
  const [tools, setTools] = useState<ToolCheck[]>(initialTools);
  const [isChecking, setIsChecking] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [stepsToolId, setStepsToolId] = useState<string | null>(null);

  // On open: show the cached result if we have one, otherwise run a fresh
  // check (first-ever open). Re-scanning after that is opt-in via Re-check.
  useEffect(() => {
    if (!isOpen) return;
    setStepsToolId(null);

    const cached = loadCachedResults();
    if (cached) {
      setTools(applyCachedResults(cached));
      setLastCheckedAt(cached.checkedAt);
      setIsChecking(false);
    } else {
      void runFullCheck();
    }
  }, [isOpen]);

  const checkTool = async (
    toolId: string,
  ): Promise<{ installed: boolean; version?: string; detail?: string }> => {
    try {
      return await window.api.checkTool(toolId);
    } catch {
      return { installed: false };
    }
  };

  const runFullCheck = async (): Promise<void> => {
    setTools(initialTools.map((t) => ({ ...t, status: "checking" as const })));
    setIsChecking(true);

    const results: ToolCheck[] = initialTools.map((t) => ({ ...t }));

    for (let i = 0; i < initialTools.length; i++) {
      const tool = initialTools[i]!;
      await new Promise((r) => setTimeout(r, 300));

      const result = await checkTool(tool.id);
      const updated: ToolCheck = {
        ...tool,
        status: result.installed ? "ok" : "missing",
        version: result.version,
        detail: result.installed ? result.detail : `Not found — ${tool.description}`,
      };

      results[i] = updated;
      setTools((prev) => prev.map((t) => (t.id === tool.id ? updated : t)));
    }

    setIsChecking(false);
    setLastCheckedAt(Date.now());
    saveCachedResults(results);
  };

  const updateTool = (toolId: string, patch: Partial<ToolCheck>): void => {
    setTools((prev) => {
      const next = prev.map((t) => (t.id === toolId ? { ...t, ...patch } : t));
      saveCachedResults(next);
      return next;
    });
    setLastCheckedAt(Date.now());
  };

  const handleInstall = async (toolId: string): Promise<void> => {
    updateTool(toolId, { status: "installing", error: undefined });

    try {
      const result = await window.api.installTool(toolId);
      const toolName = initialTools.find((t) => t.id === toolId)?.name ?? toolId;

      if (result.success) {
        updateTool(toolId, {
          status: "ok",
          version: result.version,
          detail: `${toolName} available`,
          error: undefined,
        });
      } else {
        updateTool(toolId, { status: "missing", error: result.error?.message || "Installation failed" });
      }
    } catch (error) {
      updateTool(toolId, {
        status: "missing",
        error: error instanceof Error ? error.message : "Installation failed",
      });
    }
  };

  const okCount = tools.filter((t) => t.status === "ok").length;
  const missingCount = tools.filter((t) => t.status === "missing").length;
  const activeStepsTool = tools.find((t) => t.id === stepsToolId);

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
              {stepsToolId !== null && activeStepsTool ? (
                <InstallStepsView
                  toolName={activeStepsTool.name}
                  steps={activeStepsTool.installSteps ?? []}
                  note={activeStepsTool.installNote}
                  onBack={() => setStepsToolId(null)}
                />
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 4,
                    }}
                  >
                    <Paragraph size="sm" color="muted" style={{ margin: 0 }}>
                      Verifying required CLI tools for device communication
                    </Paragraph>
                    <span title="Re-check environment">
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => void runFullCheck()}
                        isDisabled={isChecking}
                        style={{ gap: 6, flexShrink: 0 } as React.CSSProperties}
                      >
                        <RefreshIcon size={14} />
                        Re-check
                      </Button>
                    </span>
                  </div>

                  {lastCheckedAt !== null && !isChecking && (
                    <Paragraph size="xs" color="muted" style={{ margin: "0 0 16px" }}>
                      Last checked {formatRelativeTime(lastCheckedAt)}
                    </Paragraph>
                  )}

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
                          Some features may be unavailable until these are installed.
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
                              {tool.canInstall && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onPress={() => handleInstall(tool.id)}
                                >
                                  Install
                                </Button>
                              )}
                              {tool.installSteps && tool.installSteps.length > 0 && (
                                <Button
                                  size="sm"
                                  variant={tool.canInstall ? "ghost" : "secondary"}
                                  onPress={() => setStepsToolId(tool.id)}
                                >
                                  Install Steps
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
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
};
