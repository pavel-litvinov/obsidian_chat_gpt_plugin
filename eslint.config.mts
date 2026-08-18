import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'.codex-plugin',
		'node_modules',
		'esbuild.config.mjs',
		'main.js',
		'manifest.json',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'versions.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/settings.ts'],
		rules: {
			// display() is the fallback for 1.4.4–1.12.x; 1.13+ uses getSettingDefinitions().
			'@typescript-eslint/no-deprecated': 'off',
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
);
