import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Global: report unused eslint-disable comments (ratchet hygiene)
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // Not in scope — suppress to focus on planned rules
      'preserve-caught-error': 'off',
    },
  },

  // src/** — strict
  {
    files: ['**/src/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'complexity': ['error', { max: 12 }],
      'max-depth': ['error', { max: 3 }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // test/** — relaxed
  {
    files: ['**/test/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'complexity': 'off',
      'max-depth': ['warn', { max: 6 }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
)
