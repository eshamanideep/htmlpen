# htmlpen

Comment on and edit local HTML in your browser, and send the review straight to your coding agent.

![htmlpen](docs/screenshot.png)

```sh
npx htmlpen report.html   # or a folder
```

Press **C** to pin a comment on anything (select text to quote it), **E** to edit text in place (`Enter` saves to the file), **Esc** to browse. Comments save to `report.html.comments.json`; **Copy for agent** puts them on your clipboard as a prompt. The page live-reloads as your agent edits the file.

## With Claude Code

```sh
npx htmlpen --install-skill
```

Now when Claude writes an HTML page, it opens it in htmlpen and gives you the link. Review it, press **Send to Claude**, and the review lands back in the session. It works locally and in [Conductor](https://conductor.build) cloud workspaces (shared at the workspace preview URL; only the printed link can edit). For [artifacts](https://code.claude.com/docs/en/artifacts): review the file with htmlpen first, then publish it.

Other agents: tell them to apply the unresolved entries in `<file>.comments.json` and set `"resolved": true`.

## Safe edits

- Only the edited element's content is rewritten; the rest of the file stays byte-for-byte identical.
- Anything it can't write exactly (script-rendered text, non-UTF-8 files, unusual markup) becomes a comment instead, so nothing you type is lost.
- Localhost only, no dotfiles, no cross-site writes. `npm run test:browser` edits 102 elements across 13 tricky pages in Chrome and fails on any corruption.

## Develop

```sh
npm install && npm test && npm run test:browser
node src/cli.js examples/launch-plan.html
```

MIT licensed.
