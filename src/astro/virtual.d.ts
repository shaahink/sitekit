/* The shape of the module `editorRoute()` generates at build time. Shipped so
   that a site running `astro check` over the injected route resolves the
   import rather than reporting a module it cannot find. */

declare module "virtual:sitekit-editor-route" {
  import type { EditorRouteConfig } from "@shaahink/sitekit/astro";
  const config: EditorRouteConfig;
  export default config;
}
