/// <reference types="vite/client" />

/**
 * The env vars this game reads, declared so a typo is a type error rather than
 * a silent `undefined`.
 *
 * `vite/client` types `import.meta.env` with an index signature, so without
 * this every `import.meta.env.VITE_ANYTHING` is `any` and a misspelling reads
 * as "not configured" - which the Supabase client is designed to tolerate,
 * meaning the mistake never surfaces.
 *
 * Both are optional: absent is the normal, supported state.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
