/**
 * Map Shell Layout
 *
 * Shared geometry for the floating navigation rail, secondary drawer, and
 * selected-target overlay so they stay aligned without prop-drilling pixel
 * values through every component that needs to avoid overlapping them.
 */

export const SHELL_MARGIN = 12;
export const DRAWER_GAP = 12;
export const DRAWER_WIDTH = 360;

/** Rail width. */
export const RAIL_WIDTH = 88;

/**
 * Height of the transparent, blurred drag strip along the window's top
 * edge (there's no opaque title bar — this is what keeps the window
 * draggable while the map stays visible underneath it).
 */
export const DRAG_STRIP_HEIGHT = 40;

/**
 * Top offset for floating panels that sit over the map (rail, drawer,
 * status chips) — clears the drag strip and, on macOS, the inset
 * traffic-light controls, without needing per-panel workarounds.
 */
export const SHELL_TOP = DRAG_STRIP_HEIGHT + SHELL_MARGIN;

/** Left offset of the secondary drawer — immediately right of the rail. */
export const DRAWER_LEFT = SHELL_MARGIN + RAIL_WIDTH + DRAWER_GAP;

/**
 * Left inset floating map content (interaction-mode chips, future
 * instructional banners) should reserve so it never sits underneath the
 * rail or an open drawer.
 */
export const shellContentLeftInset = (isDrawerOpen: boolean): number =>
  isDrawerOpen
    ? DRAWER_LEFT + DRAWER_WIDTH + DRAWER_GAP
    : SHELL_MARGIN + RAIL_WIDTH + DRAWER_GAP;
