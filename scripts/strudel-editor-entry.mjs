export { EditorState, Prec } from '@codemirror/state';
export {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap
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
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language';
export {
  autocompletion,
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion
} from '@codemirror/autocomplete';
export {
  highlightSelectionMatches,
  searchKeymap
} from '@codemirror/search';
export { default as strudelTheme } from '@strudel/codemirror/themes/strudel-theme.mjs';
export {
  highlightExtension,
  highlightMiniLocations,
  updateMiniLocations
} from '@strudel/codemirror/highlight.mjs';
export { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
export { jamStrudelAutocomplete } from './strudel-editor-completions.mjs';
