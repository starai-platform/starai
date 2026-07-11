# Stripe 与 PayPal 真实支付接入

平台支持在后台选择 `stripe`、`paypal` 或原有的 `generic` 通用网关。所有真实支付渠道默认关闭；请先在测试环境完成下单、支付、重复回调和金额校验，再开启 `payment_enabled`。

## 公共配置

- `payment_currency`：三位 ISO 币种代码，例如 `USD`、`EUR`、`JPY`。
- `payment_product_name`：支付商收银台显示的商品名称。
- `payment_success_url`：支付成功后的完整返回地址，可包含 `{order_no}`。
- `payment_cancel_url`：取消支付后的完整返回地址。
- `payment_order_expire_minutes`：本地订单有效期；Stripe 最低按 30 分钟处理，PayPal 最低按 6 小时处理。
- `payment_min_amount` / `payment_max_amount`：单笔充值范围。

返回地址只用于用户体验，不能作为到账依据。钱包入账只由通过官方验证的服务端 webhook 触发。

## Stripe Checkout

1. 在 Stripe 测试模式获取 `sk_test_...` Secret Key。
2. 后台支付渠道选择 `stripe`，填写 `stripe_secret_key`。
3. 在 Stripe Workbench 创建 webhook endpoint：

```text
https://你的API域名/api/payment/webhooks/stripe
```

4. 订阅事件：

```text
checkout.session.completed
checkout.session.async_payment_succeeded
```

5. 将 endpoint 对应的 `whsec_...` 填入 `stripe_webhook_secret`。
6. 测试成功后再换成 Live Secret Key 和 Live endpoint secret，最后开启在线支付。

平台创建一次性 Checkout Session，使用平台订单号作为 Stripe 幂等键和 `client_reference_id`。回调会校验原始请求体、`Stripe-Signature`、五分钟时间窗口、Session ID、金额和币种。

## PayPal Checkout

1. 在 PayPal Developer Dashboard 创建 REST App，先使用 Sandbox Client ID 和 Secret。
2. 后台支付渠道选择 `paypal`，环境选择 `sandbox`，填写 Client ID、Client Secret。
3. 为该 App 创建 webhook：

```text
https://你的API域名/api/payment/webhooks/paypal
```

4. 至少订阅：

```text
CHECKOUT.ORDER.APPROVED
PAYMENT.CAPTURE.COMPLETED
```

5. 将创建后显示的 Webhook ID 填入 `paypal_webhook_id`。注意它不是 webhook URL。
6. Sandbox 完整测试后切换 `live` 并换成正式 App 凭据和正式 Webhook ID。

平台使用 OAuth2 Client Credentials 创建 Orders v2 订单。收到批准事件后，以平台订单号作为 `PayPal-Request-Id` 调用 capture；所有 webhook 都会回传至 PayPal 官方验签接口，只有 `SUCCESS` 才允许原子入账。重复批准、重复 capture 和重复 webhook 不会重复增加余额。

## 上线前检查

- API 必须使用公网 HTTPS，服务器时间需保持同步。
- Stripe Test 与 Live 的 webhook secret 不可混用。
- PayPal Sandbox 与 Live 的 Client、Secret、Webhook ID 不可混用。
- 支付币种必须受商户账户支持；修改币种后只能影响新订单。
- 不要通过成功返回页面直接增加余额。
- 在支付商后台确认一次付款只对应一条平台钱包流水。
- 退款、拒付和争议当前只记录在支付商侧，正式运营前应继续接入平台退款与对账流程。

官方参考：[Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions)、[Stripe webhook 签名](https://docs.stripe.com/webhooks/signature)、[PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/)、[PayPal webhook 验证](https://developer.paypal.com/api/rest/webhooks/rest/)。
