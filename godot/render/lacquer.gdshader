// 大漆盘漆纹着色器：夜蓝底上叠加笔触噪声漆纹 + 清漆高光扫过（M3 下批）。
// 视觉语义对齐 BoardView 的 lacquerBoard 烘焙层；夜宴红线：无荧光、无紫，
// 高光是米金的柔光不是镜面。叠加在 _draw 底座之上（modulate 混合）。
shader_type canvas_item;

uniform float lacquer_scale = 3.2;      // 漆纹尺度（盘面 640px 上约 5~6 道笔触）
uniform float lacquer_strength = 0.55;  // 漆纹明度差（克制：漆是暗光不是亮纹）
uniform float grain_amount = 0.05;      // 宣纸颗粒
uniform float sheen = 0.10;             // 清漆高光强度
uniform vec3 lacquer_dark = vec3(0.024, 0.043, 0.070);   // #06101f 附近（INK950~900 之间）
uniform vec3 lacquer_light = vec3(0.075, 0.118, 0.173);  // #132030 附近（INK700 族）

// 2D value noise（哈希 + 双线性）
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
// 分形叠加（两八度足够 —— 漆纹是宽笔触，不是细噪）
float fbm(vec2 p) {
	return vnoise(p) * 0.65 + vnoise(p * 2.13 + 7.7) * 0.35;
}

void fragment() {
	vec2 uv = UV;
	// 漆纹：拉伸坐标做横向笔触感（漆刷走横）
	float lac = fbm(vec2(uv.x * lacquer_scale * 1.6, uv.y * lacquer_scale * 0.6));
	lac = pow(lac, 1.35);
	vec3 col = mix(lacquer_dark, lacquer_light, lac * lacquer_strength + 0.30);
	// 宣纸颗粒
	float g = hash12(uv * 640.0) - 0.5;
	col += g * grain_amount;
	// 清漆高光：一条柔和的斜向亮带缓慢扫过（米金 #e3cfa0 系，低强度）
	vec3 sheen_col = vec3(0.890, 0.812, 0.627);
	float band = smoothstep(0.45, 0.0, abs(uv.x + uv.y * 0.6 - 0.9));
	col += sheen_col * band * sheen * (0.6 + 0.4 * lac);
	// 边缘沉入夜色（盘沿 vignette）
	float d = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
	col *= 1.0 - 0.28 * smoothstep(0.72, 1.0, d);
	COLOR = vec4(col, 0.9);
}
