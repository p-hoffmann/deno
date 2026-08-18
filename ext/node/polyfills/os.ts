// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// deno-lint-ignore-file no-process-global

(function () {
const { core, primordials } = __bootstrap;
const {
  op_node_os_get_priority,
  op_node_os_set_priority,
} = core.ops;

const { isWindows } = core.loadExtScript("ext:deno_node/_util/os.ts");
const { os } = core.loadExtScript(
  "ext:deno_node/internal_binding/constants.ts",
);
const { validateIntegerRange } = core.loadExtScript(
  "ext:deno_node/_utils.ts",
);
// trex: `ext:os/os.js` (ext_os) is registered as a real `esm` module, not
// `lazy_loaded_js`, so it can't be reached from here via `loadExtScript` -
// this file is loaded as a classic script (see `ext/node/lib.rs`'s
// `lazy_loaded_js` list) and classic scripts can't use a static `import`
// either. `os_esm.ts` (a real ESM module) statically imports `osCalls`
// from `ext:os/os.js` and overrides `uptime`/`userInfo` with the
// canonical ext_os-backed values for the primary `node:os` entry point.
// The synthetic values below (matching ext_os/os.js's own constants) keep
// this file's own `uptime`/`userInfo` - reachable via
// `require("os")` in `01_require.js`, which loads this file directly
// without going through `os_esm.ts` - from leaking real host identity.
const osStartTime = Date.now();

const {
  ArrayBuffer,
  ArrayPrototypePush,
  DataView,
  DataViewPrototypeSetInt16,
  Error,
  Int16Array,
  SafeArrayIterator,
  StringPrototypeEndsWith,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
  SymbolToPrimitive,
} = primordials;

const constants = os;

function arch() {
  return process.arch;
}

availableParallelism[SymbolToPrimitive] = () => availableParallelism();
arch[SymbolToPrimitive] = () => process.arch;
endianness[SymbolToPrimitive] = () => endianness();
freemem[SymbolToPrimitive] = () => freemem();
homedir[SymbolToPrimitive] = () => homedir();
hostname[SymbolToPrimitive] = () => hostname();
platform[SymbolToPrimitive] = () => platform();
release[SymbolToPrimitive] = () => release();
version[SymbolToPrimitive] = () => version();
totalmem[SymbolToPrimitive] = () => totalmem();
type[SymbolToPrimitive] = () => type();
uptime[SymbolToPrimitive] = () => uptime();
machine[SymbolToPrimitive] = () => machine();
tmpdir[SymbolToPrimitive] = () => tmpdir();

function cpus() {
  // trex: sandboxed - report a single synthetic core instead of the host's.
  return [{
    model: "",
    speed: 0,
    times: {
      user: 0,
      nice: 0,
      sys: 0,
      idle: 0,
      irq: 0,
    },
  }];
}

function endianness() {
  const buffer = new ArrayBuffer(2);
  DataViewPrototypeSetInt16(
    new DataView(buffer),
    0,
    256,
    true, /* littleEndian */
  );
  return new Int16Array(buffer)[0] === 256 ? "LE" : "BE";
}

function freemem() {
  if (Deno.build.os === "linux" || Deno.build.os == "android") {
    return Deno.systemMemoryInfo().available;
  } else {
    return Deno.systemMemoryInfo().free;
  }
}

function getPriority(pid = 0) {
  validateIntegerRange(pid, "pid");
  return op_node_os_get_priority(pid);
}

function homedir() {
  // trex: sandboxed - fixed path instead of the host's home directory.
  return "/home/deno";
}

function hostname() {
  return Deno.hostname();
}

function loadavg() {
  if (isWindows) {
    return [0, 0, 0];
  }
  return Deno.loadavg();
}

function networkInterfaces() {
  const interfaces = {};
  for (
    const { name, address, netmask, family, mac, scopeid, cidr }
      of new SafeArrayIterator(
        Deno.networkInterfaces(),
      )
  ) {
    const addresses = interfaces[name] ||= [];
    const networkAddress = {
      address,
      netmask,
      family,
      mac,
      internal: (family === "IPv4" && isIPv4LoopbackAddr(address)) ||
        (family === "IPv6" && isIPv6LoopbackAddr(address)),
      cidr,
    };
    if (family === "IPv6") {
      networkAddress.scopeid = scopeid;
    }
    ArrayPrototypePush(addresses, networkAddress);
  }
  return interfaces;
}

function isIPv4LoopbackAddr(addr) {
  return StringPrototypeStartsWith(addr, "127");
}

function isIPv6LoopbackAddr(addr) {
  return addr === "::1" || addr === "fe80::1";
}

function platform() {
  return process.platform;
}

function release() {
  return Deno.osRelease();
}

function version() {
  return Deno.osRelease();
}

function machine() {
  if (Deno.build.arch == "aarch64") {
    return "arm64";
  }

  return Deno.build.arch;
}

function setPriority(pid, priority) {
  if (priority === undefined) {
    priority = pid;
    pid = 0;
  }

  validateIntegerRange(pid, "pid");
  validateIntegerRange(priority, "priority", -20, 19);

  op_node_os_set_priority(pid, priority);
}

function tmpdir() {
  if (isWindows) {
    let temp = Deno.env.get("TEMP") || Deno.env.get("TMP") ||
      (Deno.env.get("SystemRoot") || Deno.env.get("windir")) + "\\temp";
    if (
      temp.length > 1 && StringPrototypeEndsWith(temp, "\\") &&
      !StringPrototypeEndsWith(temp, ":\\")
    ) {
      temp = StringPrototypeSlice(temp, 0, -1);
    }

    return temp;
  } else {
    let temp = Deno.env.get("TMPDIR") || Deno.env.get("TMP") ||
      Deno.env.get("TEMP") || "/tmp";
    if (temp.length > 1 && StringPrototypeEndsWith(temp, "/")) {
      temp = StringPrototypeSlice(temp, 0, -1);
    }
    return temp;
  }
}

function totalmem() {
  return Deno.systemMemoryInfo().total;
}

function type() {
  switch (Deno.build.os) {
    case "windows":
      return "Windows_NT";
    case "linux":
    case "android":
      return "Linux";
    case "darwin":
      return "Darwin";
    case "freebsd":
      return "FreeBSD";
    case "openbsd":
      return "OpenBSD";
    default:
      throw new Error("unreachable");
  }
}

function uptime() {
  // trex: sandboxed - synthetic uptime, not the host's (see os_esm.ts for
  // the canonical ext_os-backed value used by the `node:os` entry point).
  return Math.floor(Math.abs(Date.now() - osStartTime) / 1000);
}

function userInfo(
  options = { __proto__: null, encoding: "utf-8" },
) {
  // trex: sandboxed - synthetic identity (matches ext_os/os.js's osCalls
  // constants), no host passwd lookup.
  return {
    uid: 1000,
    gid: 1000,
    homedir: homedir(),
    shell: null,
    username: "",
  };
}

function availableParallelism() {
  return navigator.hardwareConcurrency;
}

const EOL = isWindows ? "\r\n" : "\n";
const devNull = isWindows ? "\\\\.\\nul" : "/dev/null";

const mod = {
  availableParallelism,
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
  uptime,
  userInfo,
  version,
  constants,
  EOL,
  devNull,
};

return {
  "module.exports": mod,
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
  uptime,
  userInfo,
  version,
  availableParallelism,
  EOL,
  devNull,
  default: mod,
};
})();
