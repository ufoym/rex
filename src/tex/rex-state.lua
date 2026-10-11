-- Context snapshots use LuaTeX's public tex/token APIs. Full snapshots simplify replay.
local State = {}
local trueMode=token.create('iftrue').mode
State.parameters = {
  ints={'looseness','tolerance','pretolerance','hyphenpenalty','exhyphenpenalty','adjdemerits',
    'doublehyphendemerits','finalhyphendemerits','linepenalty','lastlinefit','language',
    'lefthyphenmin','righthyphenmin','uchyph','interlinepenalty','clubpenalty','widowpenalty',
    'adjustspacing','protrudechars','hangafter'},
  dims={'hsize','parindent','emergencystretch','lineskiplimit','hangindent','mathsurround'},
  glues={'leftskip','rightskip','parfillskip','baselineskip','lineskip','spaceskip','xspaceskip'},
}
function State.macro(name) local ok,v=pcall(token.get_macro,name); if ok then return v end end
local switchTokens={}
function State.switch(name)
  local t=switchTokens[name]
  if not t then
    local ok,value=pcall(token.create,name)
    if not ok then return false end
    t=value
    if t.cmdname~='undefined_cs' then switchTokens[name]=t end
  end
  return t.mode==trueMode
end
function State.meaning(name)
  local t=token.create(name)
  if t.cmdname=='undefined_cs' then return nil end
  if t.cmdname=='if_test' then return t.mode==trueMode and '\\iftrue' or '\\iffalse' end
  return token.get_meaning(name)
end
local counterList,counterNames
function State.counters()
  local checkpoint=State.macro('cl@@ckpt') or ''
  if checkpoint~=counterList then
    counterList,counterNames=checkpoint,{}
    for name in checkpoint:gmatch('\\@elt%s*{([^}]+)}') do
      local ok=pcall(tex.getcount,'c@'..name)
      if ok then counterNames[name]=token.create('c@'..name).index end
    end
  end
  local result={}
  for name,register in pairs(counterNames) do result[name]=tex.getcount(register) end
  return result
end
function State.restoreCounters(baseline)
  for name,value in pairs(baseline) do
    local register=counterNames[name] or 'c@'..name
    if tex.getcount(register)~=value then tex.setcount('global',register,value) end
  end
end
function State.font()
  local f={}
  for _,name in ipairs({'encoding','family','series','shape','size','baselineskip'}) do f[name]=State.macro('f@'..name) end
  return f
end
function State.snapshot(tracked)
  local s={ints={},dims={},glues={},nfss=State.font(),color=State.macro('current@color'),
    counters=State.counters(),thefmt={},macros={},everypar=tex.gettoks('everypar'),parshape=tex.parshape,
    mathversion=State.macro('math@version'),
    nobreak=State.switch('if@nobreak'),afterindent=State.switch('if@afterindent'),noskipsec=State.switch('if@noskipsec')}
  for category,names in pairs(State.parameters) do
    for _,name in ipairs(names) do
      if category=='glues' then s.glues[name]={tex.getglue(name)} else s[category][name]=tex.get(name) end
    end
  end
  for name in pairs(s.counters) do s.thefmt[name]=State.macro('the'..name) end
  for name in pairs(tracked or {}) do
    local meaning=State.meaning(name)
    if meaning then s.macros[name]={meaning=meaning,command=token.create(name).cmdname} end
  end
  return s
end
function State.definition(name,meaning)
  if not meaning then return '' end
  local command
  if type(meaning)=='table' then command=meaning.command; meaning=meaning.meaning end
  local target='\\csname '..name..'\\endcsname'
  if meaning=='\\iftrue' or meaning=='\\iffalse' then return '\\expandafter\\let'..target..meaning..' ' end
  local arguments,body=meaning:match('^(.-)%->(.*)$')
  if not arguments then return '' end
  local prefix=''
  if command and command:find('protected',1,true) then prefix=prefix..'\\protected' end
  if not command or command:find('long',1,true) then prefix=prefix..'\\long' end
  return prefix..'\\expandafter\\def'..target..arguments..'{'..body..'}'
