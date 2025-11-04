# Microsoft Edge 专用代理配置脚本 - 精简版
param(
    [Parameter(Mandatory=$true)][string]$ProxyHost,
    [Parameter(Mandatory=$true)][string]$ProxyPort,
    [Parameter(Mandatory=$true)][string]$ProxyUser,
    [Parameter(Mandatory=$true)][string]$ProxyPass
)

# 简化的Edge代理配置函数
function Set-EdgeProxy {
    param([string]$Server)
    try {
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -Name "ProxyEnable" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -Name "ProxyServer" -Value $Server -Type String -Force
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Edge\ProxyServer" -Name "ProxyEnable" -Value 1 -Type DWord -Force
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Edge\ProxyServer" -Name "ProxyServer" -Value $Server -Type String -Force
        return $true
    } catch {
        return $false
    }
}

# 设置凭据
function Set-ProxyCredentials {
    param([string]$Host, [string]$Port, [string]$User, [string]$Pass)
    try {
        $targets = @("$Host", "Windows_Proxy", "Microsoft_Edge_Proxy")
        foreach ($target in $targets) {
            cmdkey /add:$target /user:$User /pass:$Pass | Out-Null
        }
        return $true
    } catch {
        return $false
    }
}

# 启动Edge
function Start-EdgeBrowser {
    try {
        Start-Process msedge "https://ip111.cn" -WindowStyle Maximized
        return $true
    } catch {
        return $false
    }
}

# 主执行逻辑
$proxyServer = "$ProxyHost:$Port"
Set-EdgeProxy -Server $proxyServer
Set-ProxyCredentials -Host $ProxyHost -Port $ProxyPort -User $ProxyUser -Pass $ProxyPass
Start-EdgeBrowser

Write-Host "Edge代理配置完成！" -ForegroundColor Green