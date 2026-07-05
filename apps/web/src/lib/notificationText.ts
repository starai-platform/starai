type TFn = (key: string, vars?: Record<string, string | number>) => string;

const TITLE_KEYS: Record<string, string> = {
  "生成完成": "notifications.generatedCompleted",
  "生成成功": "notifications.generatedCompleted",
  "任务完成": "notifications.taskCompleted",
  "任务成功": "notifications.taskCompleted",
  "生成失败": "notifications.generatedFailed",
  "任务失败": "notifications.taskFailed",
};

const TYPE_KEYS: Record<string, string> = {
  generation_completed: "notifications.generatedCompleted",
  generation_failed: "notifications.generatedFailed",
  task_completed: "notifications.taskCompleted",
  task_failed: "notifications.taskFailed",
};

export function notificationTitle(t: TFn, title: string, type?: string) {
  const normalizedTitle = String(title || "").trim();
  const normalizedType = String(type || "").trim();
  const key = TITLE_KEYS[normalizedTitle] || TYPE_KEYS[normalizedType];
  return key ? t(key) : normalizedTitle;
}
