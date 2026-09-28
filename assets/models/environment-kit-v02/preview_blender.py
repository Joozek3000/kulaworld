import bpy, math
from mathutils import Vector
env=bpy.app.driver_namespace['environment02'];skies=bpy.app.driver_namespace['skypack02']
assets={o.name:o for o in env['assets']};rgba=env['rgba']

def aim(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(scene,name,location,color,power,size,target=(0,0,0)):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=rgba(color)[:3];data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=location;aim(obj,target);return obj
def camera(scene,location,target,scale):
    data=bpy.data.cameras.new(scene.name+' camera');data.type='ORTHO';data.ortho_scale=scale
    obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);obj.location=location;aim(obj,target);scene.camera=obj
def setup(scene,width,height):
    scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='JPEG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.quality=94
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
def label(scene,text,loc,size=.14):
    data=bpy.data.curves.new(text,'FONT');data.body=text;data.align_x='CENTER';data.size=size;data.extrude=.0001
    obj=bpy.data.objects.new(text,data);scene.collection.objects.link(obj);obj.location=loc
    mat=bpy.data.materials.get('ENV02 label')
    if not mat:
        mat=bpy.data.materials.new('ENV02 label');mat.use_nodes=True;mat.diffuse_color=rgba('DCD6D2')
        mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=rgba('DCD6D2')
    data.materials.append(mat)
def duplicate(scene,source,parent=None):
    obj=source.copy();scene.collection.objects.link(obj);obj.parent=parent
    for child in source.children:duplicate(scene,child,obj)
    return obj
def box(scene,name,loc,size,color):
    bpy.context.window.scene=scene;bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=bpy.context.object;obj.name=name;obj.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mat=bpy.data.materials.new(name+' material');mat.use_nodes=True;mat.diffuse_color=rgba(color)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=rgba(color)
    obj.data.materials.append(mat);return obj

gallery=env['scene'];setup(gallery,2200,1600)
world=bpy.data.worlds.new('Gallery neutral');world.use_nodes=True
world.node_tree.nodes.get('Background').inputs[0].default_value=rgba('9AA5B7');world.node_tree.nodes.get('Background').inputs[1].default_value=.35;gallery.world=world
rows=[['tile-celadon','tile-limestone','tile-basalt','tile-terracotta'],['block-ice','block-fire','block-crumble','block-crumble-fragments'],['trap-spikes-raised','trap-spikes-retracted','tile-arrow','pad-boost-far','pad-boost-high']]
labels=[['CELADON GLAZE','LIMESTONE','INK BASALT','TERRACOTTA'],['ICE / FROST','FIRE / EMBER','CRUMBLE','CRUMBLE / SHARDS'],['SPIKES / UP','SPIKES / DOWN','ONE-WAY','BOOST / FAR','BOOST / HIGH']]
for row,names in enumerate(rows):
    for col,name in enumerate(names):
        x=(col-(len(names)-1)/2)*1.6;y=2.6-row*2.6
        root=assets[name];root.location=(x,y,0 if row<2 else -.27)
        if row==2:box(gallery,'display plinth '+name,(x,y,-.42),(1.02,1.02,.3),'697180')
        label(gallery,labels[row][col],(x,y-.78,-.49),.12)
box(gallery,'gallery floor',(0,0,-.57),(11,10,.08),'303543')
area(gallery,'Gallery key',(-3,-4,8),'FFF2D9',1700,7)
area(gallery,'Gallery fill',(5,1,5),'C2DAFF',1000,6)
camera(gallery,(4,-10,13),(0,0,0),11.6)
gallery.render.filepath=env['out']+'/previews/environment-kit-overview.jpg'

previews=[]
for spec,sky in zip(skies['specs'],skies['scenes']):
    scene=bpy.data.scenes.new('Lighting / '+spec['label']);setup(scene,1800,1200)
    scene.world=sky.world.copy();scene.world.name='Lighting world / '+spec['label']
    scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=spec['world_strength']
    scene.view_settings.exposure=spec['exposure']
    main={'peach-dawn':'tile-celadon','teal-moon':'tile-basalt','amber-afterglow':'tile-terracotta'}[spec['id']]
    cells=[(x,y,0) for x in range(-2,3) for y in range(-1,2)]
    cells += [(-2,2,0),(-2,3,0),(-1,3,0),(0,3,0),(1,3,0),(1,3,1)]
    special={(-2,0,0):'block-ice',(2,0,0):'block-fire',(-2,2,0):'block-crumble'}
    for x,y,z in cells:
        source=assets[special.get((x,y,z),main if (x+y)%2 else 'tile-limestone')]
        obj=duplicate(scene,source);obj.location=(x,y,z)
    for name,loc in [('trap-spikes-raised',(1,1,.5)),('pad-boost-far',(-1,0,.5)),('pad-boost-high',(0,3,.5)),('tile-arrow',(1,-1,.5))]:
        obj=duplicate(scene,assets[name]);obj.location=loc
    # A wall-facing arrow demonstrates the same face asset under a gravity flip.
    obj=duplicate(scene,assets['tile-arrow']);obj.location=(2,-1.5,0);obj.rotation_euler=(math.pi/2,0,0)
    ball=bpy.data.objects.get('ball-orange-bands')
    if ball:
        obj=duplicate(scene,ball);obj.location=(-1,-1,.9);obj.rotation_euler=(.35,.4,.2)
    area(scene,'Key / '+spec['id'],(-3,-4,7),spec['key'],spec['key_watts'],5)
    area(scene,'Fill / '+spec['id'],(5,-1,4),spec['fill'],spec['fill_watts'],5)
    area(scene,'Rim / '+spec['id'],(0,5,5),spec['rim'],spec['rim_watts'],4)
    camera(scene,(8,-11,9),(0,.7,0),8.5)
    scene.camera.data.type='PERSP';scene.camera.data.lens=65
    scene.render.filepath=env['out']+'/previews/'+spec['id']+'.jpg'
    scene['theme_id']=spec['id'];previews.append(scene)
env['previews']=previews
result={'gallery':gallery.name,'lighting_scenes':[s.name for s in previews]}
