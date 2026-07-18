"""Split the original controller GLB into independently transformable meshes.

Run with Blender, not Python directly:
  Blender --background --python scripts/rig-controller.py
"""

import bpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public/assets/controller.glb"
OUTPUT = ROOT / "public/assets/controller-rigged.glb"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one fused mesh, found {len(meshes)}")

controller = meshes[0]
bpy.context.view_layer.objects.active = controller
controller.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")

parts = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
for index, obj in enumerate(parts):
    obj.name = f"controller_part_{index:03d}"
    obj.data.name = obj.name

print(f"Split controller into {len(parts)} independent mesh parts")
for obj in parts:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    center = sum(corners, Vector()) / 8
    size = (
        max(c.x for c in corners) - min(c.x for c in corners),
        max(c.y for c in corners) - min(c.y for c in corners),
        max(c.z for c in corners) - min(c.z for c in corners),
    )
    print(f"{obj.name} center={tuple(round(v, 4) for v in center)} size={tuple(round(v, 4) for v in size)}")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB", export_apply=True)
print(f"Wrote {OUTPUT}")
