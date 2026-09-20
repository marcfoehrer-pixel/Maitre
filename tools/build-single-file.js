#!/usr/bin/env node
/**
 * Baut aus index.html, styles.css und den Skripten eine einzige HTML-Datei.
 * Praktisch zum Verschicken, für USB-Stick oder offline.
 *
 *   node tools/build-single-file.js            -> dist/tetris.html
 *   node tools/build-single-file.js --body out -> nur der Rumpf, ohne
 *      <!DOCTYPE>/<html>/<head>/<body>; so erwarten es Hosts, die ein
 *      eigenes Seitengerüst darumlegen.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function build() {
  const html = read('index.html');
  const css = read('styles.css');

  const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Tetris'])[1];
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [, ''])[1];

  // <script src="..."> durch den Dateiinhalt ersetzen, Reihenfolge bleibt.
  const inlined = body.replace(
    /[ \t]*<script src="([^"]+)"><\/script>\s*/g,
    (_, src) => '  <script>\n' + read(src).trimEnd() + '\n  </script>\n'
  );

  return { title, css, inlined };
}

function main() {
  const { title, css, inlined } = build();
  const bodyOnly = process.argv.includes('--body');
  const outArg = process.argv[process.argv.indexOf('--body') + 1];

  const head = `<title>${title}</title>\n<style>\n${css.trimEnd()}\n</style>\n`;

  let out;
  let target;
  if (bodyOnly) {
    out = head + inlined.trimEnd() + '\n';
    target = outArg && !outArg.startsWith('--') ? outArg : 'dist/tetris-body.html';
  } else {
    out = [
      '<!DOCTYPE html>',
      '<html lang="de">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
      '  ' + head.trim().split('\n').join('\n  '),
      '</head>',
      '<body>',
      inlined.trimEnd(),
      '</body>',
      '</html>',
      ''
    ].join('\n');
    target = 'dist/tetris.html';
  }

  const abs = path.isAbsolute(target) ? target : path.join(root, target);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, out);
  console.log(`${target} geschrieben (${(out.length / 1024).toFixed(1)} KB)`);
}

main();
