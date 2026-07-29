# Building Zapeera Installer

## Important: Building Installer (Not Portable EXE)

To build a **proper installer** that shows installation wizard:

```bash
cd frontend-zapeera-V1
npm run electron:dist:win
```

This will create:
- **Installer EXE**: `C:\Users\Admin\Desktop\Zapeera-Build\Zapeera Setup 1.0.0.exe`
- This is an **NSIS installer** that shows installation wizard
- User can choose installation directory
- Creates desktop and start menu shortcuts
- Installs software properly on the system

## What Happens During Installation:

1. **Installation Wizard** appears (not direct run)
2. User can choose installation directory
3. Software is installed to Program Files (or chosen directory)
4. Desktop and Start Menu shortcuts are created
5. SQLite database will **auto-create on first run** in user's AppData folder

## Database Location:

- **Path**: `%USERPROFILE%\.zapeera\data\zapeera.db`
- **Auto-created**: On first app launch (after installation)
- **User-specific**: Each Windows user has their own database

## After Installation:

1. User launches Zapeera from desktop shortcut or Start Menu
2. App starts and automatically creates SQLite database
3. Database is initialized with all required tables
4. App is ready to use

## Troubleshooting:

If you get a **portable EXE** (runs directly):
- Make sure you're using: `npm run electron:dist:win`
- NOT: `npm run electron:dist:win:exe` (this builds portable)
- Check `electron-builder.json` has `"target": "nsis"` (not "portable")

## Build Output:

After successful build, you'll find:
- **Installer**: `Zapeera Setup 1.0.0.exe` (this is the installer)
- **Unpacked**: `win-unpacked\` folder (for testing, not for distribution)

**Distribute the installer EXE, not the unpacked folder!**

