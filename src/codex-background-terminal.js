'use strict';

// Request evidence only. No process lifecycle or originating command is inferred.
function backgroundTerminalRequest(argumentsText) {
  if (typeof argumentsText !== 'string') return null;
  let args;
  try { args = JSON.parse(argumentsText); } catch { return null; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  if (Object.hasOwn(args, 'chars') && typeof args.chars !== 'string') return null;
  const fact = { action: (args.chars ?? '') === '' ? 'poll' : 'input' };
  if (Number.isInteger(args.session_id) && args.session_id >= -2147483648 && args.session_id <= 2147483647) {
    fact.processId = args.session_id;
  }
  return fact;
}

function backgroundTerminalCall(raws, event) {
  if (event?.sourceKind !== 'codex' || event?.toolName !== 'write_stdin') return null;
  const calls = raws.filter((raw) => raw.recordType === 'response_item'
    && ['function_call', 'custom_tool_call'].includes(raw.payloadType));
  if (calls.length !== 1 || calls[0].payloadType !== 'function_call'
      || calls[0].toolName !== 'write_stdin' || !calls[0].callId) return null;
  return calls[0];
}

function buildBackgroundTerminalRequests(session) {
  const facts = new Map();
  const requests = session.logicalEvents.filter((event) => event.toolName === 'write_stdin');
  if (!requests.length) return facts;
  const rawById = new Map(session.rawEvents.map((raw) => [raw.rawId, raw]));
  for (const event of requests) {
    const raws = event.rawRefs.map((ref) => rawById.get(ref.rawId)).filter(Boolean);
    const call = backgroundTerminalCall(raws, event);
    const fact = call && backgroundTerminalRequest(call.output);
    if (fact) facts.set(event.id, fact);
  }
  return facts;
}

module.exports = { backgroundTerminalRequest, backgroundTerminalCall, buildBackgroundTerminalRequests };
