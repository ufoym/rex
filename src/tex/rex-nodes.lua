-- Rex node visitor: one coordinate stack for page capture and compact live output.
-- Positions are TeX scaled points. Glue is rounded cumulatively, as in TeX's PDF backend.
local Nodes={}
local J=dofile(kpse.find_file('rex-json.lua','lua'))
local D=node.direct
local id,list,field=D.getid,D.getlist,D.getfield
local whd,shift,attribute=D.getwhd,D.getshift,D.getattribute or D.get_attribute
local isglyph,getwidth,getexpansion,getoffsets,getsubtype=D.is_glyph,D.getwidth,D.getexpansion,D.getoffsets,D.getsubtype
local getglue,getkern,getdisc,getleader=D.getglue,D.getkern,D.getdisc,D.getleader
local ids={}; for number,name in pairs(node.types()) do ids[name]=number end
local glyphID,hlistID,vlistID,glueID,kernID,ruleID,discID,mathID,whatsitID,insID,dirID,local_parID,penaltyID,markID,boundaryID,margin_kernID=ids.glyph,ids.hlist,ids.vlist,ids.glue,ids.kern,ids.rule,ids.disc,ids.math,ids.whatsit,ids.ins,ids.dir,ids.local_par,ids.penalty,ids.mark,ids.boundary,ids.margin_kern
local whats=node.whatsits()
local hlistKinds=node.subtypes('hlist')
local pack,concat=string.pack,table.concat
local glyphFormats={}
local function glyphFormat(count)
  local format=glyphFormats[count]
  if not format then format='<'..string.rep('I4I4i4i4',count); glyphFormats[count]=format end
  return format
