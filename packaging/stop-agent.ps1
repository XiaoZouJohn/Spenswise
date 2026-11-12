$ErrorActionPreference = 'Stop'
$launcherPath = Join-Path $PSScriptRoot 'run_agent.py'
$escapedLauncher = [regex]::Escape($launcherPath)
$launcherToken = '(?:^|\s)(?:"' + $escapedLauncher + '"|' + $escapedLauncher + ')(?:\s|$)'
# Match only Python processes launched with this exact absolute script argument.
# Both the virtualenv launcher and its Python child may have the same argument.
$agentProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $launcherToken
})
foreach ($agentProcess in $agentProcesses) {
    Stop-Process -Id $agentProcess.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host ('Stopped ' + $agentProcesses.Count + ' matching SpendWise Agent processes. Saved data was not removed.')
