const methodNames = [
  's',
  'sound',
  'note',
  'n',
  'freq',
  'gain',
  'pan',
  'room',
  'size',
  'delay',
  'delaytime',
  'delayfeedback',
  'cutoff',
  'resonance',
  'attack',
  'decay',
  'sustain',
  'release',
  'lpf',
  'hpf',
  'lpq',
  'hpq',
  'vowel',
  'bank',
  'speed',
  'slow',
  'fast',
  'rev',
  'jux',
  'every',
  'sometimes',
  'rarely',
  'often',
  'off',
  'stack',
  'cat',
  'seq',
  'mini',
  'scale',
  'chord',
  'voicing',
  'struct',
  'mask',
  'euclid',
  'euclidRot',
  'segment',
  'ply',
  'density',
  'repeatCycles',
  'late',
  'early',
  'clip',
  'orbit',
  'shape',
  'crush',
  'coarse',
  'distort',
  'squiz',
  'phaser',
  'fm',
  'am',
  'widen',
  'scope',
  'spectrum'
];

const sampleNames = [
  'bd',
  'sd',
  'hh',
  'oh',
  'cp',
  'rim',
  'perc',
  'tabla',
  'casio',
  'sawtooth',
  'sine',
  'square',
  'triangle'
];

const completions = [
  ...methodNames.map(label => ({
    label,
    type: 'function',
    detail: 'Strudel',
    boost: label.length <= 2 ? 10 : 0
  })),
  ...sampleNames.map(label => ({
    label,
    type: 'constant',
    detail: 'sound'
  }))
];

export function jamStrudelAutocomplete(context) {
  const sound = context.matchBefore(/(?:^|[^\w])(s|sound)\(\s*["'][^"']*$/);
  if (sound) {
    const quotedText = sound.text;
    const lastToken = quotedText.match(/[A-Za-z0-9_-]*$/)?.[0] || '';
    return {
      from: context.pos - lastToken.length,
      options: sampleNames.map(label => ({ label, type: 'constant', detail: 'sound' })),
      validFor: /^[A-Za-z0-9_-]*$/
    };
  }

  const word = context.matchBefore(/[A-Za-z_$][\w$]*$/);
  if (!word && !context.explicit) return null;
  return {
    from: word?.from ?? context.pos,
    options: completions,
    validFor: /^[\w$]*$/
  };
}
