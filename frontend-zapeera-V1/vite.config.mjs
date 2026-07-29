import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Works in both ESM and CJS environments
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default ({ mode } = {}) => {
  // CRITICAL: Detect if building for Electron or web
  const isElectron = 
    (process.env.ELECTRON === 'true' || process.env.VITE_ELECTRON === 'true') ||
    (process.env.ELECTRON !== 'false' && process.env.npm_lifecycle_event?.includes('electron')) ||
    mode === 'electron';

  // Build target: web, desktop, backoffice
  const appTarget = process.env.VITE_APP_TARGET || (isElectron ? 'desktop' : 'web');
  
  // For web production, use absolute paths; for Electron, use relative paths
  const basePath = isElectron ? './' : '/';
  
  console.log(`Building for: ${isElectron ? 'Electron' : 'Web'} | Target: ${appTarget} | Base: ${basePath}`);
  
  return {
    server: {
      host: "::",
      port: 4100,
      proxy: {
        '/api': {
          target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:4200',
          changeOrigin: true,
          secure: false,
          ws: false,
        },
      },
    },
    resolve: {
      alias: [
        {
          find: "@",
          replacement: resolve(__dirname, "./src"),
        },
      ],
      extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
      // Ensure proper module resolution for production builds
      dedupe: ["react", "react-dom"],
    },
    // CRITICAL: Use relative paths for Electron, absolute paths for web production
    base: basePath,
    build: {
      // Use esbuild for fast, reliable minification (handles circular deps gracefully)
      minify: 'esbuild',
      rollupOptions: {
        output: {
          // CRITICAL FIX: Disable manual chunking to avoid circular dependency issues
          // Keep everything in main bundle to ensure proper initialization order
          manualChunks: undefined,
          // Ensure proper module ordering
          preserveModules: false,
          // CRITICAL: Ensure proper file extensions for module scripts
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash].[ext]",
        },
        // Preserve module order
        preserveEntrySignatures: "strict",
      },
      // Optimize for production
      sourcemap: mode === "development",
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 2000, // Increased to avoid warnings
      outDir: "dist",
      emptyOutDir: true,
      // CommonJS compatibility
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
      // CRITICAL: Ensure proper MIME types for production
      assetsDir: "assets",
      // CRITICAL: Ensure module scripts are properly formatted
      target: "esnext",
      modulePreload: {
        polyfill: true,
      },
    },
    // Environment-specific configuration
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __VITE_APP_TARGET__: JSON.stringify(appTarget),
      // Note: __BACKOFFICE_MARKER__ is NOT defined here.
      // It's handled by the backoffice-lazy-replace plugin below.
    },
    plugins: [
      // Custom plugin: replaces __BACKOFFICE_MARKER__ with the correct expression.
      // Runs as a normal plugin (no enforce). Vite's define is applied via
      // @rollup/plugin-replace with enforce:'post', so our transform runs FIRST.
      {
        name: 'backoffice-lazy-replace',
        transform(code, id) {
          if (!code.includes('__BACKOFFICE_MARKER__')) return;
          if (!id.endsWith('.tsx') && !id.endsWith('.ts') && !id.endsWith('.jsx') && !id.endsWith('.js')) return;
          const markerLine = 'const BackofficeRouterLazy = __BACKOFFICE_MARKER__;';
          const replacement = appTarget === 'desktop'
            ? 'const BackofficeRouterLazy = null;'
            : 'const BackofficeRouterLazy = React.lazy(() => import("./backoffice/BackofficeRouter").then(m => ({ default: m.BackofficeRouter })));';
          return code.replace(markerLine, replacement);
        }
      },
      react(),
    ].filter(Boolean),
  };
};
