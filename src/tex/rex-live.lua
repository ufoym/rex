-- Rex resident compiler. A grouped vbox is the transaction boundary for each request.
local State=dofile(kpse.find_file('rex-state.lua','lua'))
local Nodes=dofile(kpse.find_file('rex-nodes.lua','lua'))
local J=dofile(kpse.find_file('rex-json.lua','lua'))
local Live={contexts={}}
local now=os.gettimeofday or os.clock
local function maintainGC(job)
  if not job or not job.heap then return end
  local allocated=math.max(1,math.ceil(collectgarbage('count')-job.heap))
  collectgarbage('restart')
  -- Pay the allocation debt after sending the display list, before waiting for
  -- the next request. Bursts still wait for this work; ordinary typing can use
  -- the idle time instead of collecting while visiting its glyphs.
  collectgarbage('step',allocated)
end
local function answer(header,binary,json)
  json=json or J.encode(header)
  if binary then
    Live.output:write(string.pack('<I4BI4',5+#json+#binary,1,#json),json,binary)
  else Live.output:write(string.pack('<I4B',1+#json,0),json) end
  Live.output:flush()
end
function Live.init(box,continuation,catcodes)
  Live.box,Live.continuation,Live.catcodes=box,continuation,catcodes
  Live.input=assert(io.open(os.getenv('REX_REQ') or '/dev/stdin','rb'))
  Live.output=assert(io.open(os.getenv('REX_RESP') or '/dev/stdout','wb'))
  Nodes.installImages(catcodes)
  Live.fingerprint=State.fingerprint()
  Live.scratch={}; Live.counterBaseline=State.counters()
  local functions=lua.get_functions_table()
  for _,entry in ipairs({{'rexStep',Live.step},{'rexParameters',Live.parameters},{'rexResult',Live.result},{'rexCheck',Live.check}}) do
    local slot=luatexbase.new_luafunction('rex.'..entry[1])
    functions[slot]=entry[2]
    token.set_macro(entry[1],'\\luafunction'..slot..'\\relax','global')
  end
  answer({op='ready'})
end
function Live.parameters()
  local job=Live.current; State.apply(job.context)
  job.meanings={}
  for name in job.request.source:gmatch('\\([%a@]+)') do
    if job.meanings[name]==nil then job.meanings[name]=State.meaning(name) or false end
  end
  Live.started=now()
end
function Live.dispatch(request)
  if request.op=='context' then
    local context=request.ctx; context.tokens=State.prepare(context)
    -- Let TeX tokenize context replay once, using its regular scanner (including
    -- parameter tokens in nested definitions), rather than on every keystroke.
    local name='rex@context@'..request.id
    tex.print(Live.catcodes,'\\long\\expandafter\\gdef\\csname '..name..'\\endcsname{'..context.tokens:gsub('#','##')..'}')
    context.head='\\begingroup \\csname '..name..'\\endcsname \\setbox'..Live.box..'=\\vbox\\bgroup '
    Live.contexts[request.id]=context; answer({op='context',id=request.id})
  elseif request.op=='compile' then
    local context=assert(Live.contexts[request.ctx],'unknown context')
    Live.current={request=request,context=context,baseline=Live.counterBaseline,baselineMacros=context.baselineMacros}
    if collectgarbage('isrunning') then
      Live.current.heap=collectgarbage('count'); collectgarbage('stop')
    end
    local body=context.head..request.source..
      '\n\\par\\egroup\\rexResult\\endgroup\\rexCheck'
    local lines={}; for line in (body..'\n'):gmatch('(.-)\n') do lines[#lines+1]=line end
    tex.print(Live.catcodes,lines)
  elseif request.op=='labels' then
    for _,label in ipairs(request.labels or {}) do token.set_macro(label[1],label[2],'global') end
    answer({op='labels'})
  elseif request.op=='shutdown' then tex.setcount(Live.continuation,0); answer({op='bye'})
  elseif request.op=='ping' then answer({op='pong',heap_kib=collectgarbage('count')})
  else answer({op='error',message='unknown operation'}) end
end
function Live.result()
  local elapsed=now()-Live.started
  local job=Live.current; local changed={}
  for name,value in pairs(State.counters()) do
    if name~='page' and value~=(job.context.counters or {})[name] then changed[name]=value end
  end
  local began=now(); local bytes,dl=Nodes.paragraph(tex.box[Live.box],job.context.color)
  job.header={op='result',req=job.request.req,ctx=job.request.ctx,status=next(dl.flags) and 'ok_degraded' or 'ok',
    errors=J.array(),lines=#dl.lines,glyphs=dl.glyphs,t_tex_us=math.floor(elapsed*1e6+0.5),
    t_traverse_us=math.floor((now()-began)*1e6+0.5),t_pack_us=0,dl_bytes=#bytes}
  if next(changed) then job.header.counters=changed end
  job.binary=bytes
  local leaked=J.array()
  for name,before in pairs(job.meanings) do if (State.meaning(name) or false)~=before then leaked[#leaked+1]=name end end
  if #leaked>0 then job.header.leaks=leaked end
end
function Live.check()
  local job=Live.current
  State.restoreCounters(job.baseline)
  local macroDrift=false
  for name,before in pairs(job.baselineMacros) do if (State.meaning(name) or false)~=before then macroDrift=true end end
  if not State.equal(State.fingerprint(Live.scratch),Live.fingerprint) or macroDrift then
    answer({op='fatal',req=job.request.req,reason='state changed across transaction'}); tex.setcount(Live.continuation,0)
  else
    local h=job.header
    local json
    if h.status=='ok' and not h.counters and not h.leaks then
      json=string.format('{"op":"result","req":%d,"ctx":%d,"status":"ok","errors":[],"lines":%d,"glyphs":%d,"t_tex_us":%d,"t_traverse_us":%d,"t_pack_us":0,"dl_bytes":%d}',
        h.req,h.ctx,h.lines,h.glyphs,h.t_tex_us,h.t_traverse_us,h.dl_bytes)
    end
    answer(h,job.binary,json)
  end
  Live.current=nil
  maintainGC(job)
end
function Live.step()
  local line=Live.input:read('*l')
  if not line then tex.setcount(Live.continuation,0); return end
  local req,ctx,length=line:match('^C (%d+) (%d+) (%d+)$')
  local ok,request
  if req then
    length=tonumber(length)
    if length>2*1024*1024 then answer({op='error',message='request exceeds 2 MiB'}); tex.setcount(Live.continuation,0); return end
    local source=length==0 and '' or Live.input:read(length)
    ok=source and #source==length
    request={op='compile',req=tonumber(req),ctx=tonumber(ctx),source=source}
  else ok,request=pcall(J.decode,line) end
  if not ok or type(request)~='table' or request==J.null then answer({op='error',message='invalid request'}); return end
  local ok,err=pcall(Live.dispatch,request)
  if not ok then
    maintainGC(Live.current)
    Live.current=nil
    answer({op=request.op=='compile' and 'result' or 'error',req=request.req,ctx=request.ctx,status='error',
      errors={{message=tostring(err)}},message=tostring(err)})
  end
end
return Live
