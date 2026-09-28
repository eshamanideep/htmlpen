# Privacy

htmlpen runs on your computer. It has no server of its own, collects no analytics, and keeps nothing anywhere but your machine.

## What it reads

- The HTML file or folder you open. A local server on `127.0.0.1` shows it in your browser.
- A few environment variables that tell it whether it's running in Claude Code or in a Conductor workspace.

## What it writes

- Your text edits, back into the HTML file you opened.
- Your comments, in `<file>.comments.json` next to that file. They stay until you or your agent delete them.
- A short list of HTML file paths Claude wrote in the current session, kept by the Claude Code hooks in a file in your system temp folder.
- **Copy for agent** puts your comments on your clipboard.

## What leaves your machine

Nothing, unless you run it in a Conductor cloud workspace. There, htmlpen uses the `conductor` CLI to share the review page at the workspace's preview URL, and to post your review to that workspace's chat when you press **Send to Claude**. Anyone who can open the preview URL can view the page; only the printed link can edit it. That link's edit key is a one-way SHA-256 hash of the workspace's `CONDUCTOR_API_TOKEN`. The token itself is never sent or shown.

## Contact

Open an issue at https://github.com/eshamanideep/htmlpen/issues.
