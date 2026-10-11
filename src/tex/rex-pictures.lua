-- Picture reuse is a document concern. Cached bodies are consumed by the Lua token scanner.
local Pictures={}; Pictures.__index=Pictures
local J=dofile(kpse.find_file('rex-json.lua','lua'))
local function readjson(path)
  local f=io.open(path,'r'); if not f then return {} end
  local s=f:read('*a'); f:close(); local ok,value=pcall(J.decode,s)
  return ok and value or {}
end
function Pictures.new(capture)
  return setmetatable({capture=capture,attribute=luatexbase.new_attribute('rex_picture'),
    entries=readjson((os.getenv('REX_CAPTURE_DIR') or '.')..'/pic-manifest.json'),
    seen={},sources={},images={},metadata={},count=0,hits=0,mismatches=J.array()},Pictures)
end
function Pictures:state()
  local f=font.getfont(font.current()) or {}
  local ok,width=pcall(tex.getdimen,'linewidth')
  return J.encode({f.name or '',f.size or 0,token.get_macro('current@color') or '',tex.hsize,ok and width or 0})
end
function Pictures:arm(name) self.armed=name end
function Pictures:begin(name)
  if self.armed~=name then tex.sprint(rex_capture.catcodes,'\\csname rexOriginal'..name..'\\endcsname'); return end
  self.armed=nil
  self.count=self.count+1
  local filename=(status.filename or ''):gsub('^%./',''); local key=filename..':'..tex.inputlineno
  local state=self:state()
  self.metadata[self.count]={key=key,env=name,state=state}
  local entry=self.entries[key]
  if not self.sources[filename] then
    local f=io.open(filename,'r'); local lines={}; if f then for line in f:lines() do lines[#lines+1]=line end; f:close() end
    self.sources[filename]=lines
  end
  local line=self.sources[filename][tex.inputlineno] or ''
  local marker='\\begin{'..name..'}'
  local reusable=entry and entry.env==name and entry.state==state and not self.seen[key] and
    line:match('^%s*(.*)'):sub(1,#marker)==marker and lfs.attributes(entry.pdf,'mode')=='file'
  if reusable then
    self.seen[key]=true
    local imagekey=entry.pdf..':'..entry.page..':'..table.concat(entry.bbox,',')
    local image=self.images[imagekey]
    if not image then image=img.scan(img.new{filename=entry.pdf,page=entry.page,bbox=entry.bbox}); self.images[imagekey]=image end
    -- Consume unexpanded tokens, including nested environments, through this picture's end.
    local depth=1; local consumed=0
    while depth>0 do
      local t=token.get_next(); consumed=consumed+1
      assert(t and consumed<2000000,'unterminated cached picture')
      if t.csname=='begin' or t.csname=='end' then
        local env=token.scan_argument(false)
        if env==name then depth=depth+(t.csname=='begin' and 1 or -1) end
      end
    end
    if entry.end_line and tex.inputlineno~=entry.end_line then self.mismatches[#self.mismatches+1]=key end
    self.pending={image=image,entry=entry}; self.hits=self.hits+1
    tex.sprint(rex_capture.catcodes,'\\expandafter\\let\\csname end'..name..'\\endcsname\\relax'..
      '\\leavevmode\\hbox{\\directlua{rex_capture.pictures:write()}}\\end{'..name..'}')
  else
    tex.setattribute(self.attribute,self.count)
    tex.sprint(rex_capture.catcodes,'\\csname rexOriginal'..name..'\\endcsname')
  end
end
function Pictures:write()
  local pending=self.pending; self.pending=nil; if not pending then return end
  local entry=pending.entry; local padding=entry.padding or 0
  local image=node.hpack(img.node(pending.image)); image.shift=entry.d+padding
  local kern=node.new('kern'); kern.kern=-padding; kern.next=image; image.prev=kern
  -- The border affects only PDF clipping; preserve the original TeX box and baseline exactly.
  local box=node.new('hlist'); box.width=entry.w; box.height=entry.h; box.depth=entry.d; box.list=kern
  node.write(box)
end
return Pictures
