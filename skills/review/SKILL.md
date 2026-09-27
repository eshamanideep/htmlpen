---
name: review
description: Hand HTML pages to the user through htmlpen so they can pin comments and edit text in their browser, with the review coming straight back to this session. Use whenever you create or substantially change an HTML file for the user (a report, one-pager, plan, comparison, briefing, prototype, slide deck, dashboard), when the user wants to review, mark up, comment on, or edit an HTML page or a Claude Code artifact, and before publishing an artifact they want to check first. Needs a shell on the user's machine (Claude Code). Skip it for app source served by a dev server, build output, and test fixtures.
---

# Review HTML with htmlpen

This needs to run a command on the user's machine. If you can't run shell commands here, skip this skill.

## 1. Open the review

Run this with the Bash tool's `run_in_background: true`. It keeps running while the user reviews:

```sh
node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" <file.html> --agent
```

Read its first output lines and give the user the URL it printed, exactly as printed.

- On the user's own machine, the browser opens by itself.
- In a Conductor cloud workspace, the URL is the workspace's preview link. It ends in `?htmlpen=<key>`, and only links with that key can edit, so share the full URL.

Tell the user: press **C** to comment on anything, **E** to fix text in place, and **Send to Claude** when done. Then end your turn. Don't poll or sleep.

## 2. Receive the review

When the user presses **Send to Claude**, the review reaches you by itself:

- **In Conductor**, it arrives as a new chat message. htmlpen keeps running.
- **Elsewhere**, htmlpen prints the review and exits, and you're notified that the background command finished. Read its output.

## 3. Apply it

1. Re-read the HTML file first. Text the user edited in place is already saved in it, so don't overwrite those edits.
2. Address every comment in `<file>.comments.json` where `"resolved"` is `false`. Find each one's spot with `selector`, `element`, `text` and `quote`.
3. Set `"resolved": true` on each comment you addressed. If you skip one, leave it open and say why.
4. The user's open page reloads as you save.

If htmlpen exited (outside Conductor), start the next round with the same command plus `--no-open`. The user's open tab reconnects and reloads by itself.

## With Claude Code artifacts

An artifact is a page published on claude.ai. htmlpen can't run inside a published artifact, because the artifact sandbox blocks its toolbar, but it works on the local HTML file the artifact is published from:

- **Review before sharing:** if the user wants to check the page first, write the file, review it with htmlpen, then publish that file as the artifact.
- **Revise a published artifact:** open htmlpen on its local source file. That's the file you published from; for an artifact you only have the URL of, read the artifact first and Claude Code saves its full source locally. Apply each review to that file, then publish it again to the same artifact URL. Anyone viewing the artifact sees the update in place.
- **After publishing:** the artifact page opens by itself, so don't also open htmlpen. Mention that the user can ask to review it in htmlpen to comment on it or fix text directly.

htmlpen serves the file's folder, so relative links work while reviewing. An artifact must be self-contained, though (inline CSS and JS, images as data URIs), or those links break once it's published.
