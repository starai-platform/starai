# Agent 深度思考

按钮通过 API 参数控制模型；不通过在提示词里添加“认真思考”来模拟开关。服务端以后台当前分析模型为准，并在每次线路尝试时重新映射参数（包括流式、非流式和故障切换）。线路 `runtime_rule.reasoning` 覆盖模型设置。

已支持的映射：

| 模式 | 参数 |
| --- | --- |
| 自动（省略 mode） | 根据上游模型名称和协议保守识别；不能识别时禁用按钮 |
| thinking_type / glm_thinking | GLM、DeepSeek 的 `thinking.type=enabled/disabled` |
| reasoning_effort | OpenAI 兼容接口的 `reasoning_effort`；Responses 转为 `reasoning.effort` |
| claude_budget | Claude `thinking.type` 与 `budget_tokens`；输出上限必须大于思考预算 |
| claude_adaptive | Claude 自适应思考，`output_config.effort` 控制强度 |
| gemini_level / gemini_budget | 原生 `generationConfig.thinkingConfig` |
| enable_thinking | Qwen / DashScope 的 `enable_thinking` |
| nvidia_chat_template | `chat_template_kwargs.enable_thinking` 与预算 |
| custom | 显式配置 `on_params` / `off_params` 两个不同的 JSON 对象 |
| unsupported / always_on | 无法切换，按钮禁用并解释原因 |

在后台“模型 → 支持深度思考 → 思考参数映射”配置。中转供应商不一定使用原厂参数：Claude 的 OpenAI 兼容线路、未识别的新模型、厂商别名应显式配置映射，不应仅勾选能力就宣称支持。线路高级运行规则也可覆盖相同配置。

例如只支持 low/high 的模型：

```json
{"reasoning":{"mode":"reasoning_effort","on_effort":"high","off_effort":"low","omit_temperature":true}}
```

未来模型使用不同开关参数时可配置（字段限于思考和输出预算，不能覆盖请求地址、模型、消息或密钥）：

```json
{"reasoning":{"mode":"custom","can_disable":true,"on_params":{"thinking":{"type":"enabled"}},"off_params":{"thinking":{"type":"disabled"}}}}
```

`on_effort`、`off_effort` 必须符合该模型支持的枚举；无法关闭思考的模型使用低/高强度并向用户说明，不能发送不受支持的 `none`。固定思考模型不伪装成支持开关。自动识别不保证未来型号或所有中转网关兼容，未知组合需要管理员配置及验证。

Agent 页面初次加载、重新聚焦和发送前读取最新能力。后台更换为不支持切换的模型时，已选择深度思考的请求会明确提示，不会静默假装生效。思考内容与最终正文分离；UI 是否展示思考文本不能证明上游是否执行了思考。

验证：`go test ./internal/service ./internal/runtime ./internal/handler`。`TestReasoningSwitchReachesProviderWire` 使用模拟 HTTP 上游核对开关两个状态下最终发送的请求体，包含模型与线路不一致的情况；原生流测试确保思考不混入正文。真实供应商可能忽略参数或改变协议，新增线路还须进行实际验证。

部署需重新构建 API、Web、Admin，无数据库迁移。

本地实测（2026-09-18）：当前 GLM-4.6V 同一道计算题，关闭思考约 0.50 秒、思考内容 0 字节；开启约 3.08 秒、思考内容 447 字节，答案均为 888。浏览器 Agent 开启后也正常完成流式回答。该时间仅代表此请求，不是所有模型的性能保证；其余模型映射经过模拟上游请求验证，尚未逐家进行真实供应商测试。

参考：[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)、[Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)、[Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)、[GLM-4.6V](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v)、[Qwen thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)。
