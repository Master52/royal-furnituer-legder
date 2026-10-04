import test from 'node:test';
import assert from 'node:assert/strict';
import {keyboardChord,shortcutLabel,shortcutAvailable,shortcutAria} from '../src/keyboard.js';

test('keyboard chords preserve typing, IME, AltGraph and repeated keys',()=>{
 const alt={key:'Q',altKey:true};assert.equal(keyboardChord(alt),'alt+q');
 assert.equal(keyboardChord({key:'Enter',metaKey:true}),'mod+enter');
 assert.equal(keyboardChord({key:'1',altKey:true,shiftKey:true}),'alt+shift+1');
 for(const flag of [{defaultPrevented:true},{repeat:true},{isComposing:true},{getModifierState:()=>true}])assert.equal(keyboardChord({...alt,...flag}),'');
 for(const key of ['a','Enter','Escape','1'])assert.equal(keyboardChord({key}),'');
 assert.equal(keyboardChord({key:'Shift',altKey:true,shiftKey:true}),'');
 assert.equal(shortcutLabel('alt+shift+1'),'Alt + Shift + 1');assert.equal(shortcutAria('mod+enter'),'Control+Enter Meta+Enter');assert.equal(shortcutAria('alt+p'),'Alt+P');
});
test('hidden or disabled shortcut controls are never activated',()=>{
 const fake=({hidden=false,disabled=false,visible=true,details=false}={})=>({closest:selector=>selector.includes('.screen-hidden')?(hidden?{}:null):details?{getClientRects:()=>[{}]}:null,matches:()=>disabled,getClientRects:()=>visible?[{}]:[]});
 assert.equal(shortcutAvailable(fake()),true);assert.equal(shortcutAvailable(fake({hidden:true})),false);assert.equal(shortcutAvailable(fake({disabled:true})),false);assert.equal(shortcutAvailable(fake({visible:false})),false);
 assert.equal(shortcutAvailable(fake({visible:false,details:true})),true);assert.equal(shortcutAvailable(fake({disabled:true}),true),true);
});
