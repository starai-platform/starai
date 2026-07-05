-- Revert count_options patch (remove keys only; enum left as-is)

UPDATE models SET
  runtime_rule = runtime_rule
    #- '{video,count_options}'
    #- '{video,count_allow_custom}'
    #- '{video,count_max}'
WHERE category = 'video';
