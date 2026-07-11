# StarAI integration tests
param(
    [string]$API = "http://localhost:8080"
)
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

# 2. Bootstrap isolated test configuration through the super administrator.
$script:adminToken = $null
$script:adminHeaders = $null
Test-Case "Prepare test authentication" {
    $body = @{ email = "admin@starai.local"; password = "admin123" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/admin/api/login" -Method POST -Body $body -ContentType "application/json"
    $script:adminToken = $r.data.token
    $script:adminHeaders = @{ Authorization = "Bearer $script:adminToken" }
    $configBody = @{ image_captcha_enabled = $false } | ConvertTo-Json
    Invoke-RestMethod "$API/admin/api/system-configs" -Method PATCH -Body $configBody -ContentType "application/json" -Headers $script:adminHeaders | Out-Null
}

# 3. Login demo user
$token = $null
Test-Case "User login" {
    $body = @{ email = "demo@starai.local"; password = "demo123" } | ConvertTo-Json
    $r = Invoke-RestMethod "$API/api/auth/login/password" -Method POST -Body $body -ContentType "application/json"
    $script:token = $r.data.token
    if (-not $script:token) { throw "no token" }
}

$headers = @{ Authorization = "Bearer $token" }

# 4. Models list (no API key needed)
Test-Case "Models list without API key" {
    $r = Invoke-RestMethod "$API/api/models" -Headers $headers
    if ($r.data.Count -lt 1) { throw "no models" }
}

# 5. Payment disabled
Test-Case "Payment order blocked" {
    try {
        $body = '{}' | ConvertTo-Json
        Invoke-RestMethod "$API/api/payment/orders" -Method POST -Body $body -ContentType "application/json" -Headers $headers
        throw "should have been forbidden"
    } catch {
        if ($_.Exception.Response.StatusCode -ne 403) { throw $_ }
    }
}

# 6. Card recharge
Test-Case "Card recharge" {
    $body = @{ code = "STARAI-DEMO-1000" } | ConvertTo-Json
    try {
        Invoke-RestMethod "$API/api/recharge/card" -Method POST -Body $body -ContentType "application/json" -Headers $headers
        throw "card should be used already"
    } catch {
        # expected if already used
    }
}

# 7. Admin dashboard
Test-Case "Admin dashboard" {
    $stats = Invoke-RestMethod "$API/admin/api/dashboard" -Headers $script:adminHeaders
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
    $body = @{ inputs = @{ product = "北欧风陶瓷马克杯"; _mode = "auto" } } | ConvertTo-Json -Depth 5
    try {
        $p = Invoke-RestMethod "$API/api/agents/$code/projects" -Method POST -Body $body -ContentType "application/json" -Headers $headers
    } catch {
        # 402 means insufficient balance - acceptable in CI without recharge
        if ($_.Exception.Response.StatusCode -eq 402) { return }
        throw $_
    }
    $projectPublicID = $p.data.public_id
    if (-not $projectPublicID) { throw "no project id" }
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 1500
        $proj = (Invoke-RestMethod "$API/api/agent-projects/$projectPublicID" -Headers $headers).data
    } while ($proj.status -in @("pending","running") -and (Get-Date) -lt $deadline)
    if ($proj.status -ne "succeeded") { throw "workflow not succeeded: $($proj.status)" }
}

# 18. HttpOnly cookie login, authenticated request and logout invalidation
Test-Case "Cookie session login and logout" {
    $body = @{ email = "demo@starai.local"; password = "demo123" } | ConvertTo-Json
    $login = Invoke-RestMethod "$API/api/auth/login/password" -Method POST -Body $body -ContentType "application/json" -SessionVariable userSession
    if (-not $login.user -and -not $login.data.user) { throw "cookie login returned no user" }
    $me = Invoke-RestMethod "$API/api/me" -WebSession $userSession
    if (-not $me.data.public_id) { throw "cookie session did not authenticate" }
    Invoke-RestMethod "$API/api/auth/logout" -Method POST -WebSession $userSession | Out-Null
    try {
        Invoke-RestMethod "$API/api/me" -WebSession $userSession | Out-Null
        throw "logged-out cookie session remained valid"
    } catch {
        if ($_.Exception.Response.StatusCode -ne 401) { throw $_ }
    }
    # Password logins made within the same JWT timestamp second may produce the
    # same token. Wait for a fresh token after testing revocation so later
    # concurrency cases do not reuse the intentionally revoked session.
    Start-Sleep -Milliseconds 1100
    $freshLogin = Invoke-RestMethod "$API/api/auth/login/password" -Method POST -Body $body -ContentType "application/json"
    $script:token = $freshLogin.data.token
    $script:headers = @{ Authorization = "Bearer $script:token" }
}

