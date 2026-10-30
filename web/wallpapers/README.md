# Wallpapers that come with Aerie

Each folder is one wallpaper. `aerie.json` names it and credits who made it; the wallpaper itself
sits next to it (a picture, `shader.glsl`, `parallax.json` with its layers, `stage.json`, or a
Wallpaper Engine / Lively folder). A `.glb` or `.gltf` 3D scene you export from Blender can also go
here as a loose file (see docs/BLENDER.md).

| Folder | Kind | Made by | License |
|---|---|---|---|
| anime-sky | Shader | ProfesorShader ("Anime Style Sky Shader", godotshaders.com), ported to Shadertoy GLSL for Aerie | CC0 |
| rolling-hills | 2D parallax | Kenney ("Background Elements Redux", kenney.nl), arranged and recolored for Aerie | CC0 |
| earth-at-night | Picture | NASA (via the Pop!_OS wallpaper collection) | Public domain |
| dolomites | Picture | Benjamin Voros (Unsplash, published under CC0; via the Pop!_OS wallpaper collection) | CC0 |

`aerie.json`:

```json
{
  "title": "Name shown in Studio",
  "tagline": "One line about it",
  "order": 1,
  "type": "image",          // only for a plain picture or video: its file is "entry"
  "entry": "file.jpg",
  "preview": "preview.jpg",  // 640 px wide works well
  "credit": { "title": "", "author": "", "license": "", "source": "", "url": "" }
}
```

Only add work you made or that is CC0 / public domain, and fill in the credit.
