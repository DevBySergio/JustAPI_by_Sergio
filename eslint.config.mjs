import typescriptEslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'webview-ui/src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
    },
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'block-spacing': ['error', 'always'],
      '@typescript-eslint/naming-convention': ['error', {
        selector: 'import',
        format: ['camelCase', 'PascalCase'],
      }],
      curly: ['error', 'all'],
      eqeqeq: 'error',
      'no-throw-literal': 'error',
      semi: 'error',
    },
  },
];
