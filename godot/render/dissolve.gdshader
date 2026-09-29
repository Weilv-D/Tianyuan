// 棋子死亡「墨晕溶解」：噪声阈值裁切 alpha，裁切缘染墨下沉（web 版只有整体淡出，
// 此为 Godot 独有表现）。progress 0=完好 → 1=全消；noise_tex 逐像素阈值打散边缘。
shader_type canvas_item;

uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform vec4 edge_color : source_color = vec4(0.016, 0.035, 0.06, 1.0); // INK950 墨
uniform float edge_width : hint_range(0.02, 0.4) = 0.22;
uniform sampler2D noise_tex : filter_linear;

void fragment() {
	vec4 tex = texture(TEXTURE, UV);
	float n = texture(noise_tex, UV * 1.35).r;
	// 阈值带随 progress 推进；边缘带内按噪声明暗不齐地消失（墨渍吞没感）
	float cut = progress * (1.0 + edge_width);
	float keep = smoothstep(cut - edge_width, cut, n);
	// 裁切缘染墨：keep 半程处最浓，向外淡去
	float band = keep * (1.0 - smoothstep(cut - edge_width * 0.25, cut, n));
	vec3 col = mix(tex.rgb, edge_color.rgb, clamp(band * 1.2, 0.0, 1.0));
	// 溶解中整体微沉（下沉由宿主 tween position 承担，这里只压亮度）
	col *= 1.0 - 0.25 * progress;
	COLOR = vec4(col, tex.a * keep);
}
