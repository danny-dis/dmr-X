/**
 * Type guards for OpenAI Responses API stream events and output items.
 * Ported from OpenRouter SDK's stream-type-guards.ts with adaptations for DMR-X.
 *
 * These type guards discriminate the union types that appear in SSE stream events
 * from the Responses API, enabling type-safe narrowing in stream transformers.
 */
// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------
function hasType(value) {
    return typeof value === 'object' && value !== null && 'type' in value;
}
// ---------------------------------------------------------------------------
// Event type guards
// ---------------------------------------------------------------------------
export function isOutputTextDeltaEvent(event) {
    return hasType(event) && event.type === 'response.output_text.delta';
}
export function isReasoningDeltaEvent(event) {
    return hasType(event) && event.type === 'response.reasoning_text.delta';
}
export function isFunctionCallArgumentsDeltaEvent(event) {
    return hasType(event) && event.type === 'response.function_call_arguments.delta';
}
export function isFunctionCallArgumentsDoneEvent(event) {
    return hasType(event) && event.type === 'response.function_call_arguments.done';
}
export function isOutputItemAddedEvent(event) {
    return hasType(event) && event.type === 'response.output_item.added';
}
export function isOutputItemDoneEvent(event) {
    return hasType(event) && event.type === 'response.output_item.done';
}
export function isResponseCompletedEvent(event) {
    return hasType(event) && event.type === 'response.completed';
}
export function isResponseFailedEvent(event) {
    return hasType(event) && event.type === 'response.failed';
}
export function isResponseIncompleteEvent(event) {
    return hasType(event) && event.type === 'response.incomplete';
}
// ---------------------------------------------------------------------------
// Output item type guards
// ---------------------------------------------------------------------------
export function isOutputMessage(item) {
    return hasType(item) && item.type === 'message';
}
export function isFunctionCallItem(item) {
    return hasType(item) && item.type === 'function_call';
}
export function isReasoningOutputItem(item) {
    return hasType(item) && item.type === 'reasoning';
}
export function isWebSearchCallOutputItem(item) {
    return hasType(item) && item.type === 'web_search_call';
}
export function isFileSearchCallOutputItem(item) {
    return hasType(item) && item.type === 'file_search_call';
}
export function isImageGenerationCallOutputItem(item) {
    return hasType(item) && item.type === 'image_generation_call';
}
// ---------------------------------------------------------------------------
// Content part type guards
// ---------------------------------------------------------------------------
export function isOutputTextPart(part) {
    return hasType(part) && part.type === 'output_text';
}
export function isRefusalPart(part) {
    return hasType(part) && part.type === 'refusal';
}
// ---------------------------------------------------------------------------
// Annotation type guards
// ---------------------------------------------------------------------------
export function isFileCitationAnnotation(annotation) {
    return hasType(annotation) && annotation.type === 'file_citation';
}
export function isURLCitationAnnotation(annotation) {
    return hasType(annotation) && annotation.type === 'url_citation';
}
export function isFilePathAnnotation(annotation) {
    return hasType(annotation) && annotation.type === 'file_path';
}
//# sourceMappingURL=stream-type-guards.js.map