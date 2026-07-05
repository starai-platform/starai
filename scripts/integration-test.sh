#!/bin/bash
# StarAI MVP Integration Tests
set -e
API="${API_URL:-http://localhost:8080}"

echo "=== StarAI MVP Integration Tests ==="

# 1. Health check
curl -sf "$API/health" > /dev/null && echo "✓ Health check"

# 2. Login demo user
TOKEN=$(curl -sf -X POST "$API/api/auth/login/password" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@starai.local","password":"demo123"}' | jq -r '.data.token')
[ -n "$TOKEN" ] && echo "✓ User login"

# 3. List models (no API key needed)
MODELS=$(curl -sf "$API/api/models" -H "Authorization: Bearer $TOKEN")
echo "$MODELS" | jq -e '.data | length > 0' > /dev/null && echo "✓ Models list"

# 4. Payment disabled
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/payment/orders" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
[ "$STATUS" = "403" ] && echo "✓ Payment blocked when disabled"

# 5. Admin login
ADMIN_TOKEN=$(curl -sf -X POST "$API/admin/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@starai.local","password":"admin123"}' | jq -r '.data.token')
[ -n "$ADMIN_TOKEN" ] && echo "✓ Admin login"

# 6. Admin dashboard
curl -sf "$API/admin/api/dashboard" -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null && echo "✓ Admin dashboard"

# 7. Card recharge (should fail if already used)
CARD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/recharge/card" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"code":"STARAI-DEMO-1000"}')
if [ "$CARD_STATUS" = "400" ]; then
  echo "✓ Card anti-reuse (already used)"
elif [ "$CARD_STATUS" = "200" ]; then
  echo "✓ Card recharge success"
fi

# 8. Chat completion (non-stream)
CHAT=$(curl -sf -X POST "$API/api/chat/completions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model_code":"chat_demo_v1","messages":[{"role":"user","content":"hello"}],"stream":false}')
echo "$CHAT" | jq -e '.data.content' > /dev/null && echo "✓ Chat completion"

echo "=== All tests passed ==="
