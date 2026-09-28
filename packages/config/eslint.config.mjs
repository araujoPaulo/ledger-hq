import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': 'error',
    },
  },
  { files: ['**/scripts/**'], rules: { 'no-console': 'off' } },
  {
    files: ['src/**/*.tsx'],
    plugins: { i18next: (await import('eslint-plugin-i18next')).default },
    rules: { 'i18next/no-literal-string': ['error', { markupOnly: true }] },
  },
  // The rule exists to stop user-visible copy being hardcoded. A component
  // test has to render literal children to have anything to assert on, and
  // none of it ships.
  { files: ['src/**/*.test.tsx'], rules: { 'i18next/no-literal-string': 'off' } },
  { ignores: ['dist/**', 'node_modules/**', '**/*.config.js'] },
)
