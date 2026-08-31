import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

// One config, at the root, covering every workspace. `the-student-experience`
// is a single package so its own config is necessarily root-level, and there is
// no per-workspace shape to mirror. There is also no mechanism to mirror it
// with: ESLint flat config has no equivalent of the `--workspaces --if-present`
// fan-out the `check` / `test` / `build` scripts use, so four copies would have
// nothing keeping them in step. Same reasoning as the single Dependabot entry.
const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Underscore-prefixed args/vars are the standard "intentionally
			// unused" marker (drop-in API-symmetric callbacks, type shims).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_'
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				// `projectService: true`, as the reference has it. It was very
				// nearly left out: every tsconfig.json here is solution-style
				// (`files: []` + `references`), which is the classic way to make
				// the project service resolve to a config containing no files,
				// and the prediction was that it would fail outright. IT DOES NOT
				// - the service follows the references. Measured on the whole
				// repo: 1.5s with, 1.1s without, and the CI cache absorbs that.
				//
				// Nothing here needs it *yet*. The reference turns it on for
				// `svelte/no-navigation-without-resolve`, a SvelteKit-router rule
				// with no counterpart in either of these apps. It is on anyway so
				// that the first type-aware rule anyone reaches for works instead
				// of erroring, which is the failure this comment used to predict.
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// Three Maps that are not reactive state, and must not become it.
		//
		// SkillTreeScreen's `ALL_PIPS` / `CHILDREN_OF` are built once at module
		// init from the static skill tree and then only read - the one `.set()`
		// is inside the construction loop.
		//
		// GameCanvas's `flashUntil` is animation state, which CLAUDE.md requires
		// to live in `render/` and never on game state. Nothing reactive reads
		// it; the canvas draw path does, under rAF. A SvelteMap would invalidate
		// on every frame's expiry sweep for no subscriber at all.
		files: [
			'games/math-blaster/src/lib/render/GameCanvas.svelte',
			'games/math-blaster/src/lib/skills/SkillTreeScreen.svelte'
		],
		rules: {
			'svelte/prefer-svelte-reactivity': 'off'
		}
	}
);
