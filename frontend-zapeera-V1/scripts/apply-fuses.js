/**
 * Electron fuses — applied by electron-builder's afterPack hook
 * (see "afterPack" in electron-builder.json).
 *
 * Security hardening (2026-10-23). Fuses are baked into the Electron binary
 * at packaging time and cannot be changed by editing app files afterwards,
 * which raises the cost of turning a shipped install into a "re-scriptable"
 * build. Fuse choices are deliberately limited to what cannot break
 * legitimate users of THIS app:
 *
 *  - RunAsNode = false: nothing in the app or build scripts uses
 *    ELECTRON_RUN_AS_NODE (verified by grep 2026-10-23). The local backend
 *    is spawned as `electron <script>` (app mode), which this fuse does
 *    NOT affect.
 *  - EnableNodeOptionsEnvironmentVariable = false: NODE_OPTIONS can no
 *    longer inject code into the app process. Nothing uses NODE_OPTIONS.
 *  - EnableNodeCliInspectArguments = false: --inspect / --debug cannot
 *    attach a debugger to shipped builds.
 *  - EnableCookieEncryption = true: Chromium cookie store is encrypted at
 *    rest with the OS key store (DPAPI/Keychain/libsecret).
 *
 *  Deliberately NOT enabled (would break this app today):
 *  - OnlyLoadAppFromAsar: the main process spawns the bundled backend from
 *    resources/zapeera-backend/dist/server.js, i.e. app code loaded from
 *    OUTSIDE the ASAR. Enabling this fuse stops that spawn.
 *  - EnableEmbeddedAsarIntegrityValidation: electron-builder 24 does not
 *    embed the ASAR header hash this fuse validates against, and the
 *    pinned Electron (28.x) predates the supported tooling path. Revisit
 *    after the planned electron-builder/Electron upgrade.
 */
const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function applyFuses(context) {
  const { appOutDir, electronPlatformName } = context;
  const candidates =
    electronPlatformName === 'win32'
      ? [path.join(appOutDir, 'Zapeera.exe')]
      : electronPlatformName === 'darwin'
        ? [path.join(appOutDir, 'Zapeera.app', 'Contents', 'MacOS', 'Zapeera')]
        : [path.join(appOutDir, 'zapeera'), path.join(appOutDir, 'Zapeera')];
  const electronBinary = candidates.find((p) => fs.existsSync(p));
  if (!electronBinary) {
    // Fail the build loudly rather than shipping an un-fused binary.
    throw new Error(`[fuses] Electron binary not found in ${appOutDir} (tried: ${candidates.join(', ')})`);
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    // Explicitly left at their defaults — see header comment.
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false
  });
  console.log('[fuses] Applied hardening fuses to', electronBinary);
};
