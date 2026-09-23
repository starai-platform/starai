package service

import "testing"

func TestApplyDetailSectionRevisionReusesSourceAndUpdatesResult(t *testing.T) {
	layers := []map[string]interface{}{{"text": "让风穿过每一步", "x": 0.1, "y": 0.7, "width": 0.8, "font_size": 0.05, "color": "#FFFFFF"}}
	if err := validateDetailRevisionLayers(layers); err != nil {
		t.Fatal(err)
	}
	outputs := map[string]interface{}{
		"detail_page": map[string]interface{}{"sections": []interface{}{map[string]interface{}{"task_no": "task-1", "status": "succeeded", "image_url": "old.jpg", "source_image_url": "clean.jpg"}}},
		"media_tasks": []interface{}{map[string]interface{}{"task_no": "task-1", "output": map[string]interface{}{"image_url": "old.jpg", "source_image_url": "clean.jpg"}}},
	}
	if err := applyDetailSectionRevision(outputs, 0, "new.jpg", layers); err != nil {
		t.Fatal(err)
	}
	section := outputs["detail_page"].(map[string]interface{})["sections"].([]interface{})[0].(map[string]interface{})
	if section["source_image_url"] != "clean.jpg" || section["image_url"] != "new.jpg" || len(section["text_layers"].([]map[string]interface{})) != 1 {
		t.Fatalf("revision lost its clean source or new plan: %#v", section)
	}
	output := outputs["media_tasks"].([]interface{})[0].(map[string]interface{})["output"].(map[string]interface{})
	if output["image_url"] != "new.jpg" {
		t.Fatal("download card kept the stale image")
	}
	if err := validateDetailRevisionLayers([]map[string]interface{}{{"text": "bad", "x": 0.9, "y": 0.2, "width": 0.8, "font_size": 0.05}}); err == nil {
		t.Fatal("off-canvas text layer was accepted")
	}
}
