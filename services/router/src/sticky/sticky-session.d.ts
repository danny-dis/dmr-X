export interface StickySession {
    providerId: string;
    modelId: string;
}
/**
 * Hash a conversation's first user message to create a stable session key.
 */
export declare function hashConversation(messages: Array<{
    role: string;
    content: string | any;
}>): string | null;
/**
 * Get the sticky provider for a conversation hash.
 */
export declare function getStickyProvider(conversationHash: string): Promise<StickySession | null>;
/**
 * Set a sticky provider for a conversation hash.
 */
export declare function setStickyProvider(conversationHash: string, providerId: string, modelId: string, ttlSeconds?: number): Promise<void>;
//# sourceMappingURL=sticky-session.d.ts.map