end
local function packedGlyphs(values,count)
  if count<=512 then return pack(glyphFormat(count//4),table.unpack(values,1,count)) end
  local chunks={}
  for first=1,count,512 do
    local last=math.min(first+511,count)
    chunks[#chunks+1]=pack(glyphFormat((last-first+1)//4),table.unpack(values,first,last))
  end
  return concat(chunks)
end
local function round(n) return n<0 and math.ceil(n-0.5) or math.floor(n+0.5) end
local function expanded(w,e) return w+round(w*e/1000000) end
local function text(s) return pack('<s2',tostring(s or '')) end
local fontdata={}
local formats={opentype=1,truetype=2,type1=3,type3=4}
local images={}
function Nodes.installImages(catcodes)
  rex_record_image=function(file,hash,page,box,decode)
    local index=tonumber((token.get_macro(file..' image'..hash) or ''):match('(%d+)'))
    if index then images[index]={file=kpse.find_file(file) or file,page=tonumber(page) or 1,pages=tex.lastsavedimageresourcepages or 1,
      unsupported=decode~='' or box~='' and box~='cropbox'} end
  end
  tex.sprint(catcodes,[[\ifdefined\Gread@@pdftex\let\rexReadImage\Gread@@pdftex\def\Gread@@pdftex#1{\rexReadImage{#1}\directlua{rex_record_image("\luaescapestring{#1}","\luaescapestring{\Gin@attr@hash}","\luaescapestring{\Gin@page}","\luaescapestring{\Gin@pagebox}","\luaescapestring{\Gin@decode}")}}\fi]])
end
local function fontinfo(number)
  if not fontdata[number] then
    local f=font.getfont(number) or {}
    local d={id=number,size=f.size or 0,subfont=f.subfont or 0,slant=f.slant or 0,extend=f.extend or 0,
      squeeze=f.squeeze or 0,designsize=f.designsize or 0,filename=f.filename,name=f.name,
      fullname=f.fullname,psname=f.psname,format=f.format,type=f.type}
    fontdata[number]={description=d,raw=f,characters=f.characters or {},virtual=f.type=='virtual'}
  end
  return fontdata[number]
end
local ignored={pdf_start_link=true,pdf_end_link=true,pdf_dest=true,pdf_annot=true,pdf_thread=true,
  pdf_start_thread=true,pdf_end_thread=true,pdf_action=true,pdf_link_data=true,
  open=true,write=true,close=true,save_pos=true,late_lua=true,user_defined=true}
local Visitor={}
Visitor.__index=Visitor
local function visitor(options)
  local v={fonts={},lines={},other={},flags={},glyphs=0,images=0,imageinfo={},inserts=0,pics={},options=options}
  if options.binary then v.bytes={}; v.runs={}; v.runCount=0; v.runVersion=0 end
  return setmetatable(v,Visitor)
end
function Visitor:record(tag,payload) self.bytes[#self.bytes+1]=pack('<Bs4',tag,payload) end
function Visitor:flush()
  self.runVersion=self.runVersion+1
  if self.runCount==0 then return end
  self:record(32,pack('<I4i4i4I4',self.runfont,self.runy,self.runexp,self.runCount//4)..packedGlyphs(self.runs,self.runCount))
  self.runCount=0
end
function Visitor:flag(name) self.flags[name]=(self.flags[name] or 0)+1 end
function Visitor:item(a)
  if not self.bytes then
    local out=self.current and self.current.items or self.other; out[#out+1]=a
    return
  end
  self:flush()
  local tag=a[1]
  if tag=='r' then self:record(33,pack('<i4i4i4i4',table.unpack(a,2)))
  elseif tag=='c' then self:record(34,pack('<BBI2',a[3] or 0,0,a[2] or 0)..text(a[4]))
  elseif tag=='m' then self:record(37,pack('<Bi4',a[2]=='on' and 1 or 0,a[3]))
  elseif tag=='i' then self:record(38,pack('<i4i4i4i4i4',table.unpack(a,2)))
  elseif tag=='l' then self:record(35,pack('<i4',a[2])..text(a[3]))
  elseif tag=='M' then self:record(40,pack('<Bi4i4',({save=0,set=1,restore=2})[a[2]],a[3],a[4])..text(a[5]))
  else self:record(36,text(a[2])..text(a[3])) end
end
function Visitor:character(f,c,x,y,w,e)
  local info=fontinfo(f)
  self.fonts[tostring(f)]=info.description
  local glyph=info.characters[c] and info.characters[c].index
  self.glyphs=self.glyphs+1
  if self.bytes then
    if self.runfont~=f or self.runy~=y or self.runexp~=e then
      self:flush(); self.runfont,self.runy,self.runexp=f,y,e
    end
    local at=self.runCount
    self.runCount=at+4
    self.runs[at+1],self.runs[at+2],self.runs[at+3],self.runs[at+4]=c,glyph or 0xffffffff,x,w
  else self:item({'g',f,c,glyph or J.null,x,y,w,e}) end
end
function Visitor:openline(box,x,y,p,u)
  local w,h,d=whd(box)
  if self.bytes then
    self.lines[#self.lines+1]=true; self.current=true
    self:flush(); self:record(16,pack('<i4i4i4i4i4i4i4dBB',p or 0,#self.lines,x,y,w,h,d,
      field(box,'glue_set'),field(box,'glue_sign'),field(box,'glue_order')))
    return
  end
  local row={par=p or 0,i=self.options.line and attribute(box,self.options.line) or #self.lines+1,
    unit=u,x=x,y=y,w=w,h=h,d=d,items=J.array(),gs=field(box,'glue_set'),
    gsign=field(box,'glue_sign'),gorder=field(box,'glue_order')}
  self.lines[#self.lines+1]=row; self.current=row
end
function Visitor:closeline()
  if self.bytes then self:flush(); self:record(17,'') end
  self.current=nil
end
local function virtual(v,f,c,x,y,e,level)
  if level>16 then v:flag('virtual_depth'); return end
  local raw=fontinfo(f).raw; local char=raw.characters and raw.characters[c]
  if not char then v:flag('virtual_missing'); return end
  local commands=char.commands
  if not commands then v:character(f,c,x,y,expanded(char.width or 0,e),e); return end
  local stack={}; local selected=f
  for _,command in ipairs(commands) do
    local operation=command[1]
    if operation=='font' then local sub=raw.fonts and raw.fonts[command[2]]; selected=sub and sub.id or selected
    elseif operation=='char' or operation=='slot' then
      if operation=='slot' then local sub=raw.fonts and raw.fonts[command[2]]; selected=sub and sub.id or selected end
      local ch=command[operation=='slot' and 3 or 2]; local entry=fontinfo(selected)
      local width=expanded(entry.characters[ch] and entry.characters[ch].width or 0,e)
      if entry.raw.type=='virtual' then virtual(v,selected,ch,x,y,e,level+1) else v:character(selected,ch,x,y,width,e) end
      x=x+width
    elseif operation=='right' then x=x+round(command[2])
    elseif operation=='down' then y=y+round(command[2])
    elseif operation=='push' then stack[#stack+1]={x,y}
    elseif operation=='pop' then local xy=table.remove(stack); if xy then x,y=xy[1],xy[2] end
    elseif operation=='rule' then v:item({'r',x,y-command[2],command[3],command[2]}); x=x+command[3]
    elseif operation~='nop' then v:flag('virtual_'..operation) end
  end
end
local walk
local function special(v,n,x,y)
  local kind=whats[D.getsubtype(n)] or tostring(D.getsubtype(n))
  if kind=='pdf_colorstack' then v:item({'c',field(n,'stack'),field(n,'command'),field(n,'data')})
  elseif kind=='pdf_literal' or kind=='special' then
    v:item({'l',kind=='special' and -1 or field(n,'mode'),field(n,'data')}); v:flag(kind)
  elseif kind=='pdf_save' or kind=='pdf_restore' or kind=='pdf_setmatrix' then
    v:item({'M',({pdf_save='save',pdf_restore='restore',pdf_setmatrix='set'})[kind],x,y,field(n,'data') or ''})
  elseif not ignored[kind] then v:item({'u','whatsit',kind}); v:flag('whatsit_'..kind) end
end
local function rectangle(v,n,x,top,w,h)
  local subtype=getsubtype(n)
  if subtype==2 then
    local index=field(n,'index')
    v:item({'i',index,x,top,w,h}); v.images=v.images+1; v.imageinfo[tostring(index)]=images[index]
    if images[index] and images[index].unsupported then v:flag('image_options') end
  elseif subtype==3 then return
  elseif subtype==4 or subtype==9 then v:flag('rule_subtype'); v:item({'u','rule_subtype',subtype})
  elseif w>0 and h>0 then v:item({'r',x,top,w,h}) end
end
local function picture(v,n,x,y,w,h,d,inside)
  if inside or not v.options.picture then return false end
  local key=attribute(n,v.options.picture)
  if not key or key<0 then return false end
  -- An implicit paragraph indent inherits the picture attribute, but belongs to the paragraph.
  -- Including it in the crop would apply that indent a second time when the PDF is reused.
  if id(n)==hlistID and hlistKinds[getsubtype(n)]=='indent' then return false end
  local found=v.pics[key]
  if not found then v.pics[key]={id=key,x=x,y=y,w=w,h=h,d=d}
  elseif found.y~=y then found.multi=true
  else
    local right=math.max(found.x+found.w,x+w); found.x=math.min(found.x,x); found.w=right-found.x
    found.h=math.max(found.h,h); found.d=math.max(found.d,d)
  end
  return true
end
local function leaders(v,leader,start,space,x,y,vertical,subtype,origin,inside)
  if not leader or space<=0 then return end
  local w,h,d=whd(leader)
  if id(leader)==ruleID then
    if vertical then if w==-1073741824 then w=v.boxwidth end; rectangle(v,leader,x,y,w,space)
    else
      if h==-1073741824 then h=v.boxheight end; if d==-1073741824 then d=v.boxdepth end
      rectangle(v,leader,x,y-h,space,h+d)
    end
    return
  end
  local step=vertical and h+d or w; if step<=0 then return end
  local endpos=start+space+10; local cursor,gap=start,0
  if subtype==100 then cursor=origin+math.ceil((start-origin)/step)*step
  else
    local count=(space+10)//step; local leftover=(space+10)%step
    if subtype==101 then cursor=cursor+leftover//2
    else gap=leftover//(count+1); cursor=cursor+(leftover-(count-1)*gap)//2 end
  end
  while cursor+step<=endpos do
    if vertical then walk(v,leader,x+shift(leader),cursor+(id(leader)==hlistID and h or 0),inside)
    else walk(v,leader,cursor,y+shift(leader)-(id(leader)==vlistID and h or 0),inside) end
    cursor=cursor+step+gap
  end
end
walk=function(v,box,x,y,inside)
  local vertical=id(box)==vlistID
  local bw,bh,bd=whd(box)
  local axis=vertical and y or x; local origin=axis
  local setting,sign,order=field(box,'glue_set'),field(box,'glue_sign'),field(box,'glue_order')
  local stretch,rounded=0,0
  local function glue(n)
    local width,plus,minus,po,mo=getglue(n); local previous=rounded
    if sign==1 and po==order then stretch=stretch+plus
    elseif sign==2 and mo==order then stretch=stretch-minus end
    rounded=round(math.max(-1e9,math.min(1e9,setting*stretch)))
    return width+rounded-previous
  end
  local pending; local iterator,head,current=D.traverse(list(box)); local n,kind=iterator(head,current); local lastfont,info
  local runs,runfont,runy,runexp=v.runs,v.runfont,v.runy,v.runexp
  local runVersion=v.runVersion
  local glyphcount=0
  local binary=v.bytes~=nil
  while n do
    if kind==glyphID then
      local c,f=isglyph(n); local e=getexpansion(n) or 0
      local ox,oy=getoffsets(n); local width=getwidth(n)
      if e~=0 then width=expanded(width,e) end
      if f~=lastfont then lastfont=f; info=fontinfo(f); v.fonts[tostring(f)]=info.description end
      if info.virtual then virtual(v,f,c,axis+ox,y-oy,e,0)
      else
        local character=info.characters[c]; local glyph=character and character.index
        glyphcount=glyphcount+1
        if binary then
          local baseline=y-oy
          if runVersion~=v.runVersion then runVersion=v.runVersion; runfont,runy,runexp=v.runfont,v.runy,v.runexp end
          if runfont~=f or runy~=baseline or runexp~=e then
            v:flush(); runVersion=v.runVersion; runfont,runy,runexp=f,baseline,e; v.runfont,v.runy,v.runexp=f,baseline,e
          end
          local at=v.runCount
          v.runCount=at+4
          runs[at+1],runs[at+2],runs[at+3],runs[at+4]=c,glyph or 0xffffffff,axis+ox,width
        else v:item({'g',f,c,glyph or J.null,axis+ox,y-oy,width,e}) end
      end
      axis=axis+width
    elseif kind==hlistID or kind==vlistID then
      local w,h,d=whd(n); local offset=shift(n)
      local px,py
      if vertical then px=x+offset; py=axis+h else px=axis; py=y+offset end
      local nested=picture(v,n,px,py,w,h,d,inside) or inside
      local p=v.options.par and attribute(n,v.options.par)
      local u=v.options.unit and attribute(n,v.options.unit)
      if u and u<0 then u=nil end
      local row=kind==hlistID and not v.current and (h~=0 or d~=0 or list(n)) and
        (v.options.binary and vertical or p and p>=0 or u)
      if row then v:openline(n,px,py,p,u) end
      walk(v,n,px,py-(kind==vlistID and h or 0),nested)
      if row then v:closeline() end
      axis=axis+(vertical and h+d or w)
    elseif kind==glueID then
      local width,plus,minus,po,mo=getglue(n); local previous=rounded
      if sign==1 and po==order then stretch=stretch+plus
      elseif sign==2 and mo==order then stretch=stretch-minus end
      local adjustment=setting*stretch
      if adjustment>1e9 then adjustment=1e9 elseif adjustment< -1e9 then adjustment=-1e9 end
      rounded=adjustment<0 and math.ceil(adjustment-0.5) or math.floor(adjustment+0.5)
      local space=width+rounded-previous
      if getsubtype(n)>=100 then
        v.boxwidth,v.boxheight,v.boxdepth=bw,bh,bd
        leaders(v,getleader(n),axis,space,vertical and x or axis,vertical and axis or y,vertical,getsubtype(n),origin,inside)
      end
      axis=axis+space
    elseif kind==kernID then axis=axis+getkern(n)+(vertical and 0 or getexpansion(n) or 0)
    elseif kind==margin_kernID then axis=axis+getwidth(n)
    elseif kind==ruleID then
      local w,h,d=whd(n)
      if w==-1073741824 then w=vertical and bw or 0 end
      if h==-1073741824 then h=vertical and 0 or bh end
      if d==-1073741824 then d=vertical and 0 or bd end
      rectangle(v,n,vertical and x or axis,vertical and axis or y-h,w,h+d)
      axis=axis+(vertical and h+d or w)
    elseif kind==discID then
      local _,_,replacement=getdisc(n)
      if replacement then
        pending=pending or {}; pending[#pending+1]={head,n}; head=replacement; n,kind=iterator(head,nil)
        goto continue
      end
    elseif kind==mathID then
      v:item({'m',getsubtype(n)==0 and 'on' or 'off',axis})
      local a,b,c=getglue(n)
      axis=axis+((a==0 and b==0 and c==0) and field(n,'surround') or glue(n))
    elseif kind==whatsitID then special(v,n,vertical and x or axis,vertical and axis or y)
    elseif kind==insID then v.inserts=v.inserts+1; if not v.options.binary then v:flag('ins') end
    elseif kind==dirID then
      local direction=field(n,'dir'); if direction~='TLT' and direction~='+TLT' and direction~='-TLT' then v:flag('dir') end
    elseif kind==local_parID then
      if (field(n,'box_left_width') or 0)~=0 or (field(n,'box_right_width') or 0)~=0 then v:flag('local_boxes') end
    elseif kind~=penaltyID and kind~=markID and kind~=boundaryID then v:flag('node_'..node.type(kind)) end
    n,kind=iterator(head,n)
    while not n and pending and #pending>0 do
      local parent=table.remove(pending); head=parent[1]; n,kind=iterator(head,parent[2])
    end
    ::continue::
  end
  v.glyphs=v.glyphs+glyphcount
end
function Nodes.page(box,number,attrs)
  local v=visitor(attrs); local b=D.todirect(box)
  local x,y=4736286+tex.hoffset,4736286+tex.voffset
  walk(v,b,x,y,false)
  local w,h,d=whd(b)
  return {kind='page',unit='sp',page=number,width=w,height=h,depth=d,
    page_width=tex.pagewidth,page_height=tex.pageheight,origin={x,y},fonts=v.fonts,
    lines=J.array(v.lines),other=J.array(v.other),flags=v.flags,glyphs=v.glyphs,
    images=v.images,images_info=v.imageinfo,inserts=v.inserts,pics=v.pics}
end
function Nodes.paragraph(box,color)
  local v=visitor({binary=true}); local b=D.todirect(box)
  if color and color~='' then v:item({'c',0,0,color}) end
  walk(v,b,0,0,false); v:flush()
  local w,h,d=whd(b)
  v:record(1,pack('<i4i4i4i4i4i4i4i4I4I4',w,h,d,0,0,0,0,v.inserts,v.glyphs,v.images))
  for _,desc in pairs(v.fonts) do
    local cached=fontdata[desc.id]
    if not cached.binary then cached.binary=pack('<I4i4BBI2i4i4i4i4',desc.id,round(desc.size),desc.type=='virtual' and 5 or formats[desc.format] or 0,
      0,desc.subfont,round(desc.slant),round(desc.extend),round(desc.squeeze),round(desc.designsize))..
      text(desc.filename)..text(desc.psname)..text(desc.name)..text(desc.fullname)..text(desc.format)
    end
    v:record(2,cached.binary)
  end
  for name,value in pairs(v.flags) do v:record(3,text(name)..pack('<i4',value)) end
  if v.images>0 then for index,image in pairs(v.imageinfo) do
    v:record(39,pack('<I4I4I4',tonumber(index),image.page,image.pages)..text(image.file))
  end end
  v:record(255,'')
  local body=concat(v.bytes)
  return pack('<c4I2I2I4I4','RTDL',1,0,16+#body,0)..body,v
end
return Nodes
