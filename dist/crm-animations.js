/* Light, route-aware GSAP motion for the CRM. Keeps form renders and data edits still. */
(function(){
  if(window.__crmGsapMotionInstalled)return;
  window.__crmGsapMotionInstalled=true;

  const gsap=window.gsap;
  const app=document.getElementById('app');
  const motionQuery=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  let animationContext=null;
  let lastRoute='';
  let scheduledFrame=0;

  const routeKey=()=>{
    const page=typeof view!=='undefined'?String(view):'';
    const isDraft=typeof draft!=='undefined'&&!!draft;
    const draftType=isDraft&&draft.type?String(draft.type):'';
    return `${page}|${isDraft?'draft:'+draftType:'workspace'}`;
  };
  const motionAllowed=()=>!!gsap&&!(motionQuery&&motionQuery.matches);
  const unique=items=>[...new Set(items.filter(Boolean))];

  function playEntrance(force){
    if(!app||!motionAllowed())return;
    const route=routeKey();
    const changed=route!==lastRoute;
    lastRoute=route;
    if(!force&&!changed)return;

    if(animationContext){animationContext.revert();animationContext=null}
    const dashboard=app.querySelector('.home-dashboard');
    const heading=unique([
      app.querySelector('.home-dashboard-head'),
      app.querySelector(':scope > header'),
      app.querySelector('.workspace-header,.page-header,.client-profile-header,.lead-profile-header')
    ]);
    const dashboardRows=dashboard?[...dashboard.querySelectorAll('.home-period-row,.home-kpis > *, .home-analytics-grid > *, .home-lower-grid > *, .home-shortcuts > *')]:[];
    const genericCards=[...app.querySelectorAll('.stats > *, .panel, .document-card, .client-card, .lead-card, .pipeline-column, .pipeline-card')].slice(0,16);
    const cards=unique([...dashboardRows,...genericCards]);
    const fallback=cards.length||heading.length?[]:[...app.children].slice(0,10);
    const activeNavigation=unique([
      document.querySelector('#nav button.active'),
      document.querySelector('#mobileNav button.active')
    ]);

    animationContext=gsap.context(()=>{
      if(heading.length)gsap.fromTo(heading,{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:.34,ease:'power2.out',overwrite:'auto'});
      if(dashboard){
        const period=dashboard.querySelector('.home-period-row');
        if(period)gsap.fromTo(period,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.28,delay:.04,ease:'power2.out',overwrite:'auto'});
      }
      if(cards.length)gsap.fromTo(cards,{autoAlpha:0,y:12},{autoAlpha:1,y:0,duration:.34,delay:.06,stagger:.035,ease:'power2.out',overwrite:'auto'});
      if(fallback.length)gsap.fromTo(fallback,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.3,stagger:.035,ease:'power2.out',overwrite:'auto'});
      if(activeNavigation.length)gsap.fromTo(activeNavigation,{scale:.96},{scale:1,duration:.26,delay:.04,ease:'back.out(1.7)',overwrite:'auto'});
    },app);
  }

  function scheduleEntrance(force){
    if(scheduledFrame)cancelAnimationFrame(scheduledFrame);
    scheduledFrame=requestAnimationFrame(()=>{
      scheduledFrame=0;
      playEntrance(!!force);
    });
  }

  const baseRender=window.render;
  if(typeof baseRender==='function'){
    window.render=function(){
      const result=baseRender.apply(this,arguments);
      scheduleEntrance(false);
      return result;
    };
  }

  // Add a small response to mouse or pen interaction without changing layout.
  const interactiveSelector='#app button:not(:disabled),#nav button:not(:disabled),#mobileNav button:not(:disabled),#commandBar button:not(:disabled)';
  document.addEventListener('pointerover',event=>{
    if(!motionAllowed()||event.pointerType==='touch')return;
    const target=event.target.closest(interactiveSelector);
    if(!target||target.contains(event.relatedTarget))return;
    gsap.to(target,{scale:1.018,duration:.14,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerout',event=>{
    if(!motionAllowed()||event.pointerType==='touch')return;
    const target=event.target.closest(interactiveSelector);
    if(!target||target.contains(event.relatedTarget))return;
    gsap.to(target,{scale:1,duration:.16,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerdown',event=>{
    if(!motionAllowed()||event.pointerType==='touch')return;
    const target=event.target.closest(interactiveSelector);
    if(target)gsap.to(target,{scale:.985,duration:.07,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerup',event=>{
    if(!motionAllowed()||event.pointerType==='touch')return;
    const target=event.target.closest(interactiveSelector);
    if(target)gsap.to(target,{scale:1,duration:.14,ease:'power1.out',overwrite:true});
  });

  // Dialogs keep their native open/close behavior, with a brief entrance on open.
  const dialogObserver=new MutationObserver(records=>{
    for(const record of records){
      const dialog=record.target;
      if(!(dialog instanceof HTMLDialogElement)||!dialog.open)continue;
      if(motionAllowed())gsap.fromTo(dialog,{autoAlpha:0,y:10,scale:.99},{autoAlpha:1,y:0,scale:1,duration:.22,ease:'power2.out',overwrite:true});
      else if(gsap)gsap.set(dialog,{clearProps:'opacity,visibility,transform'});
    }
  });
  dialogObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});

  if(motionQuery){
    const handleMotionChange=()=>{
      if(motionQuery.matches){
        if(animationContext){animationContext.revert();animationContext=null}
        gsap&&gsap.globalTimeline&&gsap.globalTimeline.getChildren().forEach(animation=>animation.kill());
        document.querySelectorAll('dialog[open]').forEach(dialog=>gsap&&gsap.set(dialog,{clearProps:'opacity,visibility,transform'}));
      }
    };
    if(motionQuery.addEventListener)motionQuery.addEventListener('change',handleMotionChange);
    else if(motionQuery.addListener)motionQuery.addListener(handleMotionChange);
  }

  lastRoute=routeKey();
  scheduleEntrance(true);
})();
