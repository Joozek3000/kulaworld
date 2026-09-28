"""Blender authoring source for environment kit v02. Run inside Blender; no game code."""
import bpy, math, os, json
from mathutils import Vector, Quaternion
OUT = r'C:\projects\kulaworld\assets\models\environment-kit-v02'
os.makedirs(OUT + '/textures', exist_ok=True)
scene = bpy.data.scenes.new('Environment Kit 02')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.bake.margin = 12
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
assets, bake_jobs = [], []

def rgba(h):
    a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)

def material(name, color, rough=.35, metal=0, emission=0):
    m=bpy.data.materials.new('ENV02 / '+name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=rgba(color)
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metal
    p.inputs['Coat Weight'].default_value=.25 if rough<.4 else 0
    if emission:
        p.inputs['Emission Color'].default_value=rgba(color)
        p.inputs['Emission Strength'].default_value=emission
    m.diffuse_color=rgba(color)
    return m

ivory=material('ivory enamel','F4E9D2',.22)
ink=material('plum graphite','262537',.4,.15)
gold=material('direction gold','FFD05B',.3,.15)
coral=material('boost coral','F27B61',.28)
violet=material('high boost violet','8271D0',.26)
danger=material('hazard red','F54B36',.3,0,.35)
amber=material('retracted amber','E7B254',.36)
frost=material('frost etching','CFF9FF',.3,0,.12)
ember=material('ember inlay','FF6639',.38,0,2.2)
crack=material('fracture shadow','524133',.85)

def root(name, kind, description):
    r=bpy.data.objects.new(name,None); scene.collection.objects.link(r)
    r['asset_type']=kind; r['description']=description
    r['up_axis']='Blender +Z / glTF +Y'
    if kind=='face': r['forward_axis']='Blender -Y / glTF +Z'
    assets.append(r); return r

def attach(o,name,mat,parent):
    o.name=name
    if mat: o.data.materials.append(mat)
    if parent: o.parent=parent
    return o

def cube(name,loc,size,mat,parent,bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=attach(bpy.context.object,name,mat,parent); o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('soft manufactured edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('face weighted normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def cylinder(name,loc,radius,depth,mat,parent,vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=attach(bpy.context.object,name,mat,parent)
    mod=o.modifiers.new('edge bevel','BEVEL'); mod.width=.008; mod.segments=2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def torus(name,loc,radius,tube,mat,parent):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=tube,major_segments=32,minor_segments=8,location=loc)
    o=attach(bpy.context.object,name,mat,parent)
    for p in o.data.polygons:p.use_smooth=True
    return o

def line(name,a,b,width,mat,parent,depth=None):
    a,b=Vector(a),Vector(b); d=b-a
    o=cube(name,(a+b)/2,(width,width,d.length),mat,parent,min(.004,width/4))
    o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y')
    if depth:
        axis=max(range(3),key=lambda i:abs(o.rotation_quaternion.to_matrix()[2][i]))
        o.scale[axis]=depth/width
    return o

def face(parent,normal,index):
    f=bpy.data.objects.new('face-'+str(index),None);scene.collection.objects.link(f);f.parent=parent
    n=Vector(normal);f.location=n*.501;f.rotation_mode='QUATERNION'
    f.rotation_quaternion=Vector((0,0,1)).rotation_difference(n)
    return f

def texture_material(name,c1,c2,rough,scale,bump,style='grain'):
    m=material(name,c1,rough); n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    tex=n.new('ShaderNodeTexCoord'); noise=n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=scale;noise.inputs['Detail'].default_value=3
    l.new(tex.outputs['Generated'],noise.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB');ramp.label='native procedural colour master'
    ramp.color_ramp.elements[0].position=.25;ramp.color_ramp.elements[0].color=rgba(c1)
    ramp.color_ramp.elements[1].position=.75;ramp.color_ramp.elements[1].color=rgba(c2)
    l.new(noise.outputs['Fac'],ramp.inputs[0])
    height=noise.outputs['Fac']
    if style in ('cracked','frost'):
        vor=n.new('ShaderNodeTexVoronoi');vor.feature='DISTANCE_TO_EDGE'
        vor.inputs['Scale'].default_value=4.5 if style=='cracked' else 6
        l.new(tex.outputs['Generated'],vor.inputs['Vector'])
        vr=n.new('ShaderNodeValToRGB');vr.color_ramp.elements[0].position=.009
        vr.color_ramp.elements[0].color=rgba('514437' if style=='cracked' else 'DAF9FF')
        vr.color_ramp.elements[1].position=.026 if style=='cracked' else .018
        vr.color_ramp.elements[1].color=rgba(c2)
        l.new(vor.outputs['Distance'],vr.inputs[0]);colorout=vr.outputs['Color'];height=vor.outputs['Distance']
    else:colorout=ramp.outputs['Color']
    l.new(colorout,p.inputs['Base Color'])
    r=n.new('ShaderNodeMapRange');r.inputs['To Min'].default_value=max(.04,rough-.11);r.inputs['To Max'].default_value=min(1,rough+.1)
    l.new(noise.outputs['Fac'],r.inputs['Value']);l.new(r.outputs['Result'],p.inputs['Roughness'])
    b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.25;b.inputs['Distance'].default_value=bump
    l.new(height,b.inputs['Height']);l.new(b.outputs['Normal'],p.inputs['Normal'])
    return m

base_specs=[
 ('tile-celadon','celadon glaze','599C89','9EC5AE',.24,105,.012),
 ('tile-limestone','warm limestone','B7A78A','E7DDC4',.77,65,.022),
 ('tile-basalt','ink basalt','343747','525569',.67,85,.028),
 ('tile-terracotta','fired terracotta','B96D51','D99474',.64,55,.021),
]
for name,label,c1,c2,rough,scale,bump in base_specs:
    m=texture_material(label,c1,c2,rough,scale,bump)
    r=root(name,'block','Decorative base tile; material has no gameplay effect.')
    o=cube(name+'-mesh',(0,0,0),(1,1,1),m,r)
    bake_jobs.append((o,m,name))

m=texture_material('frosted ice','7EBFCC','BDE7ED',.09,42,.007,'frost')
r=root('block-ice','block','Whole-block ice; opaque frosted glaze avoids transparency sorting.')
o=cube('ice-core',(0,0,0),(1,1,1),m,r);bake_jobs.append((o,m,'block-ice'))
normals=[(0,0,1),(0,0,-1),(1,0,0),(-1,0,0),(0,1,0),(0,-1,0)]
for i,n in enumerate(normals):
    f=face(r,n,i)
    for j in range(3):
        a=j*math.pi/3
        line('frost-line',(-.22*math.cos(a),-.22*math.sin(a),.003),(.22*math.cos(a),.22*math.sin(a),.003),.018,frost,f)

m=texture_material('kiln fired fire block','682E29','AF4A31',.55,48,.018)
r=root('block-fire','block','Whole-block fire. Glowing X marks all six faces; no extra rules implied.')
o=cube('kiln-core',(0,0,0),(1,1,1),m,r);bake_jobs.append((o,m,'block-fire'))
for i,n in enumerate(normals):
    f=face(r,n,i)
    for a in [math.pi/4,-math.pi/4]:
        d=Vector((math.cos(a)*.32,math.sin(a)*.32,0))
        line('fire-X-recess',(-d.x,-d.y,.002),(d.x,d.y,.002),.085,ink,f,depth=.018)
        line('fire-X-emissive',(-d.x,-d.y,.017),(d.x,d.y,.017),.042,ember,f,depth=.008)

m=texture_material('fractured biscuit','D2BC91','E8D6AD',.76,32,.015,'cracked')
r=root('block-crumble','block','Whole-block crumble with a connected fracture network.')
o=cube('crumble-core',(0,0,0),(1,1,1),m,r);bake_jobs.append((o,m,'block-crumble'))
r=root('block-crumble-fragments','fragments','Eight named fragments for the existing crumble event; no collision changes.')
for x in [-1,1]:
 for y in [-1,1]:
  for z in [-1,1]:
    cube('shard-'+str((x,y,z)),(x*.25,y*.25,z*.25),(.488,.488,.488),material('biscuit fragment '+str((x,y,z)),'D9C69F',.8),r,.012)

for raised in [True,False]:
    r=root('trap-spikes-'+('raised' if raised else 'retracted'),'face','Retractable four-spike assembly. Animate spikes separately along local normal.')
    cube('socket-plate',(0,0,.018),(.83,.83,.036),ink,r,.024)
    for x in [-.21,.21]:
      for y in [-.21,.21]:
        cylinder('dark-socket',(x,y,.039),.104,.01,ink,r,24)
        torus('socket-rim',(x,y,.044),.099,.009,ivory,r)
        bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=.082,radius2=.006,depth=.29 if raised else .012,location=(x,y,.19 if raised else .044))
        attach(bpy.context.object,'spike-'+str((x,y)),ivory,r)
    for y in [-.356,.356]:
      for x in [-.25,0,.25]:cube('state-strip',(x,y,.043),(.13,.028,.012),danger if raised else amber,r,.004)

def polygon(name,points,z,depth,mat,parent):
    count=len(points);verts=[(x,y,z+d) for d in (0,depth) for x,y in points]
    faces=[tuple(reversed(range(count))),tuple(range(count,count*2))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);attach(o,name,mat,parent)
    return o

r=root('tile-arrow','face','Single gold arrow. Local glTF +Z points along the allowed direction.')
cube('arrow-base',(0,0,.018),(.79,.83,.036),ink,r,.045)
arrow=[(0,-.33),(.255,-.03),(.09,-.03),(.09,.29),(-.09,.29),(-.09,-.03),(-.255,-.03)]
polygon('direction-arrow',arrow,.038,.022,gold,r)
for x in [-.34,.34]:cube('ivory-side-rail',(x,0,.042),(.023,.64,.012),ivory,r,.006)

for high in [False,True]:
    r=root('pad-boost-'+('high' if high else 'far'),'face','High: 2 forward + 1 up.' if high else 'Far: 3 forward. Local glTF +Z is launch direction.')
    cylinder('pad-base',(0,0,.023),.41,.046,ink,r)
    cylinder('pad-enamel',(0,0,.05),.365,.022,violet if high else coral,r)
    torus('charge-ring',(0,0,.06),.377,.012,gold,r)
    count=2 if high else 3
    for j in range(count):
      y=(j-(count-1)/2)*.18
      points=[(0,y-.095),(.13,y+.035),(.07,y+.035),(0,y-.033),(-.07,y+.035),(-.13,y+.035)]
      polygon('chevron-'+str(j),points,.065,.018,gold,r)
    if high:
      for x in [-.27,.27]:
        for j in range(3):cube('height-step',(x,.13-j*.09,.069+j*.014),(.065,.055,.016),ivory,r,.006)
    else:
      for x in [-.26,.26]:cube('speed-rail',(x,0,.065),(.025,.38,.012),ivory,r,.004)

# Bake onto each block's UV atlas before arranging the presentation scene.
for o,m,name in bake_jobs:
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.035)
    bpy.ops.object.mode_set(mode='OBJECT')
state={'scene':scene,'assets':assets,'jobs':bake_jobs,'done':[],'out':OUT,'rgba':rgba}
bpy.app.driver_namespace['environment02']=state

def bake_one():
    o,m,name=state['jobs'].pop(0)
    bpy.context.window.scene=scene
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    source=m.copy();source.name=m.name+' [procedural master]';source.use_fake_user=True
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');output=n.get('Material Output')
    maps={}
    for kind in ['basecolor','roughness','normal']:
        im=bpy.data.images.new(name+'-'+kind,width=1024,height=1024,alpha=False)
        im.colorspace_settings.name='sRGB' if kind=='basecolor' else 'Non-Color'
        target=n.new('ShaderNodeTexImage');target.image=im;n.active=target
        if kind=='normal':
            l.new(p.outputs[0],output.inputs['Surface'])
            bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',use_clear=True)
        else:
            e=n.new('ShaderNodeEmission');socket=p.inputs['Base Color' if kind=='basecolor' else 'Roughness']
            l.new(socket.links[0].from_socket,e.inputs['Color']);l.new(e.outputs[0],output.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT',use_clear=True);n.remove(e)
        im.filepath_raw=OUT+'/textures/'+name+'-'+kind+'.png';im.file_format='PNG';im.save();im.pack()
        maps[kind]=im
        n.remove(target)
    n.clear();p=n.new('ShaderNodeBsdfPrincipled');output=n.new('ShaderNodeOutputMaterial');l.new(p.outputs[0],output.inputs[0])
    p.inputs['Coat Weight'].default_value=.3 if 'celadon' in name or 'ice' in name else 0
    for kind in ['basecolor','roughness','normal']:
        t=n.new('ShaderNodeTexImage');t.image=maps[kind];t.label=kind
        if kind=='normal':
            nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.18 if name=='tile-celadon' else 1
            l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal'])
        else:l.new(t.outputs['Color'],p.inputs['Base Color' if kind=='basecolor' else 'Roughness'])
    state['done'].append(name)
    return name
state['bake_one']=bake_one
result={'assets':len(assets),'texture_sets_to_bake':len(bake_jobs),'scene':scene.name}
