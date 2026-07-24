/**
 * Browser Backend
 *
 * Re-exports the external browser backend (CDP over a debug port).
 * The embedded backend has been removed — use an installed browser instead.
 */

export { browserExternalBackend } from './browserExternal.js';