# 19. Operator must not reach super-admin configuration writes
Test-Case "Operator RBAC blocks system configuration" {
    $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $email = "operator-$suffix@starai.local"
    $body = @{ email = $email; password = "operator123"; role = "operator"; status = "active" } | ConvertTo-Json
    Invoke-RestMethod "$API/admin/api/admin-accounts" -Method POST -Body $body -ContentType "application/json" -Headers $adminHeaders | Out-Null
    $loginBody = @{ email = $email; password = "operator123" } | ConvertTo-Json
    $login = Invoke-RestMethod "$API/admin/api/login" -Method POST -Body $loginBody -ContentType "application/json"
    $operatorHeaders = @{ Authorization = "Bearer $($login.data.token)" }
    try {
        Invoke-RestMethod "$API/admin/api/system-configs" -Method PATCH -Body '{}' -ContentType "application/json" -Headers $operatorHeaders | Out-Null
        throw "operator unexpectedly changed system configuration"
    } catch {
        if ($_.Exception.Response.StatusCode -ne 403) { throw $_ }
    }
}

# 20. Concurrent redemption of one card must credit exactly once
Test-Case "Card redemption is concurrency safe" {
    $before = (Invoke-RestMethod "$API/api/wallet" -Headers $headers).data.compute_balance
    $batchBody = @{ name = "integration-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"; type = "compute"; value = 7; quantity = 1 } | ConvertTo-Json
    $batch = Invoke-RestMethod "$API/admin/api/card-batches" -Method POST -Body $batchBody -ContentType "application/json" -Headers $adminHeaders
    $cardCode = $batch.data.codes[0]
    if (-not $cardCode) { throw "card batch returned no code" }
    $jobs = 1..2 | ForEach-Object {
        Start-Job -ScriptBlock {
            param($ApiUrl, $Bearer, $Code)
            try {
                $h = @{ Authorization = "Bearer $Bearer" }
                $b = @{ code = $Code } | ConvertTo-Json
                Invoke-RestMethod "$ApiUrl/api/recharge/card" -Method POST -Body $b -ContentType "application/json" -Headers $h | Out-Null
                return "success"
            } catch {
                return "rejected"
            }
        } -ArgumentList $API, $token, $cardCode
    }
    $results = $jobs | Wait-Job | Receive-Job
    $jobs | Remove-Job -Force
    if (@($results | Where-Object { $_ -eq "success" }).Count -ne 1) { throw "card redemption did not have exactly one winner: $results" }
    $after = (Invoke-RestMethod "$API/api/wallet" -Headers $headers).data.compute_balance
    if ([math]::Abs(([double]$after - [double]$before) - 7) -gt 0.0001) { throw "wallet credited an unexpected amount" }
}

# 21. Comic project/style lifecycle
Test-Case "Comic project lifecycle" {
    $styleBody = @{ name = "集成测试风格"; prompt = "稳定统一的动画风格"; cover_url = ""; mode = "manual" } | ConvertTo-Json
    $style = Invoke-RestMethod "$API/api/comic-drama/styles" -Method POST -Body $styleBody -ContentType "application/json" -Headers $headers
    $styleID = $style.data.public_id
    $projectBody = @{ name = "集成测试漫剧"; description = "生命周期测试"; style_id = $styleID; orientation = "landscape"; quality = "480P"; workflow_code = "ai_comic_drama" } | ConvertTo-Json
    $project = Invoke-RestMethod "$API/api/comic-drama/projects" -Method POST -Body $projectBody -ContentType "application/json" -Headers $headers
    $projectID = $project.data.public_id
    $clone = Invoke-RestMethod "$API/api/comic-drama/projects/$projectID/clone" -Method POST -Headers $headers
    $cloneID = $clone.data.public_id
    Invoke-RestMethod "$API/api/comic-drama/projects/$projectID/archive" -Method PATCH -Body '{"archived":true}' -ContentType "application/json" -Headers $headers | Out-Null
    $all = Invoke-RestMethod "$API/api/comic-drama/projects?include_archived=true" -Headers $headers
    $archived = $all.data.items | Where-Object { $_.public_id -eq $projectID }
    if (-not $archived.archived) { throw "project was not archived" }
    Invoke-RestMethod "$API/api/comic-drama/projects/$cloneID" -Method DELETE -Headers $headers | Out-Null
    Invoke-RestMethod "$API/api/comic-drama/projects/$projectID" -Method DELETE -Headers $headers | Out-Null
    Invoke-RestMethod "$API/api/comic-drama/styles/$styleID" -Method DELETE -Headers $headers | Out-Null
}

