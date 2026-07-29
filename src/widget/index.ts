/* Widget mechanics: element refinement, CSS paths, section/context
   extraction, image downscaling, and the POST envelope.
   ---------------------------------------------------------------------------
   This module used to be the whole of the kit's widget surface, and its header
   said the DOM belonged to each site "so every site keeps its own face". Six
   copies of one 626-line file at three versions is what that cost, and 0.16.0
   ended it: the chrome is `./chrome.js`, reached as
   `@shaahink/sitekit/widget/chrome`, and what stays per-site is the palette —
   `feedback-chrome.css`, which is the part a reviewer actually reads as the
   site's face. The class names it styles are a contract in `./classes.js`.

   Kept as its own entry point rather than folded into the chrome: these are
   the pieces with no DOM of their own, they are what the handler's payload
   shape is defined against, and a site that ever wants to build something else
   on them should not have to import a pill and a composer to get them. */

export { refine, selectorFor, type RefineOptions } from "./pick.js";
export {
  sectionInfo,
  ownText,
  describe,
  context,
  type LandmarkOptions,
  type ContextOptions,
  type SectionInfo,
  type TargetContext
} from "./context.js";
export { shrink, type ShrinkOptions } from "./image.js";
export {
  pageInfo,
  clientInfo,
  buildPayload,
  postFeedback,
  type PageInfo,
  type ClientInfo,
  type FeedbackPayload,
  type PayloadInput
} from "./submit.js";
export { squash, basename, clamp } from "./text.js";
