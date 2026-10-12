-- Fill missing CJK glyphs using font coverage, without character-specific rules.
local Fallback={}
local candidates={'FandolSong-Regular.otf','ipaexm.ttf','NanumMyeongjo-Regular.ttf'}
local loaded,lookups={},{}
local function load(name,size,metrics)
  local key=name..':'..size..':'..metrics.jfm..':'..(metrics.var or '')
  if not loaded[key] then
    local data=luaotfload.define_font('file:'..name..':mode=node',size)
    local id=type(data)=='number' and data or font.define(data)
    if type(data)=='table' then fonts.definers.register(data,id) end
    loaded[key]=id
    -- LuaTeX-ja needs the source font's spacing metrics for substituted glyphs.
    local copy={}; for k,v in pairs(metrics) do copy[k]=v end
    copy.chars_cbcache={}; copy.rotation={}
    luatexja.jfont.font_metric_table[id]=copy
  end
  return loaded[key]
end
local function substitute(head)
  for glyph in node.traverse_id(node.id('glyph'),head) do
    local id,char=glyph.font,glyph.char
    local metrics=luatexja.jfont.font_metric_table[id]
    if metrics then
      local base=font.getfont(id)
      if not base.characters[char] then
        local lookup=lookups[id]; if not lookup then lookup={}; lookups[id]=lookup end
        if lookup[char]==nil then
          lookup[char]=false
          for _,name in ipairs(candidates) do
            local target=load(name,base.size,metrics)
            if font.getfont(target).characters[char] then lookup[char]=target; break end
          end
        end
        if lookup[char] then glyph.font=lookup[char] end
      end
    end
  end
  return head
end
function Fallback.install()
  if luatexja then
    luatexbase.add_to_callback('pre_shaping_filter',substitute,'rex.font-fallback')
  end
end
return Fallback
