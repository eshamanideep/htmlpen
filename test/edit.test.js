import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdit } from '../src/edit.js';

const page = (body) => `<!doctype html>\n<html><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;

test('replaces only the edited element and leaves the rest of the file byte-for-byte', () => {
  const src = page('<h1 class="t">Hello   world</h1>\n<p>Keep &mdash; me</p>');
  const out = applyEdit(src, { tag: 'h1', path: [0], before: 'Hello   world', after: 'Hi there' });
  assert.equal(out, page('<h1 class="t">Hi there</h1>\n<p>Keep &mdash; me</p>'));
});

test('matches the browser serialization of entities and inline markup', () => {
  const src = page('<p>Price &amp; value &mdash; <b>now</b><br/></p>');
  const out = applyEdit(src, {
    tag: 'p',
    path: [0],
    before: 'Price &amp; value — <b>now</b><br>',
    after: 'Price &amp; value — <b>later</b><br>',
  });
  assert.equal(out, page('<p>Price &amp; value — <b>later</b><br></p>'));
});

test('handles implied end tags without eating the parent close tag', () => {
  const src = '<body><ul><li>One<li>Two</ul><p>Last\n</body></html>\n';
  const li = applyEdit(src, { tag: 'li', path: [0, 1], before: 'Two', after: 'Deux' });
  assert.equal(li, '<body><ul><li>One<li>Deux</ul><p>Last\n</body></html>\n');
  // The browser merges the newline after </html> into the last paragraph's text.
  const p = applyEdit(src, { tag: 'p', path: [1], before: 'Last\n\n', after: 'Fin\n' });
  assert.equal(p, '<body><ul><li>One<li>Two</ul><p>Fin\n</body></html>\n');
});

test('uses the path to pick between identical elements', () => {
  const src = page('<a>More</a><a>More</a>');
  const out = applyEdit(src, { tag: 'a', path: [1], before: 'More', after: 'Details' });
  assert.equal(out, page('<a>More</a><a>Details</a>'));
});

test('refuses ambiguous edits instead of guessing', () => {
  const src = page('<div><a>More</a></div><a>More</a>');
  assert.throws(
    () => applyEdit(src, { tag: 'a', path: [5], before: 'More', after: 'X' }),
    /Several identical/,
  );
});

test('refuses content that is not in the file (script-generated or changed since)', () => {
  const src = page('<div id="app"></div>');
  assert.throws(
    () => applyEdit(src, { tag: 'div', path: [0], before: 'Rendered by JS', after: 'X' }),
    /isn't in the file/,
  );
});

test('keeps self-closing SVG and attributes intact around the edit', () => {
  const src = page('<figure><svg><path d="M0 0"/></svg><figcaption>Old</figcaption></figure>');
  const out = applyEdit(src, { tag: 'figcaption', path: [0, 1], before: 'Old', after: 'New' });
  assert.equal(out, page('<figure><svg><path d="M0 0"/></svg><figcaption>New</figcaption></figure>'));
});
