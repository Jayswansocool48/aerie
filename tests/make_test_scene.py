"""Writes a small glTF (.glb) test scene like a Blender export: a ground, a few boxes, a spinning
cube, a camera, a sun lamp and an animation. Used to test the 3D scene wallpaper.

    python3 tests/make_test_scene.py out.glb
"""

import json
import math
import struct
import sys


def box(sx, sy, sz):
    """24 vertices (flat normals) and 36 indices for a box centred on the origin."""
    pos, nor, idx = [], [], []
    faces = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 1, 0), (0, 0, -1)),
             ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (0, 0, -1), (1, 0, 0)),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0))]
    for n, u, v in faces:
        base = len(pos)
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = [n[i] + a * u[i] + b * v[i] for i in range(3)]
            pos.append((p[0] * sx / 2, p[1] * sy / 2, p[2] * sz / 2))
            nor.append(n)
        # wind counter-clockwise when seen from outside
        if sum(n[i] * (u[(i + 1) % 3] * v[(i + 2) % 3] - u[(i + 2) % 3] * v[(i + 1) % 3]) for i in range(3)) > 0:
            idx += [base, base + 1, base + 2, base, base + 2, base + 3]
        else:
            idx += [base, base + 2, base + 1, base, base + 3, base + 2]
    return pos, nor, idx


def build():
    bin_ = bytearray()
    accessors, views = [], []

    def add(data, fmt, count, kind, comp, target=None, minmax=False, values=None):
        while len(bin_) % 4:
            bin_.append(0)
        start = len(bin_)
        for item in data:
            bin_.extend(struct.pack("<" + fmt, *(item if isinstance(item, (tuple, list)) else (item,))))
        view = {"buffer": 0, "byteOffset": start, "byteLength": len(bin_) - start}
        if target:
            view["target"] = target
        views.append(view)
        acc = {"bufferView": len(views) - 1, "componentType": comp, "count": count, "type": kind}
        if minmax:
            cols = list(zip(*[(v if isinstance(v, (tuple, list)) else (v,)) for v in data]))
            acc["min"] = [min(c) for c in cols]
            acc["max"] = [max(c) for c in cols]
        accessors.append(acc)
        return len(accessors) - 1

    meshes, materials = [], []

    def mesh(size, color, rough=0.6, emissive=None):
        pos, nor, idx = box(*size)
        p = add(pos, "fff", len(pos), "VEC3", 5126, 34962, minmax=True)
        n = add(nor, "fff", len(nor), "VEC3", 5126, 34962)
        i = add(idx, "H", len(idx), "SCALAR", 5123, 34963)
        mat = {"pbrMetallicRoughness": {"baseColorFactor": [*color, 1], "metallicFactor": 0, "roughnessFactor": rough}}
        if emissive:
            mat["emissiveFactor"] = emissive
        materials.append(mat)
        meshes.append({"primitives": [{"attributes": {"POSITION": p, "NORMAL": n}, "indices": i, "material": len(materials) - 1}]})
        return len(meshes) - 1

    ground = mesh((30, 0.2, 30), (0.35, 0.55, 0.42), 0.9)
    tower = mesh((1, 3, 1), (0.85, 0.5, 0.6))
    cube = mesh((1.2, 1.2, 1.2), (1.0, 0.75, 0.3), 0.3, emissive=[0.3, 0.15, 0.0])
    nodes = [
        {"name": "Ground", "mesh": ground, "translation": [0, -0.1, 0]},
        {"name": "Tower L", "mesh": tower, "translation": [-3, 1.5, -2]},
        {"name": "Tower R", "mesh": tower, "translation": [3.5, 1.5, -4]},
        {"name": "Spinner", "mesh": cube, "translation": [0, 1.4, 0]},
        {"name": "Camera", "camera": 0, "translation": [0, 3, 9], "rotation": [-0.12, 0, 0, 0.993]},
        {"name": "Sun", "extensions": {"KHR_lights_punctual": {"light": 0}}, "rotation": [-0.5, 0.3, 0.1, 0.8]},
    ]
    # the spinner turns once every 6 seconds (a seamless loop)
    times = [i * 0.5 for i in range(13)]
    rots = []
    for t in times:
        a = t / 6 * 2 * math.pi
        rots.append((0, math.sin(a / 2), 0, math.cos(a / 2)))
    t_acc = add(times, "f", len(times), "SCALAR", 5126, minmax=True)
    r_acc = add(rots, "ffff", len(rots), "VEC4", 5126)
    gltf = {
        "asset": {"version": "2.0", "generator": "Aerie test scene"},
        "extensionsUsed": ["KHR_lights_punctual"],
        "extensions": {"KHR_lights_punctual": {"lights": [{"type": "directional", "color": [1, 0.95, 0.85], "intensity": 3}]}},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes))), "extras": {"aerie_background": "#7fb2e6", "aerie_parallax": 1}}],
        "nodes": nodes, "meshes": meshes, "materials": materials,
        "cameras": [{"type": "perspective", "perspective": {"yfov": 0.7, "znear": 0.1, "zfar": 200, "aspectRatio": 1.7778}}],
        "animations": [{"name": "Spin", "channels": [{"sampler": 0, "target": {"node": 3, "path": "rotation"}}],
                        "samplers": [{"input": t_acc, "output": r_acc, "interpolation": "LINEAR"}]}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}],
    }
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    while len(bin_) % 4:
        bin_.append(0)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bin_), 0x004E4942) + bytes(bin_)
    return out


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "test-scene.glb"
    with open(path, "wb") as f:
        f.write(build())
    print(path)
