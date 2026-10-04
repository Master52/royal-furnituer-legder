// Modifier-only shortcuts leave ordinary typing, IME and repeated keys alone.
export function keyboardChord(event) {
  if(event.defaultPrevented||event.repeat||event.isComposing||event.getModifierState?.('AltGraph'))return '';
  const key=event.key.toLowerCase();
  if(['alt','control','meta','shift'].includes(key)||!event.altKey&&!event.ctrlKey&&!event.metaKey)return '';
  return [...(event.ctrlKey||event.metaKey?['mod']:[]),...(event.altKey?['alt']:[]),...(event.shiftKey?['shift']:[]),key].join('+');
}
export function shortcutLabel(chord){return chord.split('+').map(key=>({mod:'Ctrl / ⌘',alt:'Alt',shift:'Shift',arrowleft:'←',arrowright:'→',enter:'Enter'}[key]||key.toUpperCase())).join(' + ');}
export function shortcutAvailable(element,includeDisabled=false){
  if(!element||element.closest('.screen-hidden,[hidden],[inert]')||!includeDisabled&&element.matches(':disabled,[aria-disabled=true]'))return false;
  return Boolean(element.getClientRects().length||element.closest('details:not([open])')?.getClientRects().length);
}
export function shortcutScope(){return [...document.querySelectorAll('dialog[open]')].at(-1)||document.querySelector('main');}
export function activateShortcut(element){
  element.closest('details:not([open])')?.setAttribute('open','');
  element.focus({preventScroll:true});
  element.scrollIntoView?.({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
  if(element.matches('button,summary,input[type=checkbox],input[type=radio]'))element.click();
}

export function shortcutAria(chord){
  if(!chord)return undefined;
  const keys={mod:'Control',alt:'Alt',shift:'Shift',arrowleft:'ArrowLeft',arrowright:'ArrowRight',enter:'Enter'};
  const value=chord.split('+').map(key=>keys[key]||key.toUpperCase()).join('+');
  return chord.startsWith('mod+')?`${value} ${value.replace('Control','Meta')}`:value;
}
