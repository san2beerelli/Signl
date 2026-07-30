/**
 * Devices Drawer
 *
 * Lists connected physical iOS and Android devices. Stage 1 wires the
 * existing `devices:list` data into the new shell; authorization/warning
 * states land in Stage 2.
 */

import type { JSX } from "react";
import { TargetList } from "@/components/drawers/TargetList.js";

export const DevicesDrawer = (): JSX.Element => (
  <TargetList
    kinds={["ios-device", "android-device"]}
    emptyTitle="No connected devices found."
    emptyHint="Connect and authorize an iOS or Android device."
  />
);
