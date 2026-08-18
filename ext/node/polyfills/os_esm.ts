// Copyright 2018-2026 the Deno authors. MIT license.
import { core } from "ext:core/mod.js";
// trex: `ext:deno_node/os.ts` is a classic script (`lazy_loaded_js`), so
// it can't statically `import` `ext:os/os.js` (ext_os is registered as a
// real `esm` module, not `lazy_loaded_js` - `loadExtScript` can only reach
// `lazy_loaded_js` sources). This file *is* a real ESM module, so the
// sandboxed-identity import goes here instead, and overlays the
// canonical ext_os-backed `uptime`/`userInfo` onto the shared
// `mod.default` object (the same object `require("os")` resolves to via
// `01_require.js`'s `core.loadExtScript("ext:deno_node/os.ts").default`),
// so both the `node:os` entry point and `require("os")` converge on it
// once this module has run. `os.ts` itself keeps a self-contained
// synthetic fallback (see the comment there) for the case where
// `require("os")` runs before `node:os` has ever been imported.
import { osCalls } from "ext:os/os.js";
const mod = core.loadExtScript("ext:deno_node/os.ts");

function uptime() {
  return osCalls.osUptime();
}

function userInfo(options = { __proto__: null, encoding: "utf-8" }) {
  return {
    uid: osCalls.uid(),
    gid: osCalls.gid(),
    homedir: mod.default.homedir(),
    shell: null,
    username: "",
  };
}

mod.default.uptime = uptime;
mod.default.userInfo = userInfo;

export const {
  constants,
  arch,
  cpus,
  endianness,
  freemem,
  getPriority,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  machine,
  platform,
  release,
  setPriority,
  tmpdir,
  totalmem,
  type,
  version,
  availableParallelism,
  EOL,
  devNull,
} = mod;

export { uptime, userInfo };

export default mod.default;
