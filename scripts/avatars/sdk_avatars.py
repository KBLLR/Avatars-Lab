import bpy
import sys
import os

# Get command line arguments
argv = sys.argv
argv = argv[argv.index("--") + 1:]  # get all args after "--"

if len(argv) < 1:
    print("Usage: blender --background --python sdk_avatars.py -- <input_file.glb>")
    sys.exit(1)

input_file = argv[0]
print(f"🎭 Processing SDK avatar: {input_file}")

# Shape key maps for Avatar SDK
shapekeyMap = [
    [ "sil", "viseme_sil" ], [ "PP", "viseme_PP" ], [ "FF", "viseme_FF" ],
    [ "TH", "viseme_TH" ], [ "DD", "viseme_DD" ], [ "kk", "viseme_kk" ],
    [ "CH", "viseme_CH" ], [ "SS", "viseme_SS" ], [ "nn", "viseme_nn" ],
    [ "RR", "viseme_RR" ], [ "aa", "viseme_aa" ], [ "E", "viseme_E" ],
    [ "ih", "viseme_I" ], [ "oh", "viseme_O" ], [ "ou", "viseme_U" ],
]

# Recursive traverse
def traverse(x):
    yield x
    if hasattr(x, 'children'):
        for c in x.children:
            yield from traverse(c)

# Has shape keys
def hasShapekeys(x):
    return hasattr(x, 'data') and hasattr(x.data, 'shape_keys') and hasattr(x.data.shape_keys, 'key_blocks')

# Clear existing scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Import GLB file
try:
    bpy.ops.import_scene.gltf(filepath=input_file)
    print("✅ Successfully imported GLB file")
except Exception as e:
    print(f"❌ Failed to import GLB file: {e}")
    sys.exit(1)

# Rename avatar root
idx = bpy.context.scene.objects.find("AvatarRoot")
if idx != -1:
    bpy.context.scene.objects[idx].name = "Armature"
    print("✅ Renamed AvatarRoot to Armature")

# Normalize (Apply Transforms)
armature = bpy.data.objects.get("Armature")
if armature:
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print("✅ Applied transforms to Armature")

# Rename shape keys
shape_keys_processed = 0
for r in bpy.context.scene.objects:
    for o in traverse(r):
        if hasShapekeys(o):
            keys = o.data.shape_keys.key_blocks
            for m in shapekeyMap:
                idx = keys.find(m[0])
                if idx != -1:
                    keys[idx].name = m[1]
                    shape_keys_processed += 1
                    print(f"✅ Renamed shape key: {m[0]} -> {m[1]}")

print(f"✅ Processed {shape_keys_processed} shape keys")

# Export GLB file
try:
    bpy.ops.export_scene.gltf(filepath=input_file, export_format='GLB')
    print("✅ Successfully exported adapted GLB file")
except Exception as e:
    print(f"❌ Failed to export GLB file: {e}")
    sys.exit(1)

print("🎉 SDK avatar adaptation complete!")
