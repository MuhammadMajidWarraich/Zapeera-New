# Hard-coded Values Analysis Report

## Critical Issues Found

### 1. API Base URLs (HIGH PRIORITY)
- **Value:** `http://127.0.0.1:4200/api/backoffice`
- **Files:** 12 backoffice files
- **Fix:** Use centralized config constant

### 2. Support Phone Number (HIGH PRIORITY)
- **Value:** `+923107100663`
- **Files:** LoginForm, AccountDeactivationModal, ZapeeraLayout, ZapeeraDashboard
- **Fix:** Move to environment variable

### 3. Support Email (HIGH PRIORITY)
- **Value:** `support@zapeera.com`
- **Files:** Multiple components
- **Fix:** Move to environment variable

### 4. Company URLs (MEDIUM PRIORITY)
- **Value:** `https://zapeera.com/contact`, `https://api.zapeera.com`
- **Files:** config, AuthContext, layouts
- **Fix:** Move to environment variable

### 5. Configuration Values (MEDIUM PRIORITY)
- **Values:** Timeouts (60000, 3000, 2000), Page sizes (10, 100, 200), Retry counts (3)
- **Files:** api.ts, various components
- **Fix:** Centralize in config

### 6. Mock Data (LOW PRIORITY)
- **Values:** Tax number placeholder `1234567890123`, mock emails
- **Files:** Settings.tsx, BackofficeUsers.tsx
- **Fix:** Keep as placeholders (acceptable)
