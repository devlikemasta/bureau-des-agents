#!/usr/bin/env node
// Hook za Kancelariju agenata. Claude Code ga zove na SubagentStart / SubagentStop / PreToolUse /
// PostToolUse / SessionEnd. Pravila:
//   - kancelarija ugašena ili sesija nije prijavljena → izlazi odmah, bez mreže;
//   - nikad ne blokira sesiju: šalje skraćen događaj sa timeout-om 300 ms i ćuti na svaku grešku;
//   - ne piše ništa na stdout (neki hookovi ubacuju stdout u razgovor).
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.KANCELARIJA_DIR ?? path.join(os.homedir(), '.kancelarija');

function done() { process.exit(0); }

let akt;
try { akt = JSON.parse(readFileSync(path.join(DIR, 'aktivno.json'), 'utf8')); } catch { done(); }
if (!akt?.pid || !akt.token) done();
try { process.kill(akt.pid, 0); } catch { done(); }

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let h;
  try { h = JSON.parse(raw); } catch { done(); }
  if (!h?.session_id || !akt.sesije?.[h.session_id]) done();
  try {
    await fetch(`http://127.0.0.1:${akt.port}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kancelarija-token': akt.token },
      body: JSON.stringify(slim(h)),
      signal: AbortSignal.timeout(300),
    });
  } catch { /* kancelarija ne odgovara: sesija ide dalje */ }
  done();
});
setTimeout(done, 1500).unref();

/** Samo ono što kancelariji treba: bez sadržaja fajlova i dugih rezultata. */
function slim(h) {
  const out = {
    event: h.hook_event_name, session_id: h.session_id, cwd: h.cwd,
    agent_id: h.agent_id, agent_type: h.agent_type, agent_transcript_path: h.agent_transcript_path,
    tool_name: h.tool_name, tool_use_id: h.tool_use_id,
  };
  if (h.tool_input && typeof h.tool_input === 'object') {
    const i = {};
    for (const [k, v] of Object.entries(h.tool_input)) {
      if (['content', 'new_string', 'old_string', 'edits', 'new_source'].includes(k)) continue;
      i[k] = typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) : v;
    }
    out.tool_input = i;
  }
  const r = h.tool_response;
  if (r && typeof r === 'object' && (h.tool_name === 'Agent' || h.tool_name === 'Task')) {
    out.tool_response = { agentId: r.agentId, description: r.description, resolvedModel: r.resolvedModel, status: r.status, prompt: typeof r.prompt === 'string' ? r.prompt.slice(0, 2000) : undefined };
  } else if (r && typeof r === 'object') {
    out.tool_response = { is_error: !!(r.is_error || r.error) };
  }
  return out;
}
