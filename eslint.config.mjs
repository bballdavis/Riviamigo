import eslint from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const typedFiles = ['**/*.{ts,tsx}'];
const testFiles = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.stories.tsx',
  '**/mockPrimitives.tsx',
];

export default [
  {
    ignores: [
      '**/.docusaurus/**',
      '**/.turbo/**',
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: typedFiles,
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@eslint-react': eslintReact,
      '@typescript-eslint': typescriptPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@eslint-react/no-missing-key': 'error',
      'no-constant-condition': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'log', 'group', 'groupEnd'] }],
      'no-undef': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: testFiles,
    rules: {
      '@eslint-react/no-missing-key': 'off',
      '@eslint-react/no-missing-component-display-name': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['packages/ui/src/tables/tripColumns.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
