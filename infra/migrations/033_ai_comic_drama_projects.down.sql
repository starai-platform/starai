DELETE FROM system_configs
WHERE key IN (
  'comic_drama_default_dialogue_model',
  'comic_drama_backup_dialogue_models',
  'comic_drama_default_image_model',
  'comic_drama_default_video_model',
  'comic_drama_default_style_mode',
  'comic_drama_default_orientation',
  'comic_drama_default_quality',
  'comic_drama_default_storyboard_grid',
  'comic_drama_default_max_retry',
  'comic_drama_default_step_confirm'
);

DROP TABLE IF EXISTS comic_drama_projects;
DROP TABLE IF EXISTS comic_drama_styles;
