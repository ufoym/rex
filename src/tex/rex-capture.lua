-- Rex's layout journal. Units own complete contexts; paragraph boxes carry stable IDs.
local State=dofile(kpse.find_file('rex-state.lua','lua'))
local Nodes=dofile(kpse.find_file('rex-nodes.lua','lua'))
local J=dofile(kpse.find_file('rex-json.lua','lua'))
local Pictures=dofile(kpse.find_file('rex-pictures.lua','lua'))
local Capture={units=J.array(),pages=J.array(),paragraphs=J.array(),stack={},begins={},depth=0}
Capture.attrs={unit=luatexbase.new_attribute('rex_unit'),par=luatexbase.new_attribute('rex_par'),line=luatexbase.new_attribute('rex_line')}
Capture.environments={'itemize','enumerate','description','quote','quotation','verse','center','flushleft',
  'flushright','figure','figure*','table','table*','abstract','tabbing','proof','verbatim','verbatim*',
  'lstlisting','Verbatim','alltt','spacing','thebibliography','tikzpicture','circuitikz','pgfpicture'}
for _,name in ipairs({'equation','equation*','align','align*','gather','gather*','multline','multline*','flalign','flalign*','alignat','alignat*'}) do
  Capture.environments[#Capture.environments+1]=name
end
Capture.headings={'part','chapter','section','subsection','subsubsection','paragraph','subparagraph'}
local unset=-0x7fffffff
function Capture.open(kind,name)
  local unit=State.snapshot(Capture.tracked)
  unit.uid=#Capture.units+1; unit.kind=kind; unit.name=name; unit.file=status.filename
  unit.begin_line=tex.inputlineno; unit.nest=tex.nest.ptr; unit.placements=J.array(); unit.seqs=J.array()
  Capture.units[#Capture.units+1]=unit; Capture.active=unit
  tex.setattribute('global',Capture.attrs.unit,unit.uid)
  return unit
end
function Capture.close()
  local unit=Capture.active; if not unit then return end
  unit.end_line=tex.inputlineno
  local advanced={}; for name,value in pairs(State.counters()) do
    if name~='page' and value~=unit.counters[name] then advanced[name]=value end
  end
  if next(advanced) then unit.advanced=advanced end
  Capture.active=nil; tex.setattribute('global',Capture.attrs.unit,unset)
  if tex.currentgrouplevel==Capture.outerlevel then Capture.outer=State.appearance() end
end
function Capture.parbegin()
  local nesting=tex.nest.ptr
  if nesting==1 and not Capture.output and not Capture.active then
    local unit=Capture.open('par')
    if tex.currentgrouplevel>Capture.outerlevel then unit.nfss=Capture.outer.nfss; unit.color=Capture.outer.color; unit.mathversion=Capture.outer.mathversion end
  end
  Capture.begins[nesting]={file=status.filename,line=tex.inputlineno}
end
function Capture.parend()
  if tex.nest.ptr==0 and Capture.depth==0 then Capture.close() end
  if Capture.pending and not Capture.active then local name=Capture.pending; Capture.pending=nil; Capture.open('heading',name) end
end
function Capture.env(name,begin)
  if begin then
    if Capture.active and Capture.active.kind=='heading' and tex.nest.ptr==0 then Capture.close() end
    if not Capture.active and tex.nest.ptr==0 then Capture.open('env',name) end
    Capture.depth=Capture.depth+1
  else
    Capture.depth=math.max(0,Capture.depth-1)
    if Capture.depth==0 and tex.nest.ptr==0 and Capture.active and Capture.active.kind=='env' then Capture.close() end
  end
end
function Capture.heading(name)
  if Capture.depth>0 then return end
  if Capture.active and Capture.active.kind=='par' and tex.nest.ptr>0 then Capture.pending=name; return end
  Capture.close(); Capture.open('heading',name)
end
function Capture.afterheading() if Capture.active and Capture.active.kind=='heading' then Capture.close() end end
function Capture.outputmode(enabled)
  Capture.output=enabled
  tex.setattribute('global',Capture.attrs.unit,enabled and unset or Capture.active and Capture.active.uid or unset)
end
function Capture.beforelines(head,group)
  local serial=#Capture.paragraphs+1; local begin=Capture.begins[tex.nest.ptr]
  Capture.begins[tex.nest.ptr]=nil
  local p={seq=serial,groupcode=group,file=status.filename,nest=tex.nest.ptr,
    begin=begin,end_line=tex.inputlineno,unit=not Capture.output and Capture.active and Capture.active.uid or nil}
  if p.unit then local u=Capture.units[p.unit]; u.seqs[#u.seqs+1]=serial end
  Capture.paragraphs[serial]=p; Capture.stack[#Capture.stack+1]=serial
  return true
end
function Capture.afterlines(head)
  local serial=table.remove(Capture.stack); local p=Capture.paragraphs[serial]
  if not p then return true end
  local index=0
  for n in node.traverse_id(node.id('hlist'),head) do
    index=index+1; node.set_attribute(n,Capture.attrs.par,serial); node.set_attribute(n,Capture.attrs.line,index)
    if p.unit then node.set_attribute(n,Capture.attrs.unit,p.unit) end
  end
  p.lines=index; return true
end
function Capture.ship(box)
  local page=Nodes.page(box,#Capture.pages+1,Capture.attrs)
  for _,row in ipairs(page.lines) do
    local unit=row.unit and Capture.units[row.unit]
    local paragraph=Capture.paragraphs[row.par]
    if paragraph and paragraph.groupcode=='insert' then row.unit=nil; unit=nil end
    if unit then
      row.row=#unit.placements+1
      unit.placements[row.row]={page=page.page,row=row.row,x=row.x,y=row.y,w=row.w,h=row.h,d=row.d,par=row.par,line=row.i}
    end
  end
  for _,region in pairs(page.pics) do
    local meta=Capture.pictures.metadata[region.id]
    if meta then
      if region.multi or Capture.pictureRegions[meta.key] then Capture.pictureRegions[meta.key]=nil; Capture.badPictures[meta.key]=true
      elseif not Capture.badPictures[meta.key] then
        Capture.pictureRegions[meta.key]={env=meta.env,state=meta.state,page=page.page,x=region.x,y=region.y,w=region.w,
          h=region.h,d=region.d,page_height=page.page_height}
      end
    end
  end
  page.pics=nil
  local rotation=tonumber((Capture.pageattr or ''):match('/Rotate%s*(%-?%d+)')) or 0
  if rotation%360~=0 then page.flags.page_rotate=1 end
  Capture.pages[#Capture.pages+1]=page
  return true
end
function Capture.start(catcodes)
  Capture.catcodes=catcodes
  Nodes.installImages(catcodes)
  Capture.tracked=State.discover({kpse.find_file('rex-preamble.tex'),kpse.find_file(tex.jobname..'.tex')})
  Capture.outer=State.appearance(); Capture.outerlevel=tex.currentgrouplevel
  Capture.pictures=Pictures.new(Capture); Capture.attrs.picture=Capture.pictures.attribute
  Capture.pictureRegions={}; Capture.badPictures={}
  luatexbase.add_to_callback('pre_linebreak_filter',Capture.beforelines,'rex.capture.before')
  luatexbase.add_to_callback('post_linebreak_filter',Capture.afterlines,'rex.capture.after')
  luatexbase.add_to_callback('pre_shipout_filter',Capture.ship,'rex.capture.page')
end
function Capture.finish()
  Capture.close()
  local directory=os.getenv('REX_CAPTURE_DIR') or os.getenv('TEXMF_OUTPUT_DIRECTORY') or '.'
  local function save(name,value)
    local f=assert(io.open(directory..'/'..name,'w')); f:write(J.encode(value)); f:close()
  end
  for _,unit in ipairs(Capture.units) do unit.rows=#unit.placements end
  save(tex.jobname..'.rex.json',{version=1,jobname=tex.jobname,pages=#Capture.pages,units=Capture.units,
    paragraphs=Capture.paragraphs,pics=Capture.pictureRegions,pic_hits=Capture.pictures.hits,pic_mismatch=Capture.pictures.mismatches})
  for number,page in ipairs(Capture.pages) do save(tex.jobname..'.rex-page'..number..'.json',page) end
end
return Capture
