# markdown-render-speed

[![bounty](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/aethertale/markdown-render-speed/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/aethertale/markdown-render-speed/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A dependency-free, single-file Markdown renderer written from scratch for the
[markdown-render-speed-02 bounty](https://make.fun/bounty/markdown-render-speed-02)
("Make Markdown rendering faster").

`parse(markdown)` returns exactly the HTML that marked 18.1.3 produces with
default options (CommonMark 0.31.2 + GFM 0.29), byte-for-byte, with no
dependencies and no I/O. It is a hand-written two-phase parser: a block
parser (containers, leaf blocks, reference definitions, tables, task lists)
followed by a recursive inline parser (links, emphasis, code spans,
autolinks, entities, inline HTML) that reproduces marked's output rules,
including its quirks (numeric-entity decoding, extended autolinks,
strikethrough with 1–2 tildes, `language-` info strings, the document-level
`inLink` flag that suppresses GFM autolinks after an inline `<a>` tag, and
marked's `_backpedal` URL trimming).

## Speed

On the practice set the parser produces byte-identical HTML for all 720
cases (680 CommonMark/GFM spec cases plus 40 long README documents), and
runs in ~475–575 ms on this machine against ~675–770 ms for marked itself on the
same cases — about 1.3–1.4× faster. It is stateless per call: no caching across
cases, no memo, nothing written to disk.

## Usage

```js
import { parse } from './parse.js';

parse('# hello\n\n**world**');
// '<h1>hello</h1>\n<p><strong>world</strong></p>\n'
```

The harness driver is `main.ts`: it reads the cases from
`MAKEFUN_INPUT_DIR/cases.json`, renders each one alone with `parse()`, and
writes the HTML array to `MAKEFUN_OUTPUT_DIR/html.json`.

```sh
MAKEFUN_INPUT_DIR=<cases dir> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

## Layout

- `parse.js` — the renderer (export `parse`). No dependencies.
- `main.ts` — the harness driver (reads `cases.json`, writes `html.json`).
- `.makefun/owner.json` — the entry owner's wallet.

## License

MIT — see [LICENSE](LICENSE).
