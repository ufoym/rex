-- Rex JSON codec. No external Lua modules are loaded.
if package.loaded['rex-json'] then return package.loaded['rex-json'] end
local J = { null = {} }
package.loaded['rex-json']=J
local array = { __rex_array=true }
function J.array(t) return setmetatable(t or {},array) end
local escapes = { ['"']='\\"', ['\\']='\\\\', ['\b']='\\b', ['\f']='\\f', ['\n']='\\n', ['\r']='\\r', ['\t']='\\t' }
local function quote(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    return escapes[c] or string.format('\\u%04x', c:byte())
  end) .. '"'
end
function J.encode(value)
  local kind = type(value)
  if value == J.null or kind == 'nil' then return 'null' end
  if kind == 'string' then return quote(value) end
  if kind == 'boolean' then return tostring(value) end
  if kind == 'number' then
    assert(value == value and math.abs(value) ~= math.huge, 'non-finite JSON number')
    return tostring(value)
  end
  assert(kind == 'table', 'unsupported JSON value')
  local parts = {}
  if #value > 0 or getmetatable(value)==array then
    for i=1,#value do parts[i] = J.encode(value[i]) end
    return '[' .. table.concat(parts, ',') .. ']'
  end
  for k,v in pairs(value) do parts[#parts+1] = quote(tostring(k)) .. ':' .. J.encode(v) end
  return '{' .. table.concat(parts, ',') .. '}'
end
function J.decode(source)
  local pos, length = 1, #source
  local parse
  local function skip() pos = source:find('%S', pos) or length+1 end
  local function read_string()
    pos = pos+1
    local pieces, begin = {}, pos
    while pos <= length do
      pos=source:find('[%z\1-\31\\"]',pos) or length+1
      if pos>length then break end
      local c = source:sub(pos,pos)
      if c == '"' then
        pieces[#pieces+1] = source:sub(begin,pos-1); pos=pos+1
        return table.concat(pieces)
      elseif c == '\\' then
        pieces[#pieces+1] = source:sub(begin,pos-1)
        local e = source:sub(pos+1,pos+1)
        if e == 'u' then
          local code = assert(tonumber(source:sub(pos+2,pos+5),16),'invalid Unicode escape')
          pos=pos+6
          if code >= 0xd800 and code <= 0xdbff then
            assert(source:sub(pos,pos+1)=='\\u','missing low surrogate')
            local low=assert(tonumber(source:sub(pos+2,pos+5),16))
            assert(low>=0xdc00 and low<=0xdfff,'invalid low surrogate')
            code=0x10000+(code-0xd800)*1024+low-0xdc00; pos=pos+6
          end
          pieces[#pieces+1]=utf8.char(code)
        else
          local map={['"']='"',['\\']='\\',['/']='/',b='\b',f='\f',n='\n',r='\r',t='\t'}
          pieces[#pieces+1]=assert(map[e],'invalid JSON escape'); pos=pos+2
        end
        begin=pos
      else error('control byte in JSON string') end
    end
    error('unterminated JSON string')
  end
  parse = function()
    skip()
    local c=source:sub(pos,pos)
    if c=='"' then return read_string() end
    if c=='{' or c=='[' then
      local object = c=='{'; local result={}; local close=object and '}' or ']'
      pos=pos+1; skip()
      if source:sub(pos,pos)==close then pos=pos+1; return result end
      while true do
        local key
        if object then
          assert(source:sub(pos,pos)=='"','expected object key'); key=read_string(); skip()
          assert(source:sub(pos,pos)==':','expected colon'); pos=pos+1
        else key=#result+1 end
        result[key]=parse(); skip()
        c=source:sub(pos,pos); pos=pos+1
        if c==close then return result end
        assert(c==',','expected comma'); skip()
      end
    end
    for word,value in pairs({['true']=true,['false']=false,['null']=J.null}) do
      if source:sub(pos,pos+#word-1)==word then pos=pos+#word; return value end
    end
    local number=source:match('^-?%d+%.?%d*[eE]?[+-]?%d*',pos)
    local value=number and tonumber(number)
    assert(value,'invalid JSON value at '..pos); pos=pos+#number
    return value
  end
  local value=parse(); skip(); assert(pos>length,'trailing JSON data'); return value
end
return J
