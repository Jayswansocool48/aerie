# Wallpaper formats

Aerie reads these from a file you add, a folder, a `.zip`, or `web/wallpapers/` for the ones it ships with. Studio's Create page writes the same formats, so you can edit what it makes by hand.

## Shader (`shader.glsl`, or any `.glsl` / `.frag` file)

Write it the way you would on Shadertoy:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

You get `iTime`, `iTimeDelta`, `iFrame`, `iResolution`, `iMouse` (smoothed, so the picture glides), `iDate` and `iChannel0` to `iChannel3` (256 × 256 noise). A file with its own `main()` works too.

**Settings in Studio.** Annotate a uniform and Studio shows a control for it:

```glsl
uniform float uSpeed;  // aerie: slider 0 2 1 "Speed"         min, max, default, label
uniform vec3  uTint;   // aerie: color #7fd4ff "Sky color"
uniform bool  uStars;  // aerie: bool 1 "Show stars"
```

**Music.** Add the line `// aerie: audio` and `iChannel0` becomes a 512 × 2 texture: row 0 holds the spectrum (bass on the left), row 1 the waveform. Read it with `texture(iChannel0, vec2(x, 0.25)).r`.

## 2D parallax (`parallax.json` with its layers)

```json
{
  "background": "#1d2b3a",
  "background2": "#4a6a8a",
  "parallax": 1,
  "smoothing": 0.08,
  "layers": [
    { "file": "layers/sky.png",   "depth": 0.05, "fit": "cover" },
    { "file": "layers/hills.png", "depth": 0.4,  "fit": "width", "align": "bottom", "repeat": true, "scroll": 6 },
    { "file": "layers/grass.png", "depth": 0.9,  "fit": "width", "align": "bottom", "sway": 0.3, "react": 0.5 }
  ]
}
```

| Field | Range | What it does |
|---|---|---|
| `depth` | 0–1 | How far the layer moves with the mouse. Back layers near 0, front layers near 1 |
| `fit` | `cover`, `width`, `contain`, `none` | How the picture fills the screen |
| `align` | `top`, `center`, `bottom` | Where it sits when it doesn't fill the height |
| `x`, `y` | -100–100 | Offset, in percent of the screen |
| `scale`, `opacity` | 0.1–4, 0–1 | |
| `scroll` | -200–200 | Drift sideways, in pixels per second. Use with `repeat: true` |
| `sway` | 0–1 | A gentle back-and-forth, like wind |
| `react` | 0–1 | How much the layer pulses with music |

Up to 16 layers, listed back to front. PNG with see-through parts works best; SVG works and loses any scripts.

## 3D scene (`stage.json`)

Models and skies come from Poly Haven by their id. Aerie downloads them on first use and keeps them offline after.

```json
{
  "sky": { "hdri": "kloofendal_48d_partly_cloudy_puresky", "res": "2k", "rotation": 0, "exposure": 1, "blur": 0 },
  "models": [
    { "asset": "island_tree_02", "position": [0, 0, 0], "rotation": [0, 30, 0], "scale": 1, "spin": 0, "bob": 0 }
  ],
  "camera": { "auto": true, "fov": 45, "orbit": 0.03, "parallax": 1 },
  "ground": { "show": true, "color": "#3d4a3a", "shadows": true },
  "fog": { "color": "#9fb8c8", "density": 0.02 }
}
```

Positions are in metres, rotations in degrees. `camera.auto` frames the models for you; turn it off and set `position` and `target` yourself. `orbit` turns the camera slowly (negative goes the other way), `spin` turns a model and `bob` floats it.

## Everything else

- **Pictures and videos** need nothing extra.
- **3D models** (`.glb`, `.gltf`): see [BLENDER.md](BLENDER.md).
- **Web wallpapers:** a folder with `index.html`, a Lively wallpaper (`LivelyInfo.json`) or a Wallpaper Engine web project. Wallpaper Engine's `wallpaperRegisterAudioListener` gets 128 sound levels, as on Windows.
- **Wallpaper Engine projects:** a folder or `.zip` with `project.json`.
