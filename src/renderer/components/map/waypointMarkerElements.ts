/**
 * Waypoint Marker Elements
 *
 * Plain-DOM builders for the two waypoint marker styles used on the map:
 * a small dot for intermediate points, and a labeled pin (address +
 * START/END caption) for the route's endpoints.
 */

/** Plain dot marker used for waypoints that aren't the route's start or end. */
export const buildDotMarkerElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-warning);
    border: 2px solid var(--color-background);
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `;
  return el;
};

/**
 * Labeled pin for the route's start/end point — address (once resolved)
 * and a START/END caption stacked above a round pin, anchored so the
 * pin's base sits exactly on the coordinate.
 */
export const buildLabeledPinElement = (address: string | undefined, caption: string): HTMLDivElement => {
  const container = document.createElement("div");
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  `;

  if (address) {
    const label = document.createElement("div");
    label.style.cssText = `
      background: rgba(20, 20, 24, 0.88);
      color: #fff;
      font-weight: 700;
      font-size: 12px;
      padding: 3px 9px;
      border-radius: 8px;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    `;
    label.textContent = address;
    container.appendChild(label);
  }

  const captionEl = document.createElement("div");
  captionEl.style.cssText = `
    color: rgba(255,255,255,0.75);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  `;
  captionEl.textContent = caption;
  container.appendChild(captionEl);

  const pin = document.createElement("div");
  pin.style.cssText = `
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffffff, #cfcfcf 55%, #8a8a8a 100%);
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    margin-top: 2px;
  `;
  container.appendChild(pin);

  return container;
};
