import {basicSetup, EditorState, EditorView, Compartment, keymap, indentWithTab,
  StreamLanguage, stex, indentUnit, HighlightStyle, syntaxHighlighting, tags, openSearchPanel} from "../../vendor/codemirror.mjs";

export function sourceEditor(parent, {onChange, onSelection, onCompile, onLocate}) {
  const appearance = new Compartment(), editable = new Compartment();
  const theme = () => EditorView.theme({}, {dark: document.documentElement.dataset.theme === "dark"});
  const extensions = [
    keymap.of([
      {key: "Mod-Enter", run: view => {if (!view.state.readOnly) onCompile(); return true;}},
      {key: "Mod-Alt-j", run: () => {onLocate(); return true;}},
      indentWithTab,
    ]),
    basicSetup, StreamLanguage.define(stex), indentUnit.of("  "), EditorState.tabSize.of(2),
    EditorView.lineWrapping, appearance.of(theme()), editable.of([EditorView.editable.of(true), EditorState.readOnly.of(false)]),
    EditorView.contentAttributes.of({"aria-label": "LaTeX source", spellcheck: "false", autocapitalize: "off", autocorrect: "off"}),
    syntaxHighlighting(HighlightStyle.define([
      {tag: [tags.keyword, tags.tagName], color: "var(--syntax-command)"},
      {tag: [tags.atom, tags.string, tags.number], color: "var(--syntax-value)"},
      {tag: tags.comment, color: "var(--muted)", fontStyle: "italic"},
      {tag: [tags.bracket, tags.operator], color: "var(--syntax-punctuation)"},
    ])),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChange(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) onSelection();
    }),
  ];
  const view = new EditorView({parent, extensions});
  document.addEventListener("rex-theme-change", () => view.dispatch({effects: appearance.reconfigure(theme())}));
  return {
    view,
    state: source => EditorState.create({doc: source, extensions}),
    select: state => {
      view.setState(state);
      view.dispatch({effects: appearance.reconfigure(theme())});
    },
    search: () => {openSearchPanel(view);},
    editable: value => view.dispatch({effects: editable.reconfigure([EditorView.editable.of(value), EditorState.readOnly.of(!value)])}),
  };
}
