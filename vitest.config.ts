import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    /* The DOM environment F13 (§2.6) needed, and it is opted into per file with
       `// @vitest-environment happy-dom` rather than switched on here: the other
       36 files are Node's own globals plus `Request`/`Response`, and paying a
       window for each of them would make the fastest suite in the fleet the
       slowest for nothing.

       The settings are both about the same trap. happy-dom will go and *fetch*
       what a document links to, so `new Bar()` — which `<link>`s the site's
       inline stylesheet, deliberately, so `style-src 'self'` covers it — turned
       every editor test into a real request to localhost:3000 and a page of
       ECONNREFUSED beside a green run. Nothing here asserts on rendered style,
       so nothing is lost by refusing it. */
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true
        }
      }
    }
  },
});
