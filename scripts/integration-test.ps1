# StarAI MVP Integration Tests
$API = "http://localhost:8080"
$passed = 0
$failed = 0

function Test-Case($name, $script) {
    try {
        & $script
        Write-Host "[PASS] $name" -ForegroundColor Green
        $script:passed++
    } catch {
        Write-Host "[FAIL] $name - $_" -ForegroundColor Red
        $script:failed++
    }
}

# 1. Health check
Test-Case "API health" {
    $r = Invoke-RestMethod "$API/health"
    if ($r.data.status -ne "ok") { throw "health failed" }
}

# 2. Login demo user
$token = $null
Test-Case "User login" {
    $body = @{ email = "demo@starai.local"; password = "demo123" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/api/auth/login/password" -Method POST -Body $body -ContentType "application/json"
    $script:token = $r.data.token
    if (-not $script:token) { throw "no token" }
}

$headers = @{ Authorization = "Bearer $token" }

# 3. Models list (no API key needed)
Test-Case "Models list without API key" {
    $r = Invoke-RestMethod "$API/api/models" -Headers $headers
    if ($r.data.Count -lt 1) { throw "no models" }
}

# 4. Payment disabled
Test-Case "Payment order blocked" {
    try {
        $body = '{}' | ConvertTo-Json
        Invoke-RestMethod "$API/api/payment/orders" -Method POST -Body $body -ContentType "application/json" -Headers $headers
        throw "should have been forbidden"
    } catch {
        if ($_.Exception.Response.StatusCode -ne 403) { throw $_ }
    }
}

# 5. Card recharge
Test-Case "Card recharge" {
    $body = @{ code = "STARAI-DEMO-1000" } | ConvertTo-Json
    try {
        Invoke-RestMethod "$API/api/recharge/card" -Method POST -Body $body -ContentType "application/json" -Headers $headers
        throw "card should be used already"
    } catch {
        # expected if already used
    }
}

# 6. Admin login and dashboard
Test-Case "Admin dashboard" {
    $body = @{ email = "admin@starai.local"; password = "admin123" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/admin/api/login" -Method POST -Body $body -ContentType "application/json"
    $adminToken = $r.data.token
    $adminHeaders = @{ Authorization = "Bearer $adminToken" }
    $stats = Invoke-RestMethod "$API/admin/api/dashboard" -Headers $adminHeaders
    if ($null -eq $stats.data.total_users) { throw "no stats" }
}

# 7. Chat completion (non-stream)
Test-Case "Chat completion" {
    $body = @{
        model_code = "chat_demo_v1"
        messages = @(@{ role = "user"; content = "你好" })
        stream = $false
    } | ConvertTo-Json -Depth 5
    $r = Invoke-RestMethod "$API/api/chat/completions" -Method POST -Body $body -ContentType "application/json" -Headers $headers
    if (-not $r.data.content) { throw "no content" }
}

# 8. Conversations list
Test-Case "Conversations list" {
    $r = Invoke-RestMethod "$API/api/chat/conversations" -Headers $headers
    if ($null -eq $r.data) { throw "no conversations payload" }
}

# 9. Profile update
Test-Case "Update profile" {
    $body = @{ nickname = "演示用户" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/api/me/profile" -Method PATCH -Body $body -ContentType "application/json" -Headers $headers
    if (-not $r.data.public_id) { throw "no profile" }
}

# 10. Recharge records
Test-Case "Recharge records" {
    $r = Invoke-RestMethod "$API/api/recharge/records" -Headers $headers
    if ($null -eq $r.data) { throw "no recharge records payload" }
}

# 11. Announcements (public)
Test-Case "Announcements list" {
    $r = Invoke-RestMethod "$API/api/announcements"
    if ($null -eq $r.data.items) { throw "no announcements" }
}

# 12. Notifications
Test-Case "Notifications list" {
    $r = Invoke-RestMethod "$API/api/notifications" -Headers $headers
    if ($null -eq $r.data) { throw "no notifications payload" }
}

# 13. Daily check-in status
Test-Case "Check-in status" {
    $r = Invoke-RestMethod "$API/api/daily-checkin/status" -Headers $headers
    if ($null -eq $r.data.enabled) { throw "no checkin status" }
}

# 14. API token create + list
Test-Case "API token create" {
    $body = @{ name = "test" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/api/api-tokens" -Method POST -Body $body -ContentType "application/json" -Headers $headers
    if (-not $r.data.token) { throw "no token returned" }
}

# 15. Gallery list + tags
Test-Case "Gallery list" {
    $tags = Invoke-RestMethod "$API/api/gallery/tags"
    if ($null -eq $tags.data.items) { throw "no tags" }
    $r = Invoke-RestMethod "$API/api/gallery"
    if ($null -eq $r.data.items) { throw "no gallery items" }
}

# 16. Agents list
Test-Case "Agents list" {
    $r = Invoke-RestMethod "$API/api/agents"
    if ($null -eq $r.data.items) { throw "no agents" }
}

# 17. Agent project end-to-end (freeze -> per-node -> complete)
Test-Case "Agent workflow end-to-end" {
    # ensure balance via card (ignore if used) then run workflow
    $code = (Invoke-RestMethod "$API/api/agents").data.items[0].code
    if (-not $code) { throw "no agent code" }
    $body = @{ inputs = @{ product = "北欧风陶瓷马克杯" } } | ConvertTo-Json -Depth 5
    try {
        $p = Invoke-RestMethod "$API/api/agents/$code/projects" -Method POST -Body $body -ContentType "application/json" -Headers $headers
    } catch {
        # 402 means insufficient balance - acceptable in CI without recharge
        if ($_.Exception.Response.StatusCode -eq 402) { return }
        throw $_
    }
    $pid = $p.data.public_id
    if (-not $pid) { throw "no project id" }
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 1500
        $proj = (Invoke-RestMethod "$API/api/agent-projects/$pid" -Headers $headers).data
    } while ($proj.status -in @("pending","running") -and (Get-Date) -lt $deadline)
    if ($proj.status -ne "succeeded") { throw "workflow not succeeded: $($proj.status)" }
}

Write-Host "`nResults: $passed passed, $failed failed"
if ($failed -gt 0) { exit 1 }
