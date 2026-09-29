// 场景切换「墨晕吞没」：墨自屏幕四周向中心吞没（progress 0→1 淡出，1→0 淡入），
// 边缘由分形噪声打散 —— 墨渍渗纸的不规则前沿。替代纯 alpha 淡入淡出。
shader_type canvas_item;

uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform vec4 ink_color : source_color = vec4(0.027, 0.035, 0.047, 1.0); // 夜墨

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
	return vnoise(p) * 0.6 + vnoise(p * 2.3 + 7.7) * 0.4;
}

void fragment() {
	vec2 c = UV - 0.5;
	c.x *= 1.7778; // 设计 16:9 —— 距离场按圆算
	float d = length(c);
	float n = fbm(UV * 5.0) * 0.55; // 前沿不规则
	// r 从 1.25（全透明，屏幕外）收到 0（墨满全屏）；d 大处先被吞没
	float r = (1.0 - progress) * 1.25;
	float ink = smoothstep(r - 0.30 + n, r + n, d);
	COLOR = vec4(ink_color.rgb, ink);
}
