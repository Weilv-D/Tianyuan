// 棋子立绘着色器：星级描边（1★ 墨 / 2★ 银 / 3★ 金）+ 墨兽青黛罩染。
// 取代 Phaser 版烘焙 576 张派生纹理的方案 —— 现役 PNG 原样复用，零派生资产。
shader_type canvas_item;

uniform vec4 outline_color : source_color = vec4(1.0);
uniform float outline_width : hint_range(0.0, 4.0) = 1.6;
uniform vec4 monster_wash : source_color = vec4(0.0);

void fragment() {
	vec4 tex = texture(TEXTURE, UV);
	// 描边：UV 空间按纹素步长采样四邻（thickness 按纹理尺寸换算）
	vec2 px = vec2(outline_width) / vec2(textureSize(TEXTURE, 0));
	float a_up = texture(TEXTURE, UV + vec2(0.0, px.y)).a;
	float a_dn = texture(TEXTURE, UV - vec2(0.0, px.y)).a;
	float a_lf = texture(TEXTURE, UV - vec2(px.x, 0.0)).a;
	float a_rt = texture(TEXTURE, UV + vec2(px.x, 0.0)).a;
	float near = max(max(a_up, a_dn), max(a_lf, a_rt));
	float edge = clamp(near - tex.a, 0.0, 1.0) * step(0.01, tex.a + near);
	vec4 col = mix(tex, vec4(outline_color.rgb, edge * 0.85), edge);
	// 墨兽罩染：source-atop 单色叠加（青黛）
	if (monster_wash.a > 0.001 && col.a > 0.001) {
		col.rgb = mix(col.rgb, monster_wash.rgb, monster_wash.a);
	}
	COLOR = col;
}
