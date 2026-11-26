'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', 'client', 'public');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('icons.js is local, monochrome and uses currentColor', () => {
  const s = read('icons.js');
  assert.ok(s.includes('stroke="currentColor"'));
  assert.ok(s.includes('window.ADAQ_ICONS'));
  assert.ok(!/https?:\/\//.test(s), 'no CDN URLs');
});
test('theme tokens exist for dark/light and icon colors', () => {
  const css = read('auth.css');
  for (const t of ['dark', 'light']) {
    assert.ok(css.includes('.th-' + t));
    assert.ok(css.includes('--icon'));
  }
  assert.ok(css.includes('--icon-muted') && css.includes('--icon-active') && css.includes('--icon-danger'));
});
test('nav buttons have no emoji and carry aria-labels', () => {
  const html = read('index.html');
  const nav = html.match(/<nav id="nav">[\s\S]*?<\/nav>/)[0];
  assert.ok(!/[📈📊😀📰🎯⚙🛡]/.test(nav));
  assert.equal((nav.match(/aria-label=/g) || []).length, 7);
});
test('no CDN icon fonts', () => {
  const html = read('index.html');
  assert.ok(!/cdnjs|unpkg|jsdelivr|fonts\.googleapis/.test(html));
});
