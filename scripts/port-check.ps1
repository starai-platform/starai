$ErrorActionPreference = "Stop"

$ports = @(5432, 6379, 9000, 9001, 3002, 8080, 3000, 3001)
foreach ($p in $ports) {
  $ok = (Test-NetConnection -ComputerName 127.0.0.1 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded
  Write-Output ("{0}`t{1}" -f $p, $ok)
}

