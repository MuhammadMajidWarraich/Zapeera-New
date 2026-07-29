$filePath = 'electron\embedded-server.js'
$lines = Get-Content $filePath

# Find the line with "ROUTES REGISTRATION" comment (the real one, not the fake one)
$routesRegIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '  // ==================== ROUTES REGISTRATION ====================' -and $lines[$i+1] -match 'Import and register') {
        $routesRegIndex = $i
        break
    }
}

# Find where duplicate routes start (after the fake comment)
$duplicateStart = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'These routes are now handled by separate route files') {
        $duplicateStart = $i + 1
        break
    }
}

if ($routesRegIndex -gt 0 -and $duplicateStart -gt 0 -and $routesRegIndex -gt $duplicateStart) {
    # Keep everything before duplicate routes, then jump to real ROUTES REGISTRATION
    $newLines = $lines[0..($duplicateStart-1)] + $lines[$routesRegIndex..($lines.Count-1)]
    $newLines | Set-Content $filePath
    Write-Host "Removed duplicate routes from line $duplicateStart to $($routesRegIndex-1)"
} else {
    Write-Host "Could not find boundaries. Duplicate start: $duplicateStart, Routes reg: $routesRegIndex"
}

