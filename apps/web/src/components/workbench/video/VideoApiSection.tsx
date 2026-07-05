"use client";

const VIDEO_API_EXAMPLE = `POST /api/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "model_code": "video_sd2_0",
  "prompt": "赛博朋克城市航拍，霓虹灯雨夜",
  "params": {
    "count": 1,
    "speed": "fast",
    "duration": "8s",
    "aspect_ratio": "16:9",
    "resolution": "720p",
    "reference_images": [
      "https://cdn.example.com/ref1.jpg",
      "https://cdn.example.com/ref2.jpg"
    ]
  }
}

// 1. GET /api/models/{code} 读取 input_schema / runtime_rule / default_params
// 2. params 键名与前台一致；runtime_rule.upstream 控制 Worker 如何映射到 NEW API
// 3. 视频参考图：reference_images[]；首尾帧：first_frame / last_frame（字符串 URL）`;

export function VideoApiSection() {
  return (
    <section className="soft-card p-5">
      <h2 className="font-semibold mb-1">视频任务 params（Open API）</h2>
      <p className="text-xs text-gray-500 mb-3">
        接入方无需硬编码各模型差异：先拉取模型配置，再按 input_schema 组装 params。服务端会校验参考图数量并映射 upstream 字段。
      </p>
      <pre className="text-xs bg-gray-50 border border-gray-100 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
        {VIDEO_API_EXAMPLE}
      </pre>
    </section>
  );
}
