"""Run with Python to check the delivered GLBs without an engine or Blender."""
import json, math, struct
from itertools import product
from pathlib import Path
ROOT=Path(__file__).parent
def identity():return [[int(i==j) for j in range(4)] for i in range(4)]
def mul(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def local(n):
    if 'matrix' in n:return [[n['matrix'][j*4+i] for j in range(4)] for i in range(4)]
    x,y,z,w=n.get('rotation',[0,0,0,1]);s=n.get('scale',[1,1,1]);t=n.get('translation',[0,0,0])
    a=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0],[0,0,0,1]]
    for i in range(3):
        for j in range(3):a[i][j]*=s[j]
        a[i][3]=t[i]
    return a
manifest=json.loads((ROOT/'asset-manifest.json').read_text())
results=[]
for record in manifest['assets']:
    path=ROOT/record['file'];b=path.read_bytes()
    magic,version,length=struct.unpack_from('<III',b)
    assert magic==0x46546C67 and version==2 and length==len(b)
    count=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+count]);binary=b[28+count:]
    roots=g['scenes'][g.get('scene',0)]['nodes'];assert len(roots)==1 and not g.get('animations')
    assert g['nodes'][roots[0]].get('translation',[0,0,0])==[0,0,0]
    points=[];triangles=0
    def walk(i,parent):
        global triangles
        node=g['nodes'][i];m=mul(parent,local(node))
        if 'mesh' in node:
            for primitive in g['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode',4)==4
                a=g['accessors'][primitive['attributes']['POSITION']]
                triangles+=g['accessors'][primitive['indices']]['count']//3
                for p in product(*zip(a['min'],a['max'])):
                    points.append([sum(m[row][k]*p[k] for k in range(3))+m[row][3] for row in range(3)])
                if g.get('images'):assert 'TEXCOORD_0' in primitive['attributes'] or len(g['materials'])>1
        for child in node.get('children',[]):walk(child,m)
    walk(roots[0],identity())
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    size=[hi[i]-lo[i] for i in range(3)]
    assert all(math.isfinite(v) for p in points for v in p)
    assert triangles==record['triangles'],(path.name,triangles,record['triangles'])
    if record['name'].startswith('tile-') and record['type']=='block':assert all(abs(v-1)<.00001 for v in size)
    if record['type']=='face':assert size[0]<=1.01 and size[2]<=1.01 and lo[1]>=-.001 and hi[1]<.36
    for image in g.get('images',[]):
        view=g['bufferViews'][image['bufferView']];offset=view.get('byteOffset',0)
        assert binary[offset:offset+8]==b'\x89PNG\r\n\x1a\n'
        assert struct.unpack_from('>II',binary,offset+16)==(1024,1024)
    results.append({'asset':path.name,'triangles':triangles,'size':[round(v,5) for v in size],'embedded_textures':len(g.get('images',[]))})
(ROOT/'validation.json').write_text(json.dumps({'passed':True,'assets':results},indent=2)+'\n')
print(f'PASS: {len(results)} GLBs; centred roots, mesh bounds, triangle counts and embedded texture dimensions verified.')
