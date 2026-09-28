"""Native Blender worlds and panoramic cameras; original procedural skies."""
import bpy, math, os
from mathutils import Vector
OUT=r'C:\projects\kulaworld\assets\art\sky-pack-v02'
def rgba(h):
    a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)
specs=[
 {'id':'peach-dawn','label':'Peach Dawn','stops':[(0,'A39DBF'),(.36,'D5ADB8'),(.52,'F4CEB1'),(.71,'B9CADD'),(1,'739FBF')],'cloud':'FFF0DD','cloud_power':.44,'stretch':3.2,'sun':(.55,-.75,.35),'sun_color':(3.5,2.1,1.1,1),'stars':False,'key':'FFE0BE','fill':'B7D6EE','rim':'FFD6BD','key_watts':850,'fill_watts':550,'rim_watts':1000,'world_strength':.4,'exposure':0},
 {'id':'teal-moon','label':'Teal Moon','stops':[(0,'393957'),(.38,'385963'),(.51,'528C91'),(.7,'28465D'),(1,'16283E')],'cloud':'9DC0C1','cloud_power':.22,'stretch':2.0,'sun':(-.5,-.4,.76),'sun_color':(2.2,2.8,3.4,1),'stars':True,'key':'B9DFED','fill':'ABC8CD','rim':'77D9C8','key_watts':700,'fill_watts':420,'rim_watts':1100,'world_strength':.65,'exposure':.3},
 {'id':'amber-afterglow','label':'Amber Afterglow','stops':[(0,'665578'),(.3,'B57084'),(.51,'F0B989'),(.67,'D79995'),(1,'6D78A4')],'cloud':'FFDCAD','cloud_power':.38,'stretch':5,'sun':(.85,.45,.1),'sun_color':(4.0,1.9,.6,1),'stars':False,'key':'FFD0A0','fill':'B4BEEA','rim':'FFAB78','key_watts':900,'fill_watts':600,'rim_watts':1100,'world_strength':.35,'exposure':0},
]
scenes=[]
for spec in specs:
 s=bpy.data.scenes.new('Sky / '+spec['label']);s.render.engine='CYCLES';s.cycles.samples=8
 s.render.resolution_x=4096;s.render.resolution_y=2048;s.render.resolution_percentage=100
 s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB'
 s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
 w=bpy.data.worlds.new('World / '+spec['label']);w.use_nodes=True;s.world=w
 n=w.node_tree.nodes;n.clear();l=w.node_tree.links
 def node(t,label):
  v=n.new(t);v.label=label;return v
 tc=node('ShaderNodeTexCoord','Seamless spherical direction')
 sep=node('ShaderNodeSeparateXYZ','World height');l.new(tc.outputs['Normal'],sep.inputs[0])
 height=node('ShaderNodeMapRange','Height -1..1 to 0..1');height.inputs['From Min'].default_value=-1;l.new(sep.outputs['Z'],height.inputs['Value'])
 gradient=node('ShaderNodeValToRGB','Sky palette');r=gradient.color_ramp;r.elements.remove(r.elements[1]);r.interpolation='EASE'
 for i,(pos,c) in enumerate(spec['stops']):
  e=r.elements[0] if i==0 else r.elements.new(pos);e.position=pos;e.color=rgba(c)
 l.new(height.outputs[0],gradient.inputs[0])
 stretch=node('ShaderNodeVectorMath','Cloud stretch');stretch.operation='MULTIPLY';stretch.inputs[1].default_value=(1,1,spec['stretch']);l.new(tc.outputs['Normal'],stretch.inputs[0])
 noise=node('ShaderNodeTexNoise','Cloud strata');noise.inputs['Scale'].default_value=3;noise.inputs['Detail'].default_value=4;noise.inputs['Roughness'].default_value=.6;l.new(stretch.outputs[0],noise.inputs['Vector'])
 mask=node('ShaderNodeValToRGB','Cloud density');mask.color_ramp.elements[0].position=.45;mask.color_ramp.elements[0].color=(0,0,0,1);mask.color_ramp.elements[1].position=.73;mask.color_ramp.elements[1].color=(spec['cloud_power'],)*3+(1,);l.new(noise.outputs['Fac'],mask.inputs[0])
 mix=node('ShaderNodeMixRGB','Cloud tint');mix.inputs[2].default_value=rgba(spec['cloud']);l.new(mask.outputs[0],mix.inputs[0]);l.new(gradient.outputs[0],mix.inputs[1]);last=mix.outputs[0]
 if spec['stars']:
  vor=node('ShaderNodeTexVoronoi','Fine distant stars');vor.inputs['Scale'].default_value=160;l.new(tc.outputs['Normal'],vor.inputs['Vector'])
  threshold=node('ShaderNodeMapRange','Star pinpoints');threshold.inputs['From Min'].default_value=.065;threshold.inputs['From Max'].default_value=0;threshold.inputs['To Max'].default_value=.9;l.new(vor.outputs['Distance'],threshold.inputs['Value'])
  stars=node('ShaderNodeMixRGB','Starlight');stars.inputs[2].default_value=(1.1,1.6,1.8,1);l.new(threshold.outputs[0],stars.inputs[0]);l.new(last,stars.inputs[1]);last=stars.outputs[0]
 dot=node('ShaderNodeVectorMath','Sun or moon direction');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=Vector(spec['sun']).normalized();l.new(tc.outputs['Normal'],dot.inputs[0])
 disc=node('ShaderNodeMapRange','Soft disc');disc.inputs['From Min'].default_value=.9982 if spec['stars'] else .994;disc.inputs['From Max'].default_value=.9991;l.new(dot.outputs['Value'],disc.inputs['Value'])
 sun=node('ShaderNodeMixRGB','Celestial glow');sun.inputs[2].default_value=spec['sun_color'];l.new(disc.outputs[0],sun.inputs[0]);l.new(last,sun.inputs[1])
 bg=node('ShaderNodeBackground','Environment');l.new(sun.outputs[0],bg.inputs['Color']);output=node('ShaderNodeOutputWorld','Output');l.new(bg.outputs[0],output.inputs[0])
 # World Normal points inward; invert it so +Z means sky above the horizon.
 connections=list(tc.outputs['Normal'].links)
 direction=node('ShaderNodeVectorMath','Outward sky direction');direction.operation='SCALE';direction.inputs[3].default_value=-1
 for link in connections:l.new(direction.outputs[0],link.to_socket)
 l.new(tc.outputs['Normal'],direction.inputs[0])
 for i,v in enumerate(n):v.location=((i%6)*210,-(i//6)*250)
 camera=bpy.data.cameras.new(spec['id']+' panorama');camera.type='PANO';camera.panorama_type='EQUIRECTANGULAR'
 obj=bpy.data.objects.new(camera.name,camera);s.collection.objects.link(obj);obj.rotation_euler=(math.pi/2,0,0);s.camera=obj
 s.render.filepath=OUT+'/'+spec['id']+'-4k.png';s['sky_id']=spec['id']
 scenes.append(s)
bpy.app.driver_namespace['skypack02']={'scenes':scenes,'specs':specs,'out':OUT,'rgba':rgba}
result={'skies':[s.name for s in scenes]}
