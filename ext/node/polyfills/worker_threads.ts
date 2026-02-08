// Copyright 2018-2025 the Deno authors. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

import { core, internals, primordials } from "ext:core/mod.js";
import { unrefParentPort } from "ext:deno_web/13_message_port.js";
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

const privateWorkerRef = Symbol("privateWorkerRef");
class NodeWorker extends EventEmitter {
  #id = 0;
  #name = "";
  #refCount = 1;
  #messagePromise = undefined;
  #controlPromise = undefined;
  // "RUNNING" | "CLOSED" | "TERMINATED"
  #status = "RUNNING";

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

  constructor(_specifier: URL | string, _options?: WorkerOptions) {
    super();
    notImplemented("Worker.prototype.constructor");
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

  #handleError(_err) {
  }

  #pollControl = async () => {
  };

  #pollMessages = async () => {
  };

  postMessage(message, transferOrOptions = {}) {
    notImplemented("Worker.prototype.postMessage");
  }

  // https://nodejs.org/api/worker_threads.html#workerterminate
  terminate() {
    notImplemented("Worker.prototype.terminate");
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

    patchMessagePortIfFound(workerData);

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
        patchMessagePortIfFound(message);
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

class NodeMessagePort extends EventTarget {
  constructor() {
    super();
    notImplemented("MessagePort.prototype.constructor");
  }
}

class NodeBroadcastChannel extends EventTarget {
  constructor(_name) {
    super();
    notImplemented("BroadcastChannel.prototype.constructor");
  }
}

class NodeMessageChannel {
  port1: MessagePort;
  port2: MessagePort;

  constructor() {
    notImplemented("MessageChannel.prototype.constructor");
  }
}

// deno-lint-ignore no-explicit-any
function patchMessagePortIfFound(_data: any) {
}

export {
  NodeBroadcastChannel as BroadcastChannel,
  NodeMessagePort as MessagePort,
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
  MessagePort: NodeMessagePort,
  MessageChannel: NodeMessageChannel,
  BroadcastChannel: NodeBroadcastChannel,
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
