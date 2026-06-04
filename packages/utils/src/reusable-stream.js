/**
 * A reusable readable stream that allows multiple consumers to read from the
 * same source stream concurrently while it's actively streaming.
 *
 * Ported from OpenRouter SDK's ReusableReadableStream.
 *
 * Key features:
 * - Multiple concurrent consumers with independent read positions
 * - New consumers can attach while streaming is active
 * - Efficient memory management with automatic cleanup
 * - Each consumer can read at their own pace
 */
export class ReusableReadableStream {
    sourceStream;
    buffer = [];
    consumers = new Map();
    nextConsumerId = 0;
    sourceReader = null;
    sourceComplete = false;
    sourceError = null;
    pumpStarted = false;
    /**
     * Create a ReusableReadableStream from an AsyncIterable.
     * Bridges adapter executeStream() output to multi-consumer streaming.
     */
    static fromAsyncIterable(iterable) {
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of iterable) {
                        controller.enqueue(chunk);
                    }
                    controller.close();
                }
                catch (error) {
                    controller.error(error);
                }
            },
        });
        return new ReusableReadableStream(readableStream);
    }
    constructor(sourceStream) {
        this.sourceStream = sourceStream;
    }
    /**
     * Create a new consumer that can independently iterate over the stream.
     * Multiple consumers can be created and will all receive the same data.
     */
    createConsumer() {
        const consumerId = this.nextConsumerId++;
        const state = {
            position: 0,
            waitingPromise: null,
            cancelled: false,
        };
        this.consumers.set(consumerId, state);
        if (!this.pumpStarted) {
            this.startPump();
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            async next() {
                const consumer = self.consumers.get(consumerId);
                if (!consumer || consumer.cancelled) {
                    return { done: true, value: undefined };
                }
                // If we have buffered data at this position, return it
                if (consumer.position < self.buffer.length) {
                    const value = self.buffer[consumer.position];
                    consumer.position++;
                    return { done: false, value };
                }
                // If source is complete and we've read everything, we're done
                if (self.sourceComplete) {
                    self.consumers.delete(consumerId);
                    return { done: true, value: undefined };
                }
                // If source had an error, propagate it
                if (self.sourceError) {
                    self.consumers.delete(consumerId);
                    throw self.sourceError;
                }
                // Set up the waiting promise FIRST to avoid race condition
                const waitPromise = new Promise((resolve, reject) => {
                    consumer.waitingPromise = { resolve, reject };
                    // Immediately check if we should resolve after setting up the promise
                    if (self.sourceComplete || self.sourceError || consumer.position < self.buffer.length) {
                        resolve();
                    }
                });
                await waitPromise;
                consumer.waitingPromise = null;
                // Recursively try again after waking up
                return this.next();
            },
            async return() {
                const consumer = self.consumers.get(consumerId);
                if (consumer) {
                    consumer.cancelled = true;
                    self.consumers.delete(consumerId);
                }
                return { done: true, value: undefined };
            },
            async throw(e) {
                const consumer = self.consumers.get(consumerId);
                if (consumer) {
                    consumer.cancelled = true;
                    self.consumers.delete(consumerId);
                }
                throw e;
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    startPump() {
        if (this.pumpStarted)
            return;
        this.pumpStarted = true;
        this.sourceReader = this.sourceStream.getReader();
        void (async () => {
            try {
                while (true) {
                    const result = await this.sourceReader.read();
                    if (result.done) {
                        this.sourceComplete = true;
                        this.notifyAllConsumers();
                        break;
                    }
                    this.buffer.push(result.value);
                    this.notifyAllConsumers();
                }
            }
            catch (error) {
                this.sourceError = error instanceof Error ? error : new Error(String(error));
                this.notifyAllConsumers();
            }
            finally {
                if (this.sourceReader) {
                    this.sourceReader.releaseLock();
                }
            }
        })();
    }
    notifyAllConsumers() {
        for (const consumer of this.consumers.values()) {
            if (consumer.waitingPromise) {
                if (this.sourceError) {
                    consumer.waitingPromise.reject(this.sourceError);
                }
                else {
                    consumer.waitingPromise.resolve();
                }
                consumer.waitingPromise = null;
            }
        }
    }
    /**
     * Cancel the source stream and all consumers.
     */
    async cancel() {
        for (const consumer of this.consumers.values()) {
            consumer.cancelled = true;
            if (consumer.waitingPromise) {
                consumer.waitingPromise.resolve();
            }
        }
        this.consumers.clear();
        if (this.sourceReader) {
            await this.sourceReader.cancel();
            this.sourceReader.releaseLock();
        }
    }
}
//# sourceMappingURL=reusable-stream.js.map