end
function State.replay_tokens(s)
  local parts={}
  local f=s.nfss or {}
  local select={encoding='fontencoding',family='fontfamily',series='fontseries',shape='fontshape'}
  if s.selectFont~=false then
    for _,name in ipairs({'encoding','family','series','shape'}) do
      if f[name] then parts[#parts+1]='\\'..select[name]..'{'..f[name]..'}' end
    end
    if f.size then parts[#parts+1]='\\fontsize{'..f.size..'}{'..(f.baselineskip or '12pt')..'}' end
    parts[#parts+1]='\\selectfont'
  end
  if s.selectMath~=false and s.mathversion then parts[#parts+1]='\\mathversion{'..s.mathversion..'}' end
  for name,value in pairs(s.replayCounters or s.counters or {}) do
    if name~='page' then parts[#parts+1]='\\csname c@'..name..'\\endcsname='..value..'\\relax ' end
  end
  for name,value in pairs(s.replayFormats or s.thefmt or {}) do parts[#parts+1]='\\expandafter\\def\\csname the'..name..'\\endcsname{'..value..'}' end
  for name,value in pairs(s.replayMacros or s.macros or {}) do parts[#parts+1]=State.definition(name,value) end
  for _,entry in ipairs({{'nobreak','@nobreak'},{'afterindent','@afterindent'},{'noskipsec','@noskipsec'}}) do
    parts[#parts+1]='\\csname '..entry[2]..(s[entry[1]] and 'true' or 'false')..'\\endcsname'
  end
  if s.replayEverypar~=false then parts[#parts+1]='\\everypar{'..(s.everypar or '')..'}' end
  parts[#parts+1]='\\rexParameters'
  return table.concat(parts)
end
function State.apply(s)
  for name,value in pairs(s.replayInts or s.ints or {}) do tex.set(name,value) end
  for name,value in pairs(s.replayDims or s.dims or {}) do tex.set(name,value) end
  for name,value in pairs(s.replayGlues or s.glues or {}) do tex.setglue(name,table.unpack(value)) end
  if s.replayShape then tex.parshape=s.parshape or {} end
  if s.color then token.set_macro('current@color',s.color) end
end
function State.prepare(s)
  s.replayInts={}; s.replayDims={}; s.replayGlues={}; s.replayCounters={}; s.replayFormats={}; s.replayMacros={}; s.baselineMacros={}
  local idle=State.font(); s.selectFont=false
  s.replayEverypar=(s.everypar or '')~=(tex.gettoks('everypar') or '')
  for name,value in pairs(s.nfss or {}) do if idle[name]~=value then s.selectFont=true end end
  s.selectMath=s.mathversion~=State.macro('math@version')
  for name,value in pairs(s.ints or {}) do if tex.get(name)~=value then s.replayInts[name]=value end end
  for name,value in pairs(s.dims or {}) do if tex.get(name)~=value then s.replayDims[name]=value end end
  for name,value in pairs(s.glues or {}) do if not State.equal(value,{tex.getglue(name)}) then s.replayGlues[name]=value end end
  local shape,idleShape=s.parshape or {},tex.parshape or {}
  s.replayShape=#shape~=#idleShape
  for i,row in ipairs(shape) do
    if not idleShape[i] or row[1]~=idleShape[i][1] or row[2]~=idleShape[i][2] then s.replayShape=true; break end
  end
  local counters=State.counters()
  for name,value in pairs(s.counters or {}) do if counters[name]~=value then s.replayCounters[name]=value end end
  for name,value in pairs(s.thefmt or {}) do if State.macro('the'..name)~=value then s.replayFormats[name]=value end end
  for name,value in pairs(s.macros or {}) do
    local meaning=type(value)=='table' and value.meaning or value
    local baseline=State.meaning(name) or false; s.baselineMacros[name]=baseline
    if baseline~=meaning then s.replayMacros[name]=value end
  end
  return State.replay_tokens(s)
end
function State.appearance()
  return {nfss=State.font(),color=State.macro('current@color'),mathversion=State.macro('math@version')}
end
function State.fingerprint(parts)
  parts=parts or {}
  parts[1],parts[2],parts[3],parts[4],parts[5],parts[6]=tex.currentgrouplevel,tex.currentgrouptype,tex.globaldefs,tex.catcodetable,font.current(),tex.escapechar
  local index=6
  for _,category in ipairs({'ints','dims','glues'}) do
    for _,name in ipairs(State.parameters[category]) do
      if category=='glues' then
        local a,b,c,d,e=tex.getglue(name)
        parts[index+1],parts[index+2],parts[index+3],parts[index+4],parts[index+5]=a,b,c,d,e; index=index+5
      else index=index+1; parts[index]=tex.get(name) end
    end
  end
  parts[index+1]=tex.gettoks('everypar'); parts[index+2]=tex.get('output')
  parts[index+3]=State.macro('cl@@ckpt') or ''
  local shape=tex.parshape or {}; parts[index+4]=#shape; index=index+4
  for _,row in ipairs(shape) do parts[index+1],parts[index+2]=row[1],row[2]; index=index+2 end
  return parts
end
function State.equal(a,b)
  if #a~=#b then return false end
  for i=1,#a do if a[i]~=b[i] then return false end end
  return true
end
function State.discover(paths)
  local tracked={arraystretch=true,baselinestretch=true}; local visited={}
  local function read(path,depth)
    if visited[path] or depth>12 then return end; visited[path]=true
    local file=io.open(path,'r'); if not file then return end
    local source=file:read('*a'); file:close()
    for name in source:gmatch('\\[re]*newcommand%s*{?\\([%a@]+)') do tracked[name]=true end
    for name in source:gmatch('\\[gex]*def%s*\\([%a@]+)') do tracked[name]=true end
    for name in source:gmatch('\\newif%s*\\([%a@]+)') do tracked[name]=true end
    for label in source:gmatch('\\new[%a]*%s*{([^}]+)}') do
      if source:find('\\newglossaryentry',1,true) or source:find('\\newacronym',1,true) then tracked['ifglo@'..label..'@flag']=true end
    end
    for name in source:gmatch('\\in[pc]lu[dt]e%s*{([^}]+)}') do
      if not name:match('%.%w+$') then name=name..'.tex' end
      read(kpse.find_file(name) or name,depth+1)
    end
    for name in source:gmatch('\\input%s*{([^}]+)}') do
      if not name:match('%.%w+$') then name=name..'.tex' end
      read(kpse.find_file(name) or name,depth+1)
    end
  end
  for _,path in pairs(paths) do if path then read(path,0) end end
  return tracked
end
return State
