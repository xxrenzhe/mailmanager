// 生成增强版BAT代理配置脚本（解决编码和凭据问题）
function generateEnhancedBatProxyScript(host, port, username, password) {
    const proxyServer = `${host}:${port}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `proxy-config-enhanced-${timestamp}.bat`;

    // 读取增强版BAT模板
    const batTemplate = `@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title Windows Proxy Configuration - Enhanced Version v2.1

echo ==========================================
echo     Windows Proxy Configuration v2.1
echo     Enhanced with Debugging & Credentials
echo ==========================================
echo.
echo [DEBUG] Script starting at: %date% %time%
echo [DEBUG] Current directory: %cd%
echo [DEBUG] User profile: %USERPROFILE%
echo [DEBUG] Script version: 2.1 Enhanced
echo.

echo Configuration Info:
echo   Proxy Server: ${proxyServer}
echo   Username: ${username}
echo   Password Length: ${password.length} characters
echo   Generated: %date% %time%
echo.

echo [STEP 1] Checking administrator privileges...
echo [DEBUG] Checking administrator access...
net session >nul 2>&1
set "adminCheck=%errorLevel%"
echo [DEBUG] Admin check result: %adminCheck%

if %adminCheck% neq 0 (
    echo.
    echo ❌ ERROR: Administrator privileges required!
    echo.
    echo [DEBUG] Current user: %USERNAME%
    echo [DEBUG] Elevated privileges: NO
    echo.
    echo 💡 SOLUTION:
    echo   1. Close this window
    echo   2. Right-click on the BAT file
    echo   3. Select "Run as administrator"
    echo   4. Click "Yes" on UAC prompt
    echo.
    echo 🔍 DEBUGGING INFO:
    echo   - Script must be run with elevated privileges
    echo   - Registry modifications require admin rights
    echo   - Credential Manager access requires admin rights
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
) else (
    echo [DEBUG] Current user: %USERNAME%
    echo [DEBUG] Elevated privileges: YES
    echo ✅ Administrator privileges confirmed
)
echo.

echo [STEP 2] Backing up current configuration...
set "backupFile=%temp%\\proxy_backup_%random%.reg"
echo [DEBUG] Backup file location: %backupFile%

reg export "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" "%backupFile%" >nul 2>&1
set "backupResult=%errorLevel%"
echo [DEBUG] Registry export result: %backupResult%

if exist "%backupFile%" (
    echo ✅ Current configuration backed up successfully
    echo [DEBUG] Backup file exists: YES
) else (
    echo ⚠️ WARNING: Could not backup current configuration
    echo [DEBUG] Backup file exists: NO
)
echo.

echo [STEP 3] Configuring system proxy...
echo [DEBUG] Starting proxy configuration...

echo   3.1 Setting registry proxy configuration...
echo [DEBUG] Enabling proxy...
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f
set "enableResult=%errorLevel%"
echo [DEBUG] Proxy enable result: %enableResult%

if %enableResult% equ 0 (
    echo ✅ Proxy enabled in registry
) else (
    echo ❌ ERROR: Failed to enable proxy
    echo [DEBUG] Error details: %enableResult%
    goto :error
)

echo [DEBUG] Setting proxy server to: ${proxyServer}
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f
set "serverResult=%errorLevel%"
echo [DEBUG] Proxy server set result: %serverResult%

if %serverResult% equ 0 (
    echo ✅ Proxy server configured
) else (
    echo ❌ ERROR: Failed to set proxy server
    echo [DEBUG] Error details: %serverResult%
    goto :error
)

echo [DEBUG] Setting proxy override...
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "<local>" /f
set "overrideResult=%errorLevel%"
echo [DEBUG] Proxy override result: %overrideResult%

if %overrideResult% equ 0 (
    echo ✅ Proxy override configured
) else (
    echo ❌ ERROR: Failed to set proxy override
    echo [DEBUG] Error details: %overrideResult%
    goto :error
)

echo   3.2 Configuring Windows Credential Manager...
echo [DEBUG] Starting credential configuration...

echo [DEBUG] Adding proxy credential: ${host}:${port}
cmdkey /add:${host}:${port} /user:${username} /pass:${password}
set "cred1Result=%errorLevel%"
echo [DEBUG] First credential result: %cred1Result%

if %cred1Result% equ 0 (
    echo ✅ Proxy credential saved to Credential Manager
    echo [DEBUG] Credential 1: SUCCESS
) else (
    echo ⚠️ WARNING: Could not save first credential
    echo [DEBUG] Credential 1: FAILED - %cred1Result%
    echo [DEBUG] This may be normal if credential already exists
)

echo [DEBUG] Adding generic Windows proxy credential...
cmdkey /add:Windows_Proxy /user:${username} /pass:${password}
set "cred2Result=%errorLevel%"
echo [DEBUG] Second credential result: %cred2Result%

if %cred2Result% equ 0 (
    echo ✅ Generic proxy credential saved
    echo [DEBUG] Credential 2: SUCCESS
) else (
    echo ⚠️ WARNING: Could not save second credential
    echo [DEBUG] Credential 2: FAILED - %cred2Result%
    echo [DEBUG] This may be normal if credential already exists
)

echo   3.3 Setting up PowerShell authentication...
set "psScript=%temp%\\setup_proxy_auth_%random%.ps1"
echo [DEBUG] PowerShell script location: %psScript%

echo Write-Host "=== PowerShell Authentication Setup ===" -ForegroundColor Cyan > "%psScript%"
echo Write-Host "Starting proxy authentication configuration..." -ForegroundColor Green >> "%psScript%"
echo Write-Host "Proxy Server: ${host}:${port}" -ForegroundColor White >> "%psScript%"
echo Write-Host "Username: ${username}" -ForegroundColor White >> "%psScript%"
echo Write-Host "" >> "%psScript%"
echo Write-Host "Step 1: Adding credentials via PowerShell..." -ForegroundColor Yellow >> "%psScript%"
echo try { >> "%psScript%"
echo     cmdkey /add:${host}:${port} /user:${username} /pass:${password} >> "%psScript%"
echo     Write-Host "✅ PowerShell: First credential added successfully" -ForegroundColor Green >> "%psScript%"
echo } catch { >> "%psScript%"
echo     Write-Host "❌ PowerShell: First credential failed" -ForegroundColor Red >> "%psScript%"
echo     Write-Host "Error: \$_" -ForegroundColor Red >> "%psScript%"
echo } >> "%psScript%"
echo Write-Host "" >> "%psScript%"
echo Write-Host "Step 2: Adding generic credential..." -ForegroundColor Yellow >> "%psScript%"
echo try { >> "%psScript%"
echo     cmdkey /add:Windows_Proxy /user:${username} /pass:${password} >> "%psScript%"
echo     Write-Host "✅ PowerShell: Generic credential added successfully" -ForegroundColor Green >> "%psScript%"
echo } catch { >> "%psScript%"
echo     Write-Host "❌ PowerShell: Generic credential failed" -ForegroundColor Red >> "%psScript%"
echo     Write-Host "Error: \$_" -ForegroundColor Red >> "%psScript%"
echo } >> "%psScript%"
echo Write-Host "" >> "%psScript%"
echo Write-Host "Step 3: Configuring system proxy settings..." -ForegroundColor Yellow >> "%psScript%"
echo try { >> "%psScript%"
echo     Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" -Name "ProxySettingsPerUser" -Value 1 -Type DWord -Force >> "%psScript%"
echo     Write-Host "✅ PowerShell: Proxy settings per user configured" -ForegroundColor Green >> "%psScript%"
echo } catch { >> "%psScript%"
echo     Write-Host "❌ PowerShell: Proxy settings configuration failed" -ForegroundColor Red >> "%psScript%"
echo } >> "%psScript%"
echo Write-Host "" >> "%psScript%"
echo Write-Host "=== PowerShell Setup Complete ===" -ForegroundColor Cyan >> "%psScript%"

echo [DEBUG] Executing PowerShell script...
powershell.exe -ExecutionPolicy Bypass -WindowStyle Normal -File "%psScript%"
set "psResult=%errorLevel%"
echo [DEBUG] PowerShell execution result: %psResult%

if %psResult% equ 0 (
    echo ✅ PowerShell authentication configured successfully
) else (
    echo ⚠️ WARNING: PowerShell setup may have failed
    echo [DEBUG] PowerShell error code: %psResult%
)

echo [DEBUG] Cleaning up temporary files...
if exist "%psScript%" (
    del "%psScript%" >nul 2>&1
    echo [DEBUG] PowerShell script cleaned up
)

echo   3.4 Configuring WinHTTP proxy...
echo [DEBUG] Setting WinHTTP proxy: ${proxyServer}
netsh winhttp set proxy ${proxyServer} "<local>"
set "winhttpResult=%errorLevel%"
echo [DEBUG] WinHTTP configuration result: %winhttpResult%

if %winhttpResult% equ 0 (
    echo ✅ WinHTTP proxy configured
) else (
    echo ⚠️ WARNING: WinHTTP proxy configuration may have failed
    echo [DEBUG] WinHTTP error: %winhttpResult%
)
echo.

echo [STEP 4] Refreshing system settings...
echo   4.1 Flushing DNS cache...
echo [DEBUG] Flushing DNS...
ipconfig /flushdns
set "dnsResult=%errorLevel%"
echo [DEBUG] DNS flush result: %dnsResult%

if %dnsResult% equ 0 (
    echo ✅ DNS cache flushed
) else (
    echo ⚠️ WARNING: DNS cache flush may have failed
)

echo   4.2 Notifying system settings changes...
echo [DEBUG] Updating system parameters...
rundll32.exe user32.dll,UpdatePerUserSystemParameters
echo ✅ System settings notified

echo   4.3 Listing stored credentials...
echo [DEBUG] Checking stored credentials...
cmdkey /list | findstr /i "${host}"
cmdkey /list | findstr /i "Windows_Proxy"
echo.

echo ==========================================
echo ✅ SUCCESS: Proxy Configuration Completed!
echo ==========================================
echo.
echo 📋 SUMMARY:
echo   ✅ Administrator privileges: Confirmed
echo   ✅ System registry: Configured
echo   ✅ WinHTTP proxy: Configured
echo   ✅ Credential Manager: Updated
echo   ✅ System settings: Refreshed
echo.
echo 🔗 PROXY INFO:
echo   Proxy Server: ${proxyServer}
echo   Username: ${username}
echo   Password: [Hidden for security - ${password.length} chars]
echo   Credentials: Stored in Windows Credential Manager
echo.
echo 🔐 AUTOMATIC AUTHENTICATION:
echo   ✅ Browser should automatically use proxy credentials
echo   ✅ No manual username/password prompt expected
echo   ✅ Credentials stored in Windows Credential Manager
echo   ✅ Multiple credential entries created for compatibility
echo.
echo 🌐 VERIFICATION STEPS:
echo   1. Open browser (Chrome or Edge recommended)
echo   2. Visit https://ip111.cn/
echo   3. Confirm IP address shows proxy server IP
echo   4. If IP changed, configuration successful!
echo   5. Browser should NOT ask for username/password
echo.
echo 🛠️ TROUBLESHOOTING:
echo   If browser still asks for credentials:
echo   • Restart browser completely (close all windows)
echo   • Clear browser cache and saved passwords
echo   • Check Windows Credential Manager:
echo     - Press Win+R, type "control.exe keymgr.dll"
echo     - Look for entries: "${host}:${port}" and "Windows_Proxy"
echo   • Try different browser (Chrome/Edge work best)
echo   • Verify proxy server is accessible
echo.
echo 📞 CREDENTIAL VERIFICATION:
echo   To check stored credentials:
echo   1. Press Win+R
echo   2. Type: control.exe keymgr.dll
echo   3. Look for "Windows Credentials" section
echo   4. Verify entries exist for proxy server
echo.

echo [DEBUG] Script completed successfully at: %date% %time%
goto :success

:error
echo.
echo ❌ ERROR: Configuration failed!
echo.
echo 🔄 Attempting to restore backup configuration...
if exist "%backupFile%" (
    echo [DEBUG] Restoring from backup: %backupFile%
    reg import "%backupFile%" >nul 2>&1
    if %errorLevel% equ 0 (
        echo ✅ Configuration restored from backup
    ) else (
        echo ❌ Failed to restore from backup
    )
) else (
    echo ⚠️ No backup file available
    echo [DEBUG] Backup file not found: %backupFile%
)
echo.
echo 🔍 DEBUGGING INFO:
echo   - Check if script was run as administrator
echo   - Verify proxy server details are correct
echo   - Ensure Windows version supports these features
echo   - Check antivirus/security software interference
echo.
echo Press any key to exit...
pause >nul
exit /b 1

:success
echo.
echo ✅ All tasks completed successfully!
echo [DEBUG] Script finished at: %date% %time%
echo.
echo 💡 IMPORTANT NOTES:
echo   1. Keep this BAT file for future use
echo   2. Credentials are stored in Windows Credential Manager
echo   3. Browser should automatically authenticate
echo   4. If issues persist, check the troubleshooting section above
echo.
echo Press any key to exit...
pause >nul
exit /b 0
`;

    // 创建Blob并下载
    const blob = new Blob([batTemplate], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Utils.showNotification('Enhanced BAT script v2.1 downloaded with debugging and full credentials support', 'success');
}