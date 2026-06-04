/**
 * Ported from OpenRouter SDK's tool-event-broadcaster.ts with adaptations for DMR-X.
 *
 * A push-based event broadcaster that supports multiple concurrent consumers.
 * Each consumer gets their own position in the buffer and receives all events
 * from their join point onward. Enables real-time streaming of generator tool
 * preliminary results to multiple consumers simultaneously.
 */
// ---------------------------------------------------------------------------
// ToolEventBroadcaster
// ---------------------------------------------------------------------------
/**
 * A push-based event broadcaster that supports multiple concurrent consumers.
 *
 * @template T - The event type being broadcast
 */
export class ToolEventBroadcaster {
    buffer = [];
    consumers = new Map();
    nextConsumerId = 0;
    isComplete = false;
    completionError = null;
    /**
     * Push a new event to all consumers.
     * Events are buffered so late-joining consumers can catch up.
     */
    push(event) {
        if (this.isComplete) {
            return;
        }
        this.buffer.push(event);
        this.notifyWaitingConsumers();
    }
    /**
     * Mark the broadcaster as complete -- no more events will be pushed.
     * Optionally pass an error to signal failure to all consumers.
     * Cleans up buffer and consumers after completion.
     */
    complete(error) {
        this.isComplete = true;
        this.completionError = error ?? null;
        this.notifyWaitingConsumers();
        // Schedule cleanup after consumers have processed completion
        queueMicrotask(() => this.cleanup());
    }
    /**
     * Clean up resources after all consumers have finished.
     * Called automatically after complete(), but can be called manually.
     */
    cleanup() {
        // Only cleanup if complete and all consumers are done
        if (this.isComplete && this.consumers.size === 0) {
            this.buffer = [];
        }
    }
    /**
     * Create a new consumer that can independently iterate over events.
     * Consumers can join at any time and will receive events from position 0.
     * Multiple consumers can be created and will all receive the same events.
     */
    createConsumer() {
        const consumerId = this.nextConsumerId++;
        const state = {
            position: 0,
            waitingPromise: null,
            cancelled: false,
        };
        this.consumers.set(consumerId, state);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            async next() {
                const consumer = self.consumers.get(consumerId);
                if (!consumer) {
                    return { done: true, value: undefined };
                }
                if (consumer.cancelled) {
                    return { done: true, value: undefined };
                }
                // Return buffered event if available
                if (consumer.position < self.buffer.length) {
                    const value = self.buffer[consumer.position];
                    consumer.position++;
                    return { done: false, value };
                }
                // If complete and caught up, we're done
                if (self.isComplete) {
                    self.consumers.delete(consumerId);
                    self.cleanup();
                    if (self.completionError) {
                        throw self.completionError;
                    }
                    return { done: true, value: undefined };
                }
                // Set up waiting promise FIRST to avoid race condition
                const waitPromise = new Promise((resolve, reject) => {
                    consumer.waitingPromise = { resolve, reject };
                    // Immediately check if we should resolve after setting up promise
                    if (self.isComplete ||
                        self.completionError ||
                        consumer.position < self.buffer.length) {
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
                    self.cleanup();
                }
                return { done: true, value: undefined };
            },
            async throw(e) {
                const consumer = self.consumers.get(consumerId);
                if (consumer) {
                    consumer.cancelled = true;
                    self.consumers.delete(consumerId);
                    self.cleanup();
                }
                throw e;
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    }
    /**
     * Notify all waiting consumers that new data is available or stream completed
     */
    notifyWaitingConsumers() {
        for (const consumer of this.consumers.values()) {
            if (consumer.waitingPromise) {
                if (this.completionError) {
                    consumer.waitingPromise.reject(this.completionError);
                }
                else {
                    consumer.waitingPromise.resolve();
                }
                consumer.waitingPromise = null;
            }
        }
    }
}
//# sourceMappingURL=tool-event-broadcaster.js.map