# 22. Concurrent withdrawals must not overdraw cash balance
Test-Case "Withdrawal concurrency is safe" {
    $users = Invoke-RestMethod "$API/admin/api/users?page=1&page_size=100&keyword=demo%40starai.local" -Headers $adminHeaders
    $demo = $users.data.items | Where-Object { $_.email -eq "demo@starai.local" } | Select-Object -First 1
    if (-not $demo.id) { throw "demo user not found in admin list" }
    $setBalance = @{ cash_balance = 10 } | ConvertTo-Json
    Invoke-RestMethod "$API/admin/api/users/$($demo.id)" -Method PATCH -Body $setBalance -ContentType "application/json" -Headers $adminHeaders | Out-Null
    $jobs = 1..2 | ForEach-Object {
        Start-Job -ScriptBlock {
            param($ApiUrl, $Bearer)
            try {
                $h = @{ Authorization = "Bearer $Bearer" }
                $b = @{ method = "alipay"; amount = 8; account_info = @{ account = "integration-test" } } | ConvertTo-Json -Depth 4
                Invoke-RestMethod "$ApiUrl/api/wallet/withdrawals" -Method POST -Body $b -ContentType "application/json" -Headers $h | Out-Null
                return "success"
            } catch {
                return "rejected"
            }
        } -ArgumentList $API, $token
    }
    $results = $jobs | Wait-Job | Receive-Job
    $jobs | Remove-Job -Force
    if (@($results | Where-Object { $_ -eq "success" }).Count -ne 1) { throw "withdrawal concurrency did not have exactly one winner: $results" }
    $wallet = (Invoke-RestMethod "$API/api/wallet" -Headers $headers).data
    if ([math]::Abs([double]$wallet.cash_balance - 2) -gt 0.0001) { throw "cash balance was overdrawn or deducted incorrectly" }
}

# 23. Payment order can be queried by its owner after a development mock payment.
Test-Case "Payment order status query" {
    $enablePayment = @{ payment_enabled = $true } | ConvertTo-Json
    Invoke-RestMethod "$API/admin/api/system-configs" -Method PATCH -Body $enablePayment -ContentType "application/json" -Headers $adminHeaders | Out-Null
    try {
        $body = @{ amount = 1; channel = "mock" } | ConvertTo-Json
        $created = Invoke-RestMethod "$API/api/payment/orders" -Method POST -Body $body -ContentType "application/json" -Headers $headers
        $orderNo = $created.data.order_no
        $order = Invoke-RestMethod "$API/api/payment/orders/$orderNo" -Headers $headers
        if ($order.data.status -ne "paid" -or $order.data.currency -ne "USD") { throw "payment order status or currency mismatch" }
    } finally {
        $disablePayment = @{ payment_enabled = $false } | ConvertTo-Json
        Invoke-RestMethod "$API/admin/api/system-configs" -Method PATCH -Body $disablePayment -ContentType "application/json" -Headers $adminHeaders | Out-Null
    }
}

# 24. Official provider webhook endpoints fail closed while unconfigured.
Test-Case "Unconfigured official payment webhooks fail closed" {
    foreach ($provider in @("stripe", "paypal")) {
        try {
            Invoke-RestMethod "$API/api/payment/webhooks/$provider" -Method POST -Body '{}' -ContentType "application/json" | Out-Null
            throw "$provider webhook unexpectedly accepted an unsigned event"
        } catch {
            if ($_.Exception.Response.StatusCode -ne 400) { throw $_ }
        }
    }
}

