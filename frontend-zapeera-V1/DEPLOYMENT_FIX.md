# Production Deployment Fix - MIME Type Error

## Problem
The error "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of 'text/html'" occurs when:
1. The server returns HTML (index.html) instead of JavaScript files
2. This usually happens when SPA routing fallback is too aggressive

## Solution

### 1. Build Configuration (Already Fixed)
The `vite.config.ts` now:
- Uses absolute paths (`/`) for web production
- Uses relative paths (`./`) for Electron builds
- Properly detects build target

### 2. Server Configuration (REQUIRED)

#### For Nginx:
Copy `nginx.conf.example` to your server and update:
- `server_name` to your domain
- `root` to your dist folder path

Key points:
- `.js` files must return `Content-Type: application/javascript`
- `.js` files that don't exist should return 404, NOT index.html
- Only non-file routes should serve index.html

#### For Apache (.htaccess):
```apache
# Set proper MIME types
<IfModule mod_mime.c>
    AddType application/javascript .js
    AddType application/json .json
</IfModule>

# Don't serve index.html for missing .js files
<FilesMatch "\.js$">
    ErrorDocument 404 "File not found"
</FilesMatch>

# SPA routing - serve index.html for non-file routes
RewriteEngine On
RewriteBase /
RewriteRule ^index\.html$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

### 3. Verify Build Output
After building, check `dist/index.html`:
- Script tags should have absolute paths starting with `/assets/`
- NOT relative paths like `./assets/`

### 4. share-modal.js Error - FIXED
**Solution Implemented:**
- Created safe `share-modal.js` in `public/` folder with comprehensive null checks
- Script only runs when share modal exists on the page
- All DOM access is null-checked to prevent "Cannot read properties of null" errors
- Script waits for DOM ready before executing
- Added to `index.html` with proper `type="text/javascript"` and `defer` attribute

**Key Features:**
- ✅ Null checks before every `addEventListener` call
- ✅ DOM ready check before initialization
- ✅ Silent exit if modal doesn't exist (no errors)
- ✅ Error handling prevents script from breaking the page
- ✅ Served as static asset from `public/` folder (copied to `dist/` root)

**Server Configuration:**
The nginx config ensures `/share-modal.js` is served with `Content-Type: application/javascript`

## Testing
1. Build: `npm run build:prod`
2. Check `dist/index.html` - paths should be absolute
3. Deploy to server
4. Check browser console - should see no MIME type errors
5. Verify all assets load correctly

## Quick Fix Command
```bash
# Rebuild with correct configuration
npm run build:prod

# Verify paths in dist/index.html
grep -r "src=" dist/index.html
```

