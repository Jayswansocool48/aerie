# Making Aerie scenes in Blender

Aerie plays 3D scenes from Blender as live wallpapers: it uses your scene's **camera**, **lights**
and **animations**, and moves the camera a little with the mouse for depth. The scenes in
`web/scenes/` are Aerie's default themes.

## Export

1. Make your scene. Set up a **camera** (Aerie looks through the first one) — 16:9 is best
   (Output Properties → Resolution 1920 × 1080). Wider screens see more at the sides;
   narrower ones keep everything left to right.
2. **File → Export → glTF 2.0 (.glb/.gltf)**, with:
   - **Format:** glTF Binary (`.glb`) — one file, easiest
   - **Include:** ✅ Cameras, ✅ Punctual Lights, ✅ Custom Properties (for the options below)
   - **Data → Mesh:** ✅ Apply Modifiers
   - **Data → Compression:** optional (Draco works and makes files much smaller)
   - **Lighting Mode:** Standard
   - **Animation:** ✅ on, if anything moves
3. Try it: Aerie Studio → Library → **Add a file…** (or drag the `.glb` onto Studio).

## Tips for wallpapers that look good and run smoothly

- **Loop your animations:** make the first and last frames the same (or use a Cycles modifier
  in the Graph Editor), so the wallpaper never jumps. All animations play at once, on repeat.
- **Only Principled BSDF materials export** (base color, metallic, roughness, normal map,
  emission, alpha). Shader node tricks, volumetrics, particle systems and geometry nodes
  that aren't applied won't come across — bake them into textures or meshes first.
- **Glow:** use Emission on the material. For soft light without many lamps, bake lighting
  into the textures (Cycles → Bake) — it looks great and is fast.
- **Background:** glTF has no World/sky. Model a big sky sphere or a backdrop plane with an
  emissive texture, or set `aerie_background` (below).
- **Keep it light:** a wallpaper runs all the time. Aim for under ~300k triangles and textures
  of 2048 px or less (4096 only for the main backdrop). Under 50 MB is a good target.
- **Colors:** Aerie uses the same "AgX" look as Blender 4.x's default view, so colors match
  what you see in the viewport (Rendered mode, EEVEE).

## Optional settings (Custom Properties)

Add these on the **Scene** (Scene Properties → Custom Properties → New) and export with
"Custom Properties" on:

| Property | Example | What it does |
|---|---|---|
| `aerie_background` | `#0b1020` | Background color behind everything |
| `aerie_parallax` | `0.5` | How much the camera follows the mouse (0 = still, 1 = normal, 2 = a lot) |
| `aerie_exposure` | `1.2` | Brighter or darker |
| `aerie_shadows` | `0` | Turn shadows off (they're on by default) |

People using your scene can also change mouse depth, animation speed, brightness, shadows
and background in Aerie Studio → This wallpaper.

## Adding a scene to Aerie's defaults

Put these in `web/scenes/` and commit them:

```
web/scenes/
  summer-shrine.glb     ← the scene
  summer-shrine.jpg     ← a 16:9 preview picture (1280×720 is plenty) — optional
  summer-shrine.json    ← optional: {"title": "Summer Shrine", "tagline": "A red gate under big clouds", "order": 1}
```

The first one (lowest `order`, then by title) is the wallpaper a new install starts with.
Without any default scenes, Aerie starts with its built-in 3D look.

**Licensing:** only add scenes you made yourself, or models and textures whose license lets
you share them (for example CC0 from Poly Haven or ambientCG). Note the source and license in
the `.json` file (`"credits": "…"`) and in `README.md`'s credits.
