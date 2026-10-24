import React, {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {BRAND_LOGO} from './brand.js';

// Runs once per app launch; connection restoration can finish independently.
export default function StartupLogo({ready}) {
  const [finished,setFinished]=useState(false);
  const logo=useRef(null),veil=useRef(null);
  useLayoutEffect(()=>{
    document.documentElement.dataset.brandIntro='active';
    return ()=>{delete document.documentElement.dataset.brandIntro;};
  },[]);
  useEffect(()=>{
    if(!ready||finished)return;
    let cancelled=false,timer,animation,fade;
    const finish=()=>{if(cancelled)return;delete document.documentElement.dataset.brandIntro;setFinished(true);};
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    if(reduced.matches||!logo.current?.animate){finish();return;}
    const animate=async()=>{
      try {await logo.current.decode();} catch { /* The header remains usable if an image cannot decode. */ }
      if(cancelled)return;
      timer=setTimeout(()=>{
        const target=document.querySelector('[data-brand-home]');
        if(!target||!logo.current){finish();return;}
        const from=logo.current.getBoundingClientRect(),to=target.getBoundingClientRect();
        animation=logo.current.animate([
          {transform:'translate(0,0) scale(1)',opacity:1},
          {transform:`translate(${to.left-from.left}px,${to.top-from.top}px) scale(${to.width/from.width},${to.height/from.height})`,opacity:1}
        ],{duration:850,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
        fade=veil.current.animate([{opacity:1},{opacity:0}],{duration:650,fill:'forwards'});
        animation.finished.then(finish).catch(()=>{});
      },450);
    };
    animate();
    const resized=()=>finish();
    window.addEventListener('resize',resized,{once:true});
    return ()=>{cancelled=true;clearTimeout(timer);animation?.cancel();fade?.cancel();window.removeEventListener('resize',resized);};
  },[ready,finished]);
  if(finished)return null;
  return <div className="brand-intro" aria-hidden="true"><div ref={veil} className="brand-intro-veil"/><img ref={logo} src={BRAND_LOGO} alt="" className="brand-intro-logo"/></div>;
}
