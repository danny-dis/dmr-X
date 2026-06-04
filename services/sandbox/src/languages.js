export const SUPPORTED_LANGUAGES = {
    python: { name: 'Python', extension: '.py', command: 'python3' },
    node: { name: 'Node.js', extension: '.js', command: 'node' },
    javascript: { name: 'JavaScript', extension: '.js', command: 'node' },
    bash: { name: 'Bash', extension: '.sh', command: 'bash' },
    sh: { name: 'Shell', extension: '.sh', command: 'sh' },
    deno: { name: 'Deno', extension: '.ts', command: 'deno' },
    bun: { name: 'Bun', extension: '.ts', command: 'bun' },
};
export function isLanguageSupported(language) {
    return language in SUPPORTED_LANGUAGES;
}
export function getLanguageInfo(language) {
    return SUPPORTED_LANGUAGES[language] || null;
}
//# sourceMappingURL=languages.js.map