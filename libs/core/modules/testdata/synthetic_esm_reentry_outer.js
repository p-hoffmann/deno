// Copyright 2018-2026 the Deno authors. MIT license.

// Resolving `custom:synth` evaluates its backing script, which instantiates
// another module. Resolution of `custom:peer` must still work afterwards.
import { a } from "custom:synth";
import { b } from "custom:peer";

export const value = a + b;
