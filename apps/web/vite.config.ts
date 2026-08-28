import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/tesseract.js/dist/worker.min.js",
          dest: "ocr",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/tesseract.js-core/tesseract-core*",
          dest: "ocr/core",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
          dest: "ocr/lang",
          rename: { stripBase: true },
        },
      ],
    }),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Scanme — Local barcode reader",
        short_name: "Scanme",
        description: "Find every readable barcode in a screenshot, privately and offline.",
        theme_color: "#17352b",
        background_color: "#f5f4ee",
        display: "standalone",
        start_url: "/",
        scope: "/",
        categories: ["utilities", "productivity"],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,wasm}"],
        globIgnores: ["ocr/**"],
        navigateFallbackDenylist: [/^\/reports(?:\/|$)/, /^\/api\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/ocr\//,
            handler: "CacheFirst",
            options: {
              cacheName: "scanme-ocr-v1",
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      pwaAssets: { disabled: false, config: true },
      devOptions: { enabled: true },
    }),
  ],
});
