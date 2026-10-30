// Anime Sky: big soft clouds drifting past the sun.
// Port to Shadertoy GLSL of "Anime Style Sky Shader" by ProfesorShader
// (godotshaders.com/shader/anime-style-sky-shader, CC0). The original reads two noise textures;
// this version makes the same clouds from procedural noise that wraps around the horizon.
// Released under CC0 like the original.

uniform vec3 uTop;          // aerie: color #1f66a8 "Sky at the top"
uniform vec3 uBottom;       // aerie: color #57bfeb "Sky near the horizon"
uniform float uCloudSpeed;  // aerie: slider 0 3 1 "Cloud speed"
uniform float uCover;       // aerie: slider 0 1 0.5 "Cloud cover"
uniform float uSunHeight;   // aerie: slider 0 1 0.3 "Sun height"
uniform float uDrift;       // aerie: slider 0 1 0.35 "Camera drift"

#define PI 3.14159265
#define TAU 6.28318531

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// value noise that repeats every `period` cells along x (so the sky wraps around seamlessly)
float noiseP(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(vec2(mod(i.x, period), i.y));
  float b = hash(vec2(mod(i.x + 1.0, period), i.y));
  float c = hash(vec2(mod(i.x, period), i.y + 1.0));
  float d = hash(vec2(mod(i.x + 1.0, period), i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// soft cloudy noise, like Godot's NoiseTexture the original used
float cloudTex(vec2 uv, float period) {
  float v = 0.0, amp = 0.55, per = period;
  vec2 p = uv * period;
  for (int i = 0; i < 6; i++) {
    v += amp * noiseP(p, per);
    p *= 2.0; per *= 2.0; amp *= 0.5;
  }
  return clamp(v, 0.0, 1.0);
}

vec2 eyedirToCylinder(vec3 dir, vec2 scale) {
  float u = fract(((atan(dir.x, dir.z) + PI) / TAU) * scale.x);
  float v = -dir.y * 0.5 * scale.y;
  return vec2(u, v);
}

vec2 rotateUv(vec2 uv, float angle) {
  mat2 r = mat2(vec2(sin(angle), -cos(angle)), vec2(cos(angle), sin(angle)));
  return uv * r;
}

float cloudDensity(vec2 a, vec2 b, float start, float end) {
  return smoothstep(start, end, cloudTex(a, 6.0) * cloudTex(b + 0.37, 6.0) * 1.9);
}

// the sky above the horizon (rd.y >= 0), as in the original shader, with shaded clouds
vec3 skyColor(vec3 rd, vec3 sunDir, float t) {
  vec3 sky = mix(uBottom, uTop, clamp(rd.y, 0.0, 1.0));
  float eyeDot = dot(rd, sunDir);
  float sunDot = max(0.0, eyeDot);
  float sunSize = 0.0005, inv = 1.0 - sunSize;
  float sun = smoothstep(inv, inv + sunSize * 0.3, sunDot);
  float glow = smoothstep(inv - 0.2, inv, sunDot);

  vec2 cyl = eyedirToCylinder(rd, vec2(2.0, 2.0));
  vec2 a = cyl; a.x += t * 0.005;
  vec2 b = cyl; b.x += t * 0.01;
  float start = mix(0.55, 0.22, uCover), end = start + 0.1;
  float hor = cloudDensity(a, b, start, end);
  // anime shading: white where there is cloud above, a soft blue on the undersides
  float above = cloudDensity(a - vec2(0.0, 0.035), b - vec2(0.0, 0.035), start, end);
  vec2 topUv = rotateUv(vec2(rd.x, -rd.z), t * 0.026);
  float top = smoothstep(mix(0.72, 0.45, uCover), mix(0.78, 0.55, uCover), cloudTex(topUv * 0.5 + 7.0, 4.0));
  float mixTop = smoothstep(0.8, 0.9, rd.y);
  float alpha = pow(mix(hor, top, mixTop), 2.0) * smoothstep(0.0, 0.07, rd.y); // clouds thin out at the horizon
  vec3 under = mix(uBottom, vec3(0.86, 0.9, 0.97), 0.55);
  vec3 cloud = mix(under, vec3(0.97), mix(above, 1.0, mixTop));
  float shade = (eyeDot + 1.0) * 0.5;
  cloud = mix(cloud, cloud * vec3(0.9, 0.95, 1.0), shade * 0.5);
  cloud = mix(cloud, vec3(1.0), glow * 0.6);
  float horizon = smoothstep(0.03, 0.2, rd.y);
  cloud = mix(sky, cloud, horizon);

  vec3 c = sky + vec3(sun) + vec3(1.0) * glow * 0.15;
  c = mix(c, cloud, clamp(alpha, 0.0, 1.0));
  c = mix(c, vec3(1.0), 0.125 * (1.0 - horizon));
  c += vec3(0.125) * (1.0 - horizon);
  return c;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec2 m = iMouse.xy / iResolution.xy - 0.5;
  // camera: looking a little up at the sky, drifting slowly sideways, leaning toward the mouse
  float yaw = sin(iTime * 0.02) * uDrift * 0.9 + m.x * 0.12;
  float pitch = 0.22 + m.y * 0.06;
  vec3 rd = normalize(vec3(uv.x, uv.y, 1.35));
  rd.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * rd.yz;
  rd.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * rd.xz;
  vec3 sunDir = normalize(vec3(-0.35, mix(0.06, 0.9, uSunHeight), 1.0));
  float t = iTime * uCloudSpeed;
  vec3 col;
  if (rd.y >= 0.0) col = skyColor(rd, sunDir, t);
  else {
    // under the horizon: the horizon's own color fading into a deeper blue (the original leaves it plain)
    vec3 h = skyColor(normalize(vec3(rd.x, 0.0, rd.z)), sunDir, t);
    col = mix(h, uBottom * 0.72, smoothstep(0.0, 0.3, -rd.y));
  }
  fragColor = vec4(min(col, vec3(0.97)), 1.0); // never pure white
}
