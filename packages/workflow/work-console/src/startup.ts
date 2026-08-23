/**
 * Single external DSH plugin boundary for the continuous-work system.
 *
 * The Work subsystem is one installable bundle. Domain services live under
 * this package and are mounted as child Cordis plugins owned by this root fiber.
 */
/** Compatibility startup entry for the consolidated Work Console bundle. */
export { apply, name } from './index.ts'
