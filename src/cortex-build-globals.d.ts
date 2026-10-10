/** Injected by webpack DefinePlugin (see webpack.config.js) and Vitest `define`. */
declare const __CORTEX_DEBUG__: boolean;
/** True only in the dist-e2e build used for axe audits (open overlay shadow root). */
declare const __CORTEX_E2E_OPEN_SHADOW__: boolean;

/**
 * Direct file import so the service worker does not also pull in
 * Readability-readerable.js (the package barrel loads both).
 */
declare module "@mozilla/readability/Readability.js" {
  import { Readability as ReadabilityClass } from "@mozilla/readability";
  const Readability: typeof ReadabilityClass;
  export default Readability;
}
