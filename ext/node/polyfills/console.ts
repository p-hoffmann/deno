// Copyright 2018-2026 the Deno authors. MIT license.

import { Console } from "ext:deno_node/internal/console/constructor.mjs";
import * as DenoConsole from "ext:deno_console/01_console.js";
import { core } from "ext:core/mod.js";

const console = new DenoConsole.Console((msg, level) => core.print(msg, level > 1));

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
