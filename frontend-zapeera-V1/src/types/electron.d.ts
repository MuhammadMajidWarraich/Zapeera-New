/**
 * Type declarations for Electron API exposed via preload script
 */

interface SaveFileOptions {
  content: string;
  filename: string;
  type: 'html' | 'pdf' | 'csv' | 'json' | string;
}

interface SaveFileResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

interface ElectronAPI {
  platform?: string;
  isFreshDatabase?: boolean | (() => Promise<boolean>);
  isPackaged?: boolean;
  getAppVersion: () => Promise<string>;
  getBackendStatus: () => Promise<{
    running: boolean;
    port: number;
    databasePath: string;
    databaseType: string;
  }>;
  getLogFilePath: () => Promise<string>;
  getStorageInfo: () => Promise<{
    appDataDir: string;
    dataDir: string;
    logDir: string;
    databasePath: string;
    persistent: boolean;
  }>;
  openExternal: (url: string) => Promise<{ success: boolean }>;
  getPlatform: () => Promise<string>;
  isPackaged: () => Promise<boolean>;
  sendMessage: (message: string) => void;
  onMessage: (callback: (event: any, ...args: any[]) => void) => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  getWindowState: () => Promise<any>;
  setWindowState: (state: any) => void;
  saveFile: (options: SaveFileOptions) => Promise<SaveFileResult>;
  getDownloadsPath: () => Promise<string>;
}

interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

interface NodeAPI {
  getCwd: () => string;
  getEnv: (key: string) => string | undefined;
  getProcessInfo: () => {
    platform: string;
    arch: string;
    version: string;
    nodeVersion: string;
    chromeVersion: string;
    electronVersion: string;
  };
}

interface AppInfo {
  name: string;
  description: string;
  storageInfo: {
    type: string;
    location: string;
    persistent: boolean;
    note: string;
  };
  offline: {
    supported: boolean;
    syncReady: boolean;
    note: string;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    windowControls?: WindowControls;
    nodeAPI?: NodeAPI;
    appInfo?: AppInfo;
  }
}

export {};
