// Copyright 2018-2025 the Deno authors. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import { core, internals, primordials } from "ext:core/mod.js";
import {
  MessageChannel,
  MessagePort,
  unrefParentPort,
} from "ext:deno_web/13_message_port.js";
import { BroadcastChannel } from "ext:deno_broadcast_channel/01_broadcast_channel.js";
import { notImplemented } from "ext:deno_node/_utils.ts";
import { EventEmitter } from "node:events";
import process from "node:process";

const {
  Error,
  ObjectHasOwn,
  PromiseResolve,
  SafeSet,
  Symbol,
  SymbolFor,
  SafeWeakMap,
  SafeMap,
} = primordials;

export interface WorkerOptions {
  argv?: unknown[];
  env?: Record<string, unknown>;
  execArgv?: string[];
  stdin?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  trackUnmanagedFds?: boolean;
  resourceLimits?: {
    maxYoungGenerationSizeMb?: number;
    maxOldGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
  // deno-lint-ignore prefer-primordials
  eval?: boolean;
  transferList?: Transferable[];
  workerData?: unknown;
  name?: string;
}

let nextWorkerThreadId = 1;
const activeWorkers = new SafeMap();
const originalProcessExit = process.exit;

const privateWorkerRef = Symbol("privateWorkerRef");
class NodeWorker extends EventEmitter {
  #id = 0;
  #name = "";
  #refCount = 1;
  #messagePromise = undefined;
  #controlPromise = undefined;
  // "RUNNING" | "CLOSED" | "TERMINATED"
  #status = "RUNNING";
  #hostPort;

  // https://nodejs.org/api/worker_threads.html#workerthreadid
  threadId = this.#id;
  // https://nodejs.org/api/worker_threads.html#workerresourcelimits
  resourceLimits: Required<
    NonNullable<WorkerOptions["resourceLimits"]>
  > = {
    maxYoungGenerationSizeMb: -1,
    maxOldGenerationSizeMb: -1,
    codeRangeSizeMb: -1,
    stackSizeMb: 4,
  };

  constructor(specifier: URL | string, options?: WorkerOptions) {
    super();

    this.#id = nextWorkerThreadId++;
    this.threadId = this.#id;
    this.#name = options?.name ?? "";

    // Create message channel for host <-> worker communication
    const channel = new MessageChannel();
    this.#hostPort = channel.port1;
    const workerPort = channel.port2;

    // Wire host port to emit events on this NodeWorker instance
    this.#hostPort.onmessage = (ev) => {
      if (this.#status !== "TERMINATED") {
        this.emit("message", ev.data);
      }
    };

    // Resolve the specifier to a URL
    let moduleUrl: string;
    if (options?.eval) {
      // deno-lint-ignore prefer-primordials
      const code = typeof specifier === "string"
        ? specifier
        // deno-lint-ignore prefer-primordials
        : specifier.toString();
      // Use encodeURIComponent for data: URI (handles newlines, special chars)
      moduleUrl = `data:text/javascript,${encodeURIComponent(code)}`;
    } else if (typeof specifier === "object") {
      // deno-lint-ignore prefer-primordials
      moduleUrl = specifier.toString();
    } else {
      // String path — resolve relative to cwd
      // deno-lint-ignore prefer-primordials
      if (specifier.startsWith("file://") || specifier.startsWith("data:")) {
        moduleUrl = specifier;
      } else {
        moduleUrl = new URL(specifier, `file://${Deno.cwd()}/`).href;
      }
    }

    // Append unique query param to bust module cache for file URLs
    // deno-lint-ignore prefer-primordials
    if (!moduleUrl.startsWith("data:")) {
      const sep = moduleUrl.includes("?") ? "&" : "?";
      moduleUrl = `${moduleUrl}${sep}__workerId=${this.#id}`;
    }

    // Save main thread module-level state
    const savedParentPort = parentPort;
    const savedWorkerData = workerData;
    const savedThreadId = threadId;
    const savedIsMainThread = isMainThread;
    const savedEnvironmentData = environmentData;

    // Set up worker context: mutate module-level state
    const workerParentPort = createParentPortAdapter(workerPort);
    parentPort = workerParentPort;
    workerData = options?.workerData ?? null;
    threadId = this.#id;
    isMainThread = false;
    environmentData = new SafeMap(savedEnvironmentData);

    // Handle env option
    const savedEnv = process.env;
    if (options?.env && options.env !== SHARE_ENV) {
      process.env = options.env;
    }

    // Update default export to reflect worker state
    defaultExport.parentPort = parentPort;
    defaultExport.workerData = workerData;
    defaultExport.threadId = threadId;
    defaultExport.isMainThread = false;

