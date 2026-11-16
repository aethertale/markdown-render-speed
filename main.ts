// Driver for the markdown-render-speed-02 entry: renders every case in
// MAKEFUN_INPUT_DIR/cases.json with parse() and writes the HTML array to
// MAKEFUN_OUTPUT_DIR/html.json. No I/O inside parse(): it is pure, and
// each case is rendered independently (no state is shared between cases).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

interface Case {
  id: string;
  markdown: string;
}

// Render every case in order, one pure parse() call per case.
function renderAll(cases: Case[]): string[] {
  const html: string[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
  return html;
}

const cases: Case[] = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const html = renderAll(cases);
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
