/* Widget logic — no chrome.
   ---------------------------------------------------------------------------
   The kit deliberately ships only the widget's mechanics: element refinement,
   CSS paths, section/context extraction, image downscaling, and the POST
   envelope. The DOM the visitor sees — buttons, sheets, strings, palette —
   belongs to each site, so every site keeps its own face (PLAN §3.2). */

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
