// PostToolUse hook: when Claude writes an HTML file, remind it (once per file per session) to
// hand the page to the user with the review-html skill. Prints nothing for anything else.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const { tool_name: tool, tool_input: args = {}, session_id: session = 'unknown', cwd = '.' } = input;

// Write tool: its file_path. Bash: a redirect or tee into an .html file (`cat > page.html <<EOF`).
const written =
  tool === 'Write'
    ? args.file_path
    : String(args.command ?? '').match(/(?:>|\btee\s+(?:-a\s+)?)\s*["']?([^\s"'<>|;&]+\.html?)\b/i)?.[1];
if (!written || !/\.html?$/i.test(written)) process.exit(0);
const file = path.resolve(cwd, written);

const seenFile = path.join(tmpdir(), `htmlpen-nudged-${session.replace(/\W/g, '')}.json`);
let seen = [];
try {
  seen = JSON.parse(readFileSync(seenFile, 'utf8'));
} catch {}
if (seen.includes(file)) process.exit(0);
writeFileSync(seenFile, JSON.stringify([...seen, file]));

const additionalContext =
  `htmlpen: you wrote ${file}. If it's a page for the user to look at (not app source, build ` +
  'output, or a test fixture), finish your work by handing it to them with the ' +
  'htmlpen:review-html skill, so they can comment on it and edit it in their browser. ' +
  'A screenshot check of your own does not replace their review.';
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
