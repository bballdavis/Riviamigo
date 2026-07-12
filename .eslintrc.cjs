module.exports = {
  root: true,
  extends: [require.resolve('./packages/config/eslint/react.js')],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'off',
    'react/no-unescaped-entities': 'off',
    'react-hooks/exhaustive-deps': 'off',
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: [
    '**/dist/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/.turbo/**',
  ],
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/*.stories.tsx', '**/mockPrimitives.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'react/display-name': 'off',
        'react/jsx-key': 'off',
      },
    },
    {
      files: ['packages/ui/src/tables/tripColumns.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
