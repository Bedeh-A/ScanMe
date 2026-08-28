/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_POSTHOG_KEY?: string;
  readonly VITE_PUBLIC_POSTHOG_HOST?: string;
  readonly VITE_PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
