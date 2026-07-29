$filePath = 'electron\embedded-server.js'
$content = Get-Content $filePath -Raw

# Find the start of duplicate routes (MANUFACTURERS section)
$manufacturersStart = $content.IndexOf('  // ==================== MANUFACTURERS ====================')
# Find the actual ROUTES REGISTRATION section
$routesRegistration = $content.IndexOf('  // ==================== ROUTES REGISTRATION ====================')

if ($manufacturersStart -gt 0 -and $routesRegistration -gt $manufacturersStart) {
    # Get content before duplicate routes
    $before = $content.Substring(0, $manufacturersStart).TrimEnd()
    # Get content after ROUTES REGISTRATION comment
    $after = $content.Substring($routesRegistration)
    
    # Combine: before + ROUTES REGISTRATION section
    $newContent = $before + "`n`n" + $after
    
    $newContent | Set-Content $filePath -NoNewline
    Write-Host "Successfully removed duplicate routes (lines $manufacturersStart to $routesRegistration)"
} else {
    Write-Host "Could not find route boundaries. Manufacturers start: $manufacturersStart, Routes registration: $routesRegistration"
}

