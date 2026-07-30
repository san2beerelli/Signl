/**
 * Simulators Drawer
 *
 * Lists discovered iOS Simulators and Android Emulators. Stage 1 wires the
 * existing `devices:list` data into the new shell; per-kind capability
 * detail and separate booted/shutdown sections land in Stage 2.
 */

import type { JSX } from "react";
import { TargetList } from "@/components/drawers/TargetList.js";

export const SimulatorsDrawer = (): JSX.Element => (
  <TargetList
    kinds={["ios-simulator", "android-emulator"]}
    emptyTitle="No booted simulators found."
    emptyHint={"Open a simulator from Xcode or the Simulator app,\nthen refresh this list."}
  />
);
