// Copyright 2018-2026 the Deno authors. MIT license.
(function () {
const { inner } = Deno.core.createLazyLoader("custom:inner")();
return { a: inner };
})();
