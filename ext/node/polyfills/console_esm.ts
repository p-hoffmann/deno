// Copyright 2018-2026 the Deno authors. MIT license.

import { core } from "ext:core/mod.js";
const { Console } = core.loadExtScript("ext:deno_node/console.ts");
// trex: `ext:deno_web/01_console.js` is registered as `lazy_loaded_js`
// (not an `esm` entry point), so it has to be pulled in via
// `loadExtScript` like the import above rather than a static `import`.
const { Console: ConsoleImpl } = core.loadExtScript(
  "ext:deno_web/01_console.js",
);

// trex: build a fresh Console instance on every module load instead of
// reusing the bootstrap-time global console singleton, so each worker
// gets its own console state rather than sharing one across workers.
const console = new ConsoleImpl((msg, level) => core.print(msg, level > 1));

export default Object.assign(console, { Console });

export { Console };
export const {
  assert,
  clear,
  count,
  countReset,
  debug,
  dir,
  dirxml,
  error,
  group,
  groupCollapsed,
  groupEnd,
  info,
  log,
  profile,
  profileEnd,
  table,
  time,
  timeEnd,
  timeLog,
  timeStamp,
  trace,
  warn,
} = console;
// deno-lint-ignore no-explicit-any
export const indentLevel = (console as any)?.indentLevel;
