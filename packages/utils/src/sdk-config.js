/**
 * Ported from OpenRouter SDK's config.ts with adaptations for DMR-X.
 *
 * SDK configuration: SDKOptions, serverURLFromOptions(), ServerList, SDK_METADATA.
 */
/** Simple path resolver (replaces OpenRouter SDK's pathToFunc from url.ts). */
function pathToFunc(basePath) {
    return (_params) => basePath;
}
// ---------------------------------------------------------------------------
// Server list
// ---------------------------------------------------------------------------
/**
 * Production server
 */
export const ServerProduction = "production";
/**
 * Contains the list of servers available to the SDK
 */
export const ServerList = {
    [ServerProduction]: "https://openrouter.ai/api/v1",
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function serverURLFromOptions(options) {
    let serverURL = options.serverURL;
    const params = {};
    if (!serverURL) {
        const server = options.server ?? ServerProduction;
        serverURL = ServerList[server] || "";
    }
    const u = pathToFunc(serverURL)(params);
    return new URL(u);
}
export const SDK_METADATA = {
    language: "typescript",
    openapiDocVersion: "1.0.0",
    sdkVersion: "0.12.77",
    genVersion: "2.884.4",
    userAgent: "speakeasy-sdk/typescript 0.12.77 2.884.4 1.0.0 @openrouter/sdk",
};
//# sourceMappingURL=sdk-config.js.map