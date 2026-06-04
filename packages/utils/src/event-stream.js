/// <reference types="node" />
/**
 * A ReadableStream that parses SSE from a raw byte stream.
 * Extends ReadableStream<T> so it can be consumed with standard APIs.
 */
export class EventStream extends ReadableStream {
    constructor(responseBody, parse, opts) {
        const upstream = responseBody.getReader();
        let buffer = new Uint8Array();
        const state = { eventId: undefined };
        const dataRequired = opts?.dataRequired ?? true;
        super({
            async pull(downstream) {
                try {
                    while (true) {
                        const match = findBoundary(buffer);
                        if (!match) {
                            const chunk = await upstream.read();
                            if (chunk.done)
                                return downstream.close();
                            buffer = concatBuffer(buffer, chunk.value);
                            continue;
                        }
                        const message = buffer.slice(0, match.index);
                        buffer = buffer.slice(match.index + match.length);
                        const item = parseMessage(message, parse, state, dataRequired);
                        if (item && !item.done)
                            return downstream.enqueue(item.value);
                        if (item?.done) {
                            await upstream.cancel('done');
                            return downstream.close();
                        }
                    }
                }
                catch (e) {
                    downstream.error(e);
                    await upstream.cancel(e);
                }
            },
            cancel: (reason) => upstream.cancel(reason),
        });
    }
    // Polyfill for older runtimes that don't have async iterator on ReadableStream
    [Symbol.asyncIterator]() {
        const fn = ReadableStream.prototype[Symbol.asyncIterator];
        if (typeof fn === 'function')
            return fn.call(this);
        const reader = this.getReader();
        return {
            async next() {
                const r = await reader.read();
                if (r.done) {
                    reader.releaseLock();
                    return { done: true, value: undefined };
                }
                return { done: false, value: r.value };
            },
            async throw(e) {
                await reader.cancel(e);
                reader.releaseLock();
                return { done: true, value: undefined };
            },
            async return() {
                await reader.cancel('done');
                reader.releaseLock();
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
}
function concatBuffer(a, b) {
    const c = new Uint8Array(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
}
const CR = 13;
const LF = 10;
// All possible SSE message boundaries, ordered by specificity
const BOUNDARIES = [
    [CR, LF, CR, LF], // \r\n\r\n
    [CR, LF, CR], // \r\n\r
    [CR, LF, LF], // \r\n\n
    [CR, CR, LF], // \r\r\n
    [LF, CR, LF], // \n\r\n
    [CR, CR], // \r\r
    [LF, CR], // \n\r
    [LF, LF], // \n\n
];
function findBoundary(buf) {
    const len = buf.length;
    for (let i = 0; i < len; i++) {
        if (buf[i] !== CR && buf[i] !== LF)
            continue;
        for (const boundary of BOUNDARIES) {
            if (i + boundary.length > len)
                continue;
            let match = true;
            for (let j = 0; j < boundary.length; j++) {
                if (buf[i + j] !== boundary[j]) {
                    match = false;
                    break;
                }
            }
            if (match)
                return { index: i, length: boundary.length };
        }
    }
    return null;
}
function parseMessage(chunk, parse, state, dataRequired) {
    const text = new TextDecoder().decode(chunk);
    const lines = text.split(/\r\n|\r|\n/);
    const dataLines = [];
    const ret = {};
    let ignore = true;
    for (const line of lines) {
        if (!line || line.startsWith(':'))
            continue;
        ignore = false;
        const i = line.indexOf(':');
        let field = line;
        let value = '';
        if (i > 0) {
            field = line.slice(0, i);
            value = line[i + 1] === ' ' ? line.slice(i + 2) : line.slice(i + 1);
        }
        if (field === 'data')
            dataLines.push(value);
        else if (field === 'event')
            ret.event = value;
        else if (field === 'id' && !value.includes('\0'))
            state.eventId = value;
        else if (field === 'retry' && /^\d+$/.test(value)) {
            ret.retry = Number(value);
        }
    }
    if (ignore)
        return;
    ret.id = state.eventId;
    if (dataLines.length) {
        ret.data = dataLines.join('\n');
    }
    else if (dataRequired) {
        return; // skip data-less events when data is required
    }
    return parse(ret);
}
/**
 * Convenience: parse an OpenAI-compatible SSE stream into typed messages.
 */
export function parseOpenAISSE(responseBody) {
    return new EventStream(responseBody, (msg) => {
        if (msg.data === '[DONE]')
            return { done: true, value: undefined };
        return { done: false, value: msg.data };
    });
}
//# sourceMappingURL=event-stream.js.map