    // Register for process.exit sandboxing
    activeWorkers.set(this.#id, this);
    if (activeWorkers.size === 1) {
      process.exit = ((code) => {
        if (activeWorkers.size > 0 && !isMainThread) {
          // Worker called process.exit — terminate all active workers
          for (const [, w] of activeWorkers) {
            w.terminate();
          }
        } else {
          originalProcessExit(code);
        }
      }) as typeof process.exit;
    }

    const restoreMainState = () => {
      parentPort = savedParentPort;
      workerData = savedWorkerData;
      threadId = savedThreadId;
      isMainThread = savedIsMainThread;
      environmentData = savedEnvironmentData;
      if (options?.env && options.env !== SHARE_ENV) {
        process.env = savedEnv;
      }
      defaultExport.parentPort = savedParentPort;
      defaultExport.workerData = savedWorkerData;
      defaultExport.threadId = savedThreadId;
      defaultExport.isMainThread = savedIsMainThread;
    };

    // Import the worker module
    import(moduleUrl).then(() => {
      restoreMainState();
      this.emit("online");
    }).catch((err) => {
      restoreMainState();
      this.emit("error", err);
    });
  }

  [privateWorkerRef](ref) {
    if (ref) {
      this.#refCount++;
    } else {
      this.#refCount--;
    }

    if (!ref && this.#refCount == 0) {
      if (this.#controlPromise) {
        core.unrefOpPromise(this.#controlPromise);
      }
      if (this.#messagePromise) {
        core.unrefOpPromise(this.#messagePromise);
      }
    } else if (ref && this.#refCount == 1) {
      if (this.#controlPromise) {
        core.refOpPromise(this.#controlPromise);
      }
      if (this.#messagePromise) {
        core.refOpPromise(this.#messagePromise);
      }
    }
  }

  #handleError(err) {
    this.emit("error", err);
  }

  #pollControl = async () => {
  };

  #pollMessages = async () => {
  };

  postMessage(message, transferOrOptions = {}) {
    if (this.#status === "RUNNING") {
      this.#hostPort.postMessage(message, transferOrOptions);
    }
  }

  // https://nodejs.org/api/worker_threads.html#workerterminate
  terminate() {
    if (this.#status !== "TERMINATED") {
      this.#status = "TERMINATED";
      try { this.#hostPort.close(); } catch { /* ignore */ }
      activeWorkers.delete(this.#id);
      if (activeWorkers.size === 0) {
        process.exit = originalProcessExit;
      }
      queueMicrotask(() => this.emit("exit", 0));
    }
    return PromiseResolve(0);
  }

  ref() {
    this[privateWorkerRef](true);
  }

  unref() {
    this[privateWorkerRef](false);
  }

  readonly getHeapSnapshot = () =>
    notImplemented("Worker.prototype.getHeapSnapshot");
  readonly performance = globalThis.performance;
}

export let isMainThread;
export let resourceLimits;

let threadId = 0;
let workerData: unknown = null;
let environmentData = new SafeMap();

interface NodeEventTarget extends
  Pick<
    EventEmitter,
    "eventNames" | "listenerCount" | "emit" | "removeAllListeners"
  > {
  setMaxListeners(n: number): void;
  getMaxListeners(): number;
  // deno-lint-ignore no-explicit-any
  off(eventName: string, listener: (...args: any[]) => void): NodeEventTarget;
  // deno-lint-ignore no-explicit-any
  on(eventName: string, listener: (...args: any[]) => void): NodeEventTarget;
  // deno-lint-ignore no-explicit-any
  once(eventName: string, listener: (...args: any[]) => void): NodeEventTarget;
  addListener: NodeEventTarget["on"];
  removeListener: NodeEventTarget["off"];
}

type ParentPort = typeof self & NodeEventTarget;

// deno-lint-ignore no-explicit-any
let parentPort: ParentPort = null as any;

// Creates a Node-style parentPort adapter from a raw MessagePort
function createParentPortAdapter(port: MessagePort) {
  const listeners = new SafeWeakMap<
    // deno-lint-ignore no-explicit-any
    (...args: any[]) => void,
    // deno-lint-ignore no-explicit-any
    (ev: any) => any
  >();

  const adapter = {
    postMessage(message, transferOrOptions?) {
      port.postMessage(message, transferOrOptions);
    },
    off(name, listener) {
      port.removeEventListener(name, listeners.get(listener)!);
      listeners.delete(listener);
      return adapter;
    },
    on(name, listener) {
      // deno-lint-ignore no-explicit-any
      const _listener = (ev: any) => {
        const message = ev.data;
        return listener(message);
      };
      listeners.set(listener, _listener);
      port.addEventListener(name, _listener);
      return adapter;
    },
    once(name, listener) {
      // deno-lint-ignore no-explicit-any
      const _listener = (ev: any) => listener(ev.data);
      listeners.set(listener, _listener);
      port.addEventListener(name, _listener, { once: true });
      return adapter;
    },
    removeListener(name, listener) {
      return adapter.off(name, listener);
    },
    addListener(name, listener) {
      return adapter.on(name, listener);
    },
    setMaxListeners() {},
    getMaxListeners() { return Infinity; },
    eventNames() { return [""]; },
    listenerCount() { return 0; },
    emit() { return notImplemented("parentPort.emit"); },
    removeAllListeners() {
      return notImplemented("parentPort.removeAllListeners");
    },
    close() { port.close(); },
    ref() {},
    unref() {},
    [unrefParentPort]: false,
  };

  // Start the port so queued messages are delivered
  port.start();

  return adapter;
}

internals.__initWorkerThreads = (
  runningOnMainThread: boolean,
  workerId,
  maybeWorkerMetadata,
  _moduleSpecifier,
) => {
  isMainThread = runningOnMainThread;

  defaultExport.isMainThread = isMainThread;
  resourceLimits = isMainThread ? {} : {
    maxYoungGenerationSizeMb: 48,
    maxOldGenerationSizeMb: 2048,
    codeRangeSizeMb: 0,
    stackSizeMb: 4,
  };
  defaultExport.resourceLimits = resourceLimits;

  if (!isMainThread) {
    const listeners = new SafeWeakMap<
      // deno-lint-ignore no-explicit-any
      (...args: any[]) => void,
      // deno-lint-ignore no-explicit-any
      (ev: any) => any
    >();

    parentPort = self as ParentPort;
    threadId = workerId;
    if (maybeWorkerMetadata) {
      const { 0: metadata, 1: _ } = maybeWorkerMetadata;
      workerData = metadata.workerData;
      environmentData = metadata.environmentData;
      const env = metadata.env;
      if (env) {
        process.env = env;
      }
    }
    defaultExport.workerData = workerData;
    defaultExport.parentPort = parentPort;
    defaultExport.threadId = threadId;

    parentPort.off = parentPort.removeListener = function (
      this: ParentPort,
      name,
      listener,
    ) {
      this.removeEventListener(name, listeners.get(listener)!);
      listeners.delete(listener);
      return this;
    };
    parentPort.on = parentPort.addListener = function (
      this: ParentPort,
      name,
      listener,
    ) {
      // deno-lint-ignore no-explicit-any
      const _listener = (ev: any) => {
        const message = ev.data;
        return listener(message);
      };
      listeners.set(listener, _listener);
      this.addEventListener(name, _listener);
      return this;
    };

    parentPort.once = function (this: ParentPort, name, listener) {
      // deno-lint-ignore no-explicit-any
      const _listener = (ev: any) => listener(ev.data);
      listeners.set(listener, _listener);
      this.addEventListener(name, _listener);
      return this;
    };

    parentPort.setMaxListeners = () => {};
    parentPort.getMaxListeners = () => Infinity;
    parentPort.eventNames = () => [""];
    parentPort.listenerCount = () => 0;

    parentPort.emit = () => notImplemented("parentPort.emit");
    parentPort.removeAllListeners = () =>
      notImplemented("parentPort.removeAllListeners");

    parentPort.addEventListener("offline", () => {
      parentPort.emit("close");
    });
    parentPort.unref = () => {
      parentPort[unrefParentPort] = true;
    };
    parentPort.ref = () => {
      parentPort[unrefParentPort] = false;
    };
  }
};

export function getEnvironmentData(key: unknown) {
  return environmentData.get(key);
}

export function setEnvironmentData(key: unknown, value?: unknown) {
  if (value === undefined) {
    environmentData.delete(key);
  } else {
    environmentData.set(key, value);
  }
}

export const SHARE_ENV = SymbolFor("nodejs.worker_threads.SHARE_ENV");
export function markAsUntransferable() {
  notImplemented("markAsUntransferable");
}
export function moveMessagePortToContext() {
  notImplemented("moveMessagePortToContext");
}

export function receiveMessageOnPort(_port: MessagePort) {
  notImplemented("receiveMessageOnPort");
}

class NodeMessageChannel {
  port1: MessagePort;
  port2: MessagePort;

  constructor() {
    const mc = new MessageChannel();
    this.port1 = mc.port1;
    this.port2 = mc.port2;
  }
}

export {
  BroadcastChannel,
  MessagePort,
  NodeMessageChannel as MessageChannel,
  NodeWorker as Worker,
  parentPort,
  threadId,
  workerData,
};

const defaultExport = {
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  MessagePort,
  MessageChannel: NodeMessageChannel,
  BroadcastChannel,
  Worker: NodeWorker,
  getEnvironmentData,
  setEnvironmentData,
  SHARE_ENV,
  threadId,
  workerData,
  resourceLimits,
  parentPort,
  isMainThread,
};

export default defaultExport;
