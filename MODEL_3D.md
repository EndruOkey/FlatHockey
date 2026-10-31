# MODEL_3D.md — locker 3D player model

The locker's 3D player (`public/js/locker-3d.js`) loads a **real CC0 human base**
(`public/models/human-base.glb`, Quaternius — see `public/models/CREDITS.md`) and adds the hockey gear
(helmet, gloves, stick, number) as its own geometry, recolored by the kit. If the .glb is missing or
fails to load, it falls back silently to a **procedural model** built from three.js geometry, so the
feature always works. You do **not** need Blender.

## Swapping the base model
The loaded path is `MODEL_URL` in `locker-3d.js` (`/models/human-base.glb`). To use a different hand-made
model, either overwrite that file or point `MODEL_URL` at a new one. The gear is added in code, so the
base only needs to be a standing human; name any materials you want recolored per the contract below.
On any load error the viewer silently uses the procedural player.

## Recolor contract (material names)
`recolor(kit)` sets `material.color` on materials matched **by name**. Name your materials exactly:

| Material name | Gets the kit color | Notes |
|---------------|--------------------|-------|
| `MAT_JERSEY`  | `kit.jersey`       | shirt, sleeves, socks |
| `MAT_HELMET`  | `kit.helmet`       | helmet shell |
| `MAT_GLOVES`  | `kit.gloves`       | both gloves |
| `MAT_STICK`   | `kit.stick`        | shaft + blade |
| `MAT_TAPE`    | `kit.tape`         | tape wrap / knob |
| `MAT_VISOR`   | `kit.visor`        | keep it transparent (opacity ~0.45) |
| `MAT_SHORTS`  | `kit.shorts`       | pants |
| `MAT_SKATES`  | (none)             | stays its own dark color; kit has no skate slot |
| `MAT_NUMBER`  | (texture)          | the jersey number is injected as a texture — see below |

- Anything you do **not** want recolored (skin, blade steel, eyes) just give any other name.
- Multiple meshes may share a named material; all of them recolor together.

## Jersey number (`MAT_NUMBER`)
The number comes from a canvas texture generated at runtime (`kit.num`, auto-contrast vs jersey).
Two ways to receive it:
1. **Easiest:** make a flat plane on the chest (and one on the back) with a material named `MAT_NUMBER`.
   The viewer sets `material.map` to the number texture automatically. UV-map the plane 0..1 so the
   number fills it. Back plane: mirror its X so the number reads correctly from behind.
2. Or bake your own number — but then it won't change with `kit.num`, so prefer option 1.

## Export settings (glTF 2.0 binary)
- Format: **.glb** (glTF 2.0 binary, single file).
- Up axis: **Y-up**.
- Height: **~1.8 units** tall (the viewer rescales defensively, but author near 1.8).
- Origin: **centered at origin, feet at y = 0** (standing on the ice plane).
- **Apply all transforms** (scale/rotation) before export.
- Target size: **≤ ~200 KB** (low-poly; the viewer is a small locker preview, not a hero render).
- Materials: PBR metallic-roughness, named exactly as the table above.
- Pose: standing, holding the stick with the blade resting on the ice (matches the procedural model).

## Testing a dropped model
1. Put the file at `public/models/player.glb`.
2. Open the locker, click the **3D** toggle.
3. Change a jersey/helmet/glove swatch — the model should recolor live.
4. If nothing shows or colors don't change, check your material names against the table.
