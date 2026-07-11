# 通用真实支付适配协议

平台默认关闭真实支付。`generic` 适配器用于连接已有聚合支付平台或自建支付网关，平台本身不保存商户私钥，也不会在未配置完整时开放生产支付。

## 后台配置顺序

1. `payment_provider` 填写 `generic`。
2. `payment_checkout_url_template` 填写收银台地址，必须包含 `{order_no}`，可选包含 `{amount}`。
3. `payment_webhook_secret` 填写至少 16 位的随机共享密钥。
4. 按需设置订单有效期、最低和最高充值金额。
5. 完成网关回调联调后，最后开启 `payment_enabled`。

例如：

```text
https://pay.example.com/checkout?order_no={order_no}&amount={amount}
```

## 回调协议

网关在支付确认后请求：

```text
POST /api/payment/webhooks/generic
Content-Type: application/json
X-Payment-Timestamp: 1720000000
X-Payment-Signature: <hex hmac-sha256>
```

请求体：

```json
{
  "order_no": "ord_1720000000000_abcd12",
  "amount": 30.00,
  "status": "paid",
  "provider_trade_no": "gateway_trade_123"
}
```

签名原文为 `timestamp + "." + 原始请求体字节`，算法为 HMAC-SHA256，结果使用十六进制编码。时间戳与服务器时间相差超过 5 分钟会被拒绝。

平台会校验订单号、渠道、金额、状态、过期时间和网关交易号，并在同一个数据库事务内完成订单置为已支付和钱包入账。相同订单的重复回调返回成功但不会重复增加余额；同一网关交易号不能用于多个订单。

## 上线检查

- 先在预发布环境使用独立数据库和独立回调密钥联调。
- 网关只在收到 HTTP 2xx 后停止重试。
- 反向代理不得改写 JSON 请求体，否则签名会不一致。
- 务必使用 HTTPS，并限制网关出口 IP（如服务商提供固定 IP）。
- 支付商专属验签、退款、对账和关单能力应作为独立适配器实现，不能复用共享密钥协议冒充官方验签。
