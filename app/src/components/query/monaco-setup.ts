// Hands the bundled Monaco to @monaco-editor/react instead of letting its
// loader fetch one from jsDelivr, which is the default when nobody calls
// loader.config().
//
// The CDN path never worked here and failed in a way that looked like a pile
// of style regressions: the page CSP (src/middleware.ts) carries
// `strict-dynamic` on script-src, so the loader-injected <script> tags were
// trusted and every JS chunk arrived, while style-src is 'self' only, so the
// <link> to editor.main.css was refused and delivered 0 bytes. Monaco lays
// out caret, lines, gutter and the hidden input surface with inline
// top/left on nodes its stylesheet makes position: absolute; without the
// sheet they are static, the caret pins to the left edge, clicks never focus
// the editor and the IME textarea renders as a visible resizable box.
//
// Importing the ESM package pulls its CSS through the bundler, same-origin,
// and the worker comes from a same-origin module URL, which worker-src
// already allows. Import this module only on the client (see query-editor.tsx):
// Monaco's top level expects a window.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

// The editor only hosts SQL, which has no language service of its own, so the
// base editor worker is the only one needed. The bundler sees the static
// `new URL(..., import.meta.url)` and emits the worker as its own chunk.
self.MonacoEnvironment = {
  getWorker: () =>
    new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), {
      type: 'module',
    }),
}

loader.config({ monaco })
