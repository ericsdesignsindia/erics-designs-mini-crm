(function(){
  const reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playWorkspaceEntrance=()=>{
    if(reduceMotion||!window.gsap)return;
    const app=document.getElementById('app');
    if(!app)return;
    const header=app.querySelector(':scope > header');
    const primary=[header,app.querySelector('.quick-actions')].filter(Boolean);
    const cards=[...app.querySelectorAll('.stats > *, .panel, .document-card, .client-card, .lead-card')].slice(0,18);
    gsap.killTweensOf([...primary,...cards]);
    if(primary.length)gsap.fromTo(primary,{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:.28,stagger:.05,ease:'power2.out',overwrite:'auto'});
    if(cards.length)gsap.fromTo(cards,{autoAlpha:0,y:14},{autoAlpha:1,y:0,duration:.34,stagger:.025,delay:.04,ease:'power2.out',overwrite:'auto'});
  };
  const baseRender=window.render;
  if(typeof baseRender==='function'){
    window.render=function(){
      const result=baseRender.apply(this,arguments);
      requestAnimationFrame(playWorkspaceEntrance);
      return result;
    };
  }
  requestAnimationFrame(playWorkspaceEntrance);
})();