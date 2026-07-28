/* Empty dist before a build.
   ---------------------------------------------------------------------------
   `files: ["dist"]` publishes whatever is in there, and tsc only ever adds —
   so a file that was moved or a tsconfig whose rootDir changed leaves its old
   output behind and it ships. This repo had exactly that: a set of widget
   files sitting at dist/ root from before the widget build gained its own
   rootDir, published in every release since.

   Cheap to prevent, invisible when it goes wrong. */

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
rmSync(`${root}/dist`, { recursive: true, force: true });
