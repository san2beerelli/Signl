/**
 * App Root Component
 *
 * Renders the map screen directly. The environment check (required CLI
 * tools for device communication) is no longer a gating first screen —
 * it's available on demand from the primary rail's Settings button.
 */

import type { JSX } from "react";
import { MainScreen } from "./screens/MainScreen";

export default function App(): JSX.Element {
  return <MainScreen />;
}
