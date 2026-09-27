import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEdit } from '../src/edit.js';

const page = (body) => `<!doctype html>\n<html><head><title>t</title></head>\n<body>\n${body}\n</body></html>\n`;
const one = { index: 0, count: 1 };

test('replaces only the edited element and leaves the rest of the file byte-for-byte', () => {
  const src = page('<h1 class="t">Hello   world</h1>\n<p>Keep &mdash; me</p>');
  const out = applyEdit(src, { tag: 'h1', ...one, before: 'Hello   world', after: 'Hi there' });
  assert.equal(out, page('<h1 class="t">Hi there</h1>\n<p>Keep &mdash; me</p>'));
});

test('matches the browser serialization of entities and inline markup', () => {
  const src = page('<p>Price &amp; value &mdash; <b>now</b><br/></p>');
  const out = applyEdit(src, {
    tag: 'p',
    ...one,
    before: 'Price &amp; value — <b>now</b><br>',
    after: 'Price &amp; value — <b>later</b><br>',
  });
  assert.equal(out, page('<p>Price &amp; value — <b>later</b><br></p>'));
});

test('handles implied end tags without eating the parent close tag', () => {
  const src = '<body><ul><li>One<li>Two</ul><p>Last\n</body></html>\n';
  const li = applyEdit(src, { tag: 'li', ...one, before: 'Two', after: 'Deux' });
  assert.equal(li, '<body><ul><li>One<li>Deux</ul><p>Last\n</body></html>\n');
  // The browser merges the newline after </html> into the last paragraph's text, so the edit
  // (which already contains it) replaces it rather than growing a newline on every save.
  const p = applyEdit(src, { tag: 'p', ...one, before: 'Last\n\n', after: 'Last\n\n ZZ' });
  assert.equal(p, '<body><ul><li>One<li>Two</ul><p>Last\n\n ZZ</body></html>');
});

test('keeps a comment that sits after </body> when the last paragraph has no end tag', () => {
  const src = '<body><p>Last para\n</body>\n<!-- build abc123 -->\n</html>\n';
  const [before, after] = ['Last para\n\n\n\n', 'Last para!\n\n\n\n'];
  const out = applyEdit(src, { tag: 'p', ...one, before, after });
  assert.equal(out, '<body><p>Last para!\n\n\n\n</body><!-- build abc123 --></html>');
});

test('picks the right one of several identical elements', () => {
  const src = page('<a>More</a><a>More</a>');
  const out = applyEdit(src, { tag: 'a', index: 1, count: 2, before: 'More', after: 'Details' });
  assert.equal(out, page('<a>More</a><a>Details</a>'));
});

test('still picks the right element when a script inserted others around it', () => {
  // The live page has a script-added banner first; identical paragraphs keep their order.
  const src = page('<p>TBD</p><p>TBD</p>');
  const out = applyEdit(src, { tag: 'p', index: 0, count: 2, before: 'TBD', after: 'Done' });
  assert.equal(out, page('<p>Done</p><p>TBD</p>'));
});

test('refuses when a script made another element look like this one', () => {
  // Live: a script changed #a to "Final", so the browser sees two <p>Final</p>; the file has one.
  const src = page('<p id="a">Draft</p><p id="b">Final</p>');
  assert.throws(
    () => applyEdit(src, { tag: 'p', index: 0, count: 2, before: 'Final', after: 'Final v2' }),
    /scripts add or change/,
  );
});

test('refuses content that is not in the file (script-generated or changed since)', () => {
  const src = page('<div id="app"></div>');
  assert.throws(
    () => applyEdit(src, { tag: 'div', ...one, before: 'Rendered by JS', after: 'X' }),
    /isn't in the file/,
  );
});

test('refuses when misnested markup would make the edit spill outside the element', () => {
  const src = page('<b>Note:<p>Ship it</b> on Friday.</p><p>Second</p>');
  assert.throws(
    () =>
      applyEdit(src, {
        tag: 'p',
        ...one,
        before: '<b>Ship it</b> on Friday.',
        after: '<b>Ship it</b> on Friday.!',
      }),
    /unusual/,
  );
});

test('keeps leading blank lines in <pre> across repeated edits', () => {
  let src = page('<pre>\n\nfirst line</pre>');
  src = applyEdit(src, { tag: 'pre', ...one, before: '\nfirst line', after: '\nfirst line!' });
  src = applyEdit(src, { tag: 'pre', ...one, before: '\nfirst line!', after: '\nfirst line!!' });
  assert.equal(src, page('<pre>\n\nfirst line!!</pre>'));
});

test('keeps self-closing SVG and attributes intact around the edit', () => {
  const src = page('<figure><svg><path d="M0 0"/></svg><figcaption>Old</figcaption></figure>');
  const out = applyEdit(src, { tag: 'figcaption', ...one, before: 'Old', after: 'New' });
  assert.equal(out, page('<figure><svg><path d="M0 0"/></svg><figcaption>New</figcaption></figure>'));
});
