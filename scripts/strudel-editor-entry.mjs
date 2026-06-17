export { EditorState } from '@codemirror/state';
export {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view';
export {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore
} from '@codemirror/commands';
export { javascript } from '@codemirror/lang-javascript';
export {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language';
export {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap
} from '@codemirror/autocomplete';
export {
  highlightSelectionMatches,
  searchKeymap
} from '@codemirror/search';
export { default as strudelTheme } from '@strudel/codemirror/themes/strudel-theme.mjs';
export { jamStrudelAutocomplete } from './strudel-editor-completions.mjs';
