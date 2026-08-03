import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.claude/**',
      '**/.gitnexus/**',
      '**/.openclaude/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/public/**',
      'scripts/dev/server-original.ts',
      'packages/core/src/types/stream.ts',
      'bun.lock',
      'bun.lockb',
      'jan-repo/**',
      'temp-clawrouter/**',
      'check-db.js',
      // Runtime-downloaded server payloads and virtualenv bundled code — not source
      '**/.dmrx-data/**',
      '**/.venv/**',
      '**/site-packages/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2023,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prefer-const': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      'no-constant-condition': 'off',
      'no-undef': 'off',
    },
  },
  // CLI tools use stdout by design — silence no-console
  {
    files: ['packages/cli/**'],
    rules: {
      'no-console': 'off',
    },
  },
];
