export function nativeFixture({ final = 'ok', onPrompt = () => {}, fail = false } = {}) {
  const calls = []
  let serial = 0
  const service = {
    create: async () => ({ sessionId: `native-${++serial}` }),
    state: async () => ({ running: null }),
    prompt: async args => { calls.push(args); onPrompt(args) },
    cancel: async args => calls.push({ cancelled: args.sessionId }),
    async *follow() {
      yield { type: 'snapshot', cursor: 5 }
      yield { type: 'event', event: { seq: 6, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '先查资料，计划说明不应成为结果。' }] } } } }
      yield { type: 'event', event: { seq: 7, type: 'tool/call', data: { callId: 't1', name: 'read_file' } } }
      yield { type: 'event', event: { seq: 8, type: 'tool/result', data: { message: { source: { callId: 't1' } } } } }
      yield { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: final } } }
      yield { type: 'event', event: { seq: 9, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: final }] } } } }
      yield { type: 'event', event: { seq: 10, type: 'turn/end', data: { reason: { kind: fail ? 'error' : 'completed' } } } }
    },
  }
  return { service, calls, ctx: { get: name => name === 'sessionController' ? service : null } }
}
