# Model credits

All four player models come from one pack.

- Pack: Kenney "Mini Characters" 1.0 (created 2024-07-17)
- Author: Kenney (https://www.kenney.nl)
- Source page: https://kenney.nl/assets/mini-characters
- Licence: Creative Commons Zero (CC0 1.0), https://creativecommons.org/publicdomain/zero/1.0/ . Kenney's licence text is kept in `KENNEY-LICENSE.txt`. Credit is not required but is given here.
- Date checked: 2026-10-31 (licence on the source page and in the pack's `License.txt`)

| File | Original file in the pack | Used for |
|---|---|---|
| `marcel.glb` | `Models/GLB format/character-male-b.glb` (bald, bearded, hearing aid) | Marcel |
| `odette.glb` | `Models/GLB format/character-female-c.glb` (grey hair in a bun, headband) | Odette |
| `pierre.glb` | `Models/GLB format/character-male-f.glb` (black hair, green shirt) | Pierre |
| `you.glb` | `Models/GLB format/character-male-e.glb` (brown hair, glasses, white and orange) | You |

## Modifications

The only change is that the shared texture `Textures/colormap.png` (referenced by relative path in Kenney's GLB files) was embedded into each GLB's binary chunk, so each file is self-contained. Geometry, rig and animations are unchanged. All four files share the same 7-bone skeleton and the same animation clips.