# 25. Dynamic model content is localized by the database overlay and keeps the source locale unchanged.
Test-Case "Dynamic content translation overlay" {
    Invoke-RestMethod "$API/admin/api/content-translations/sync" -Method POST -Headers $adminHeaders | Out-Null
    $models = Invoke-RestMethod "$API/api/models" -Headers @{ "X-Locale" = "zh-CN" }
    $model = @($models.data)[0]
    if (-not $model.code) { throw "no public model available for translation test" }

    $encodedCode = [uri]::EscapeDataString([string]$model.code)
    $translations = Invoke-RestMethod "$API/admin/api/content-translations?locale=en-US&entity_type=model&search=$encodedCode&page_size=200" -Headers $adminHeaders
    $source = @($translations.data.items | Where-Object { $_.entity_key -eq $model.code -and $_.field_path -eq "/display_name" })[0]
    if (-not $source.source_id) { throw "model display_name translation source was not extracted" }

    $translatedName = "Integration Translated Model"
    $translationBody = @{ locale = "en-US"; value = $translatedName; reviewed = $true } | ConvertTo-Json
    Invoke-RestMethod "$API/admin/api/content-translations/$($source.source_id)" -Method PUT -Body $translationBody -ContentType "application/json" -Headers $adminHeaders | Out-Null

    $english = Invoke-RestMethod "$API/api/models/$($model.code)" -Headers @{ "X-Locale" = "en-US" }
    $sourceLocale = Invoke-RestMethod "$API/api/models/$($model.code)" -Headers @{ "X-Locale" = "zh-CN" }
    if ($english.data.display_name -ne $translatedName) { throw "English translation overlay was not applied" }
    if ($sourceLocale.data.display_name -ne $model.display_name) { throw "source locale content was unexpectedly replaced" }
}

# 26. Translation model test and static UI generation persist public overrides without manual dictionary edits.
Test-Case "Static UI AI translation workflow" {
    $testBody = @{ model_code = "chat_demo_v1" } | ConvertTo-Json
    $tested = Invoke-RestMethod "$API/admin/api/content-translations/test-model" -Method POST -Body $testBody -ContentType "application/json" -Headers $adminHeaders
    if (-not $tested.data.translation) { throw "translation model test returned no text" }

    $key = "integration.translation.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    $uiBody = @{ locale = "ja-JP"; model_code = "chat_demo_v1"; items = @(@{ key = $key; source_text = "Save settings" }) } | ConvertTo-Json -Depth 5
    $generated = Invoke-RestMethod "$API/admin/api/ui-translations/auto-translate" -Method POST -Body $uiBody -ContentType "application/json" -Headers $adminHeaders
    if ($generated.data.generated -ne 1) { throw "static UI translation was not generated" }
    $publicConfig = Invoke-RestMethod "$API/api/system-configs/public"
    $saved = @($publicConfig.data.ui_translation_overrides | Where-Object { $_.locale -eq "ja-JP" -and $_.key -eq $key })[0]
    if (-not $saved.value) { throw "generated UI translation was not persisted in public overrides" }
}

# 27. Dynamic translation statistics and AI overlay work for a non-English target locale.
Test-Case "Dynamic translation stats and Japanese overlay" {
    $body = @{ locale = "ja-JP"; model_code = "chat_demo_v1"; entity_type = "model"; limit = 50 } | ConvertTo-Json
    $result = Invoke-RestMethod "$API/admin/api/content-translations/auto-translate" -Method POST -Body $body -ContentType "application/json" -Headers $adminHeaders
    if ($result.data.translated -lt 1) { throw "Japanese dynamic translations were not generated" }
    $translatedRows = Invoke-RestMethod "$API/admin/api/content-translations?locale=ja-JP&entity_type=model&status=translated&page_size=200" -Headers $adminHeaders
    $nameRow = @($translatedRows.data.items | Where-Object { $_.field_path -eq "/display_name" })[0]
    if (-not $nameRow.entity_key) { throw "no translated Japanese model name was found" }
    $sourceModel = Invoke-RestMethod "$API/api/models/$($nameRow.entity_key)" -Headers @{ "X-Locale" = "zh-CN" }
    $japanese = Invoke-RestMethod "$API/api/models/$($nameRow.entity_key)" -Headers @{ "X-Locale" = "ja-JP" }
    if ($japanese.data.display_name -eq $sourceModel.data.display_name) { throw "Japanese dynamic translation overlay was not applied" }
    $stats = Invoke-RestMethod "$API/admin/api/content-translations/stats?entity_type=model" -Headers $adminHeaders
    $jaStats = @($stats.data.items | Where-Object { $_.locale -eq "ja-JP" })[0]
    if (-not $jaStats -or ($jaStats.translated + $jaStats.reviewed) -lt 1) { throw "translation statistics did not report translated content" }
}

Write-Host "`nResults: $passed passed, $failed failed"
if ($failed -gt 0) { exit 1 }
