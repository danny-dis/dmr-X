import { randomBytes, createHash } from 'node:crypto';
export function generateId() {
    return randomBytes(16).toString('hex');
}
export function generateRequestId() {
    return `req_${generateId()}`;
}
export function generateApiKey() {
    return `dmr-${randomBytes(32).toString('hex')}`;
}
export function hashApiKey(key) {
    return createHash('sha256').update(key).digest('hex');
}
//# sourceMappingURL=crypto.js.map