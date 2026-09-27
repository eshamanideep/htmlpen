# htmlpen

Comment on and edit local HTML files in your browser, so your coding agent knows exactly what to change.

Agents are great at writing HTML (reports, plans, prototypes, slides) but reviewing it is clumsy: you squint at the page, then describe *which* paragraph you mean in a chat box. htmlpen puts a small toolbar on the page itself. Click anything to leave a comment, or click text and just fix it.

![htmlpen](docs/screenshot.png)

```sh
npx htmlpen report.html
```

That's it. No extension, no account, no build step. It runs on `localhost` and only touches the file you opened and a comments file next to it.

## Using it

| Key | Mode | What happens |
| --- | --- | --- |
| `C` | Comment | Click any element to pin a comment on it. Select text first to quote it. |
| `E` | Edit | Click text and type. `Enter` writes it straight into the HTML file, `Esc` cancels, `Shift+Enter` adds a line break. |
| `Esc` | Browse | Back to a normal page: links and scripts work as usual. |

Comments are saved to `report.html.comments.json` as you go. When you're done, hand them to your agent in one of two ways:

- **Copy for agent** puts a ready-to-paste prompt on your clipboard: every open comment, which element it's on, and the quoted text.
- Or just tell the agent *"address the comments in report.html.comments.json"*. Each entry has the `comment`, plus `selector`, `element` and `text` so the agent can find the spot.

When the agent edits the HTML, the page reloads by itself. When it sets `"resolved": true` on a comment, the pin disappears.

You can also point it at a folder (`npx htmlpen ./out`) to browse and review every HTML file in it.

## Let Claude run the review loop

```sh
npx htmlpen --install-skill
```

This adds an htmlpen skill to Claude Code (`~/.claude/skills/htmlpen`). From then on, when Claude writes an HTML page for you (or you ask to review one), it opens the page in htmlpen and gives you the link. You comment, fix text, and press **Send to Claude**. The review goes straight back to Claude, Claude makes the changes, and your open page reloads to show them. No copy-paste.

Behind the scenes, Claude runs `npx -y htmlpen page.html --agent` in the background:

| Where Claude runs | The link you get | What **Send to Claude** does |
| --- | --- | --- |
| Claude Code on your machine | Opens in your browser | htmlpen prints the review and exits, which alerts Claude |
| A [Conductor](https://conductor.build) cloud workspace | The workspace's preview URL | Posts the review as a message in that Conductor chat |

**Conductor:** in a cloud workspace, htmlpen shares itself at the workspace's `conductor preview` URL (replacing whatever that URL was showing). Viewers sign in with Conductor. Only the link htmlpen prints, which ends in `?htmlpen=<key>`, can comment, edit or send. Teammates who open the plain preview URL can look but not change anything.

**Claude Code artifacts:** [artifacts](https://code.claude.com/docs/en/artifacts) publish a page on claude.ai for sharing, and htmlpen is where you iterate on it. Artifact pages run in a sandbox that blocks htmlpen's toolbar, and artifact comments can't edit text in place, so use them one after the other:

1. Review the local file with htmlpen. This works on any plan.
2. When it's right, ask Claude to publish it as an artifact. htmlpen never writes its toolbar into your file, so the file is ready to publish as is.
3. To revise a published artifact, Claude runs htmlpen on the artifact's local source, applies your review, and republishes to the same URL.

## Other agents (Codex, Cursor, …)

Use **Copy for agent**, or add this to your `AGENTS.md` so "address my comments" just works:

```md
## HTML review comments (htmlpen)
I review HTML files with htmlpen. Comments on `X.html` live in `X.html.comments.json`.
Each entry has `comment` (what I want), and `selector`, `element`, `text`, `quote` to locate it.
Apply every entry where `resolved` is false, then set `"resolved": true` on it.
```

## How edits stay safe

In-place edits write to your actual file, so htmlpen is careful about *where*:

- It only rewrites the inner HTML of the one element you edited. The rest of the file stays byte-for-byte identical, formatting and all.
- It checks that the element's current content is literally in the file before writing. Text rendered by JavaScript (charts, `fetch`ed data, templating) isn't, so htmlpen won't write it. Your edit becomes a comment for the agent instead, so nothing you type is lost.
- If several identical elements match, it refuses rather than guesses (also becoming a comment).
- The server binds to `127.0.0.1`, rejects non-localhost `Host` headers, and requires a header that browsers won't send cross-site, so other websites can't write to your files. When shared through Conductor, writes also need the link's edit key.

Your files are yours: use git (or your agent's undo) to roll back an edit.

## Limits

- Edits are text-level. Restyling, moving or deleting elements is a job for comments.
- Pasting inserts plain text.
- Comment pins find their element again by CSS selector. If the agent restructures the page a lot, a comment may show as "not found". It's still in the panel and the JSON.

## Develop

```sh
npm install
npm test
node src/cli.js examples/launch-plan.html
```

Three files plus a skill: `src/cli.js` (server + CLI), `src/client.js` (the in-page toolbar, in a Shadow DOM so it can't clash with your page's CSS), `src/edit.js` (maps a browser edit back to the source, using [parse5](https://github.com/inikulin/parse5) source locations), and `skills/htmlpen/SKILL.md` (what `--install-skill` copies).

MIT licensed.
