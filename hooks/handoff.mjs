// Makes sure HTML pages Claude writes reach the user through htmlpen.
// PostToolUse: note each new .html file and tell Claude how to hand it over; running htmlpen
// clears the list. Stop: if pages are still waiting, ask Claude once to hand them over.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = JSON.parse(readFileSync(0, 'utf8'));
const { hook_event_name: event, tool_name: tool, tool_input: args = {}, cwd = '.' } = input;
const cli = path.resolve(fileURLToPath(import.meta.url), '../../src/cli.js');
const stateFile = path.join(tmpdir(), `htmlpen-${String(input.session_id).replace(/\W/g, '')}.json`);
let state = { seen: [], pending: [] };
try {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} catch {}
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const command = (file) => `node "${cli}" "${file}" --agent`;
const reply = (out) => console.log(JSON.stringify(out));

if (event === 'Stop') {
  if (!state.pending.length || input.stop_hook_active) process.exit(0);
  const files = state.pending;
  state.pending = [];
  save();
  reply({
    decision: 'block',
    reason:
      `You wrote ${files.join(', ')} but haven't handed it to the user. For each page meant for ` +
      `them, follow the htmlpen:review-html skill: run \`${command(files[0])}\` in the background ` +
      '(Bash run_in_background: true) and share the URL it prints. If a file is only a scratch ' +
      'file, build output, or test fixture, say so in one line and finish.',
  });
  process.exit(0);
}

const cmd = String(args.command ?? '');
if (tool === 'Bash' && /htmlpen|src\/cli\.js/.test(cmd) && /--agent/.test(cmd)) {
  state.pending = []; // handed over
  save();
  process.exit(0);
}
// The Write tool's path, or a shell redirect/tee into an .html file (`cat > page.html <<EOF`).
const written =
  tool === 'Write' ? args.file_path : cmd.match(/(?:>|\btee\s+(?:-a\s+)?)\s*["']?([^\s"'<>|;&]+\.html?)\b/i)?.[1];
if (!written || !/\.html?$/i.test(written)) process.exit(0);
const file = path.resolve(cwd, written);
if (state.seen.includes(file)) process.exit(0);
state.seen.push(file);
state.pending.push(file);
save();
reply({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      `htmlpen: you wrote ${file}. If it's a page for the user (not app source, build output, a ` +
      'scratch file, or a test fixture), finish by handing it to them for review: follow the ' +
      `htmlpen:review-html skill, which starts with \`${command(file)}\` in the background.`,
  },
});
