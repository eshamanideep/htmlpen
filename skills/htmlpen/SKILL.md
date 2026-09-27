---
name: htmlpen
description: Let the user review an HTML file in their browser (pin comments on elements, edit text in place) and get the feedback back in this session. Use after creating or substantially changing an HTML page the user should look at (reports, plans, prototypes, slides, dashboards, an artifact before publishing), or when the user asks to review, mark up, annotate, comment on, or edit an HTML page.
---

# Review HTML with htmlpen

## 1. Open the review

Run this with the Bash tool's `run_in_background: true` (it keeps running while the user reviews):

```sh
npx -y htmlpen <file.html> --agent
```

Read its first output lines and give the user the URL it printed, exactly as printed.

- On the user's own machine the browser opens by itself.
- In a Conductor cloud workspace the URL is the workspace's preview link. It ends in `?htmlpen=<key>`, and only links with that key can edit, so share the full URL.

Then tell the user: press **C** to comment on anything, **E** to fix text in place, and **Send to Claude** when done. End your turn. Don't poll or sleep.

## 2. Receive the review

When the user presses **Send to Claude**, the review reaches you by itself:

- **In Conductor**, it arrives as a new chat message. htmlpen keeps running.
- **Elsewhere**, htmlpen prints the review and exits, and you're notified that the background command finished. Read its output.

## 3. Apply it

1. Re-read the HTML file first. Text the user edited in place is already saved in it, so don't overwrite those edits.
2. Address every comment in `<file>.comments.json` where `"resolved"` is `false`. Find each one's spot with `selector`, `element`, `text` and `quote`.
3. Set `"resolved": true` on each comment you addressed. If you skip one, leave it open and say why.
4. The user's open page reloads as you save. There's no need to reopen it.

If htmlpen exited (outside Conductor), start the next round with the same command plus `--no-open`. The user's open tab reconnects and reloads by itself.

## With Claude Code artifacts

Artifacts are for sharing a page on claude.ai, and htmlpen is for iterating on it with the user. They fit together:

- Review the local file with htmlpen first. When the user is happy, publish that same file as an artifact. htmlpen never writes its toolbar or comments into the HTML file.
- To revise an artifact you already published, run htmlpen on its local source file, apply the review, then republish to the same artifact URL.
- A file you'll publish must be self-contained: inline CSS and JS, and images as data URIs. htmlpen serves the file's folder, so relative links work in the review but break once published.
