/* Route-aware GSAP motion. Motion stays subtle and respects reduced-motion settings. */
(function(){
  if(window.__crmGsapMotionInstalled)return;
  window.__crmGsapMotionInstalled=true;

  const gsap=window.gsap;
  const app=document.getElementById('app');
  const motionQuery=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  let context=null,lastRoute='',frame=0,observerTimer=0;
  const unique=items=>[...new Set(items.filter(Boolean))];
  const allowed=()=>!!gsap&&!(motionQuery&&motionQuery.matches);
  const getRoute=()=>{
    const page=typeof view!=='undefined'?String(view):'';
    const draftOpen=typeof draft!=='undefined'&&!!draft;
    return `${page}|${draftOpen?(draft.type||'draft'):'page'}`;
  };

  function animatePage(force){
    frame=0;
    if(!app||!allowed())return;
    const route=getRoute(),changed=route!==lastRoute;
    if(!force&&!changed)return;
    lastRoute=route;
    if(context){context.revert();context=null}

    const header=unique([
      app.querySelector('.home-dashboard-head'),
      app.querySelector(':scope > header'),
      app.querySelector('.workspace-header,.page-header,.client-profile-header,.lead-profile-header'),
      app.querySelector('.revamp-page-head')
    ]);
    const cards=unique([
      ...app.querySelectorAll('.home-kpis > *, .home-analytics-grid > *, .home-lower-grid > *, .home-shortcuts > *'),
      ...app.querySelectorAll('.stats > *, .panel, .card, .document-card, .client-card, .lead-card, .pipeline-column, .pipeline-card, .revamp-kpi, .revamp-chart-card')
    ]).slice(0,24);
    const fallback=header.length||cards.length?[]:[...app.children].slice(0,8);
    const active=unique([document.querySelector('#nav button.active'),document.querySelector('#mobileNav button.active')]);

    context=gsap.context(()=>{
      if(header.length)gsap.fromTo(header,{autoAlpha:0,y:9},{autoAlpha:1,y:0,duration:.32,ease:'power2.out',overwrite:'auto'});
      if(cards.length)gsap.fromTo(cards,{autoAlpha:0,y:11},{autoAlpha:1,y:0,duration:.34,delay:.035,stagger:.028,ease:'power2.out',overwrite:'auto'});
      if(fallback.length)gsap.fromTo(fallback,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:.3,stagger:.03,ease:'power2.out',overwrite:'auto'});
      if(active.length)gsap.fromTo(active,{scale:.97},{scale:1,duration:.24,ease:'back.out(1.6)',overwrite:'auto'});
    },app);
  }

  function schedule(force){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>animatePage(!!force));
  }

  // Install after all feature scripts so their render functions are wrapped too.
  if(typeof window.render==='function'){
    const original=window.render;
    window.render=function(){
      const result=original.apply(this,arguments);
      schedule(false);
      return result;
    };
  }

  // Some workspaces update directly without calling the global renderer.
  if(app){
    const appObserver=new MutationObserver(()=>{
      if(observerTimer)clearTimeout(observerTimer);
      observerTimer=setTimeout(()=>{
        observerTimer=0;
        if(getRoute()!==lastRoute)schedule(false);
      },45);
    });
    appObserver.observe(app,{childList:true,subtree:true});
  }

  const buttons='#app button:not(:disabled),#nav button:not(:disabled),#mobileNav button:not(:disabled),#commandBar button:not(:disabled)';
  document.addEventListener('pointerover',event=>{
    if(!allowed()||event.pointerType==='touch')return;
    const el=event.target.closest(buttons);
    if(el&&!el.contains(event.relatedTarget))gsap.to(el,{y:-1,scale:1.012,duration:.14,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerout',event=>{
    if(!allowed()||event.pointerType==='touch')return;
    const el=event.target.closest(buttons);
    if(el&&!el.contains(event.relatedTarget))gsap.to(el,{y:0,scale:1,duration:.16,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerdown',event=>{
    if(!allowed())return;
    const el=event.target.closest(buttons);
    if(el)gsap.to(el,{scale:.985,duration:.07,ease:'power1.out',overwrite:true});
  });
  document.addEventListener('pointerup',event=>{
    if(!allowed())return;
    const el=event.target.closest(buttons);
    if(el)gsap.to(el,{scale:1,duration:.14,ease:'power1.out',overwrite:true});
  });

  const dialogObserver=new MutationObserver(records=>records.forEach(record=>{
    const dialog=record.target;
    if(!(dialog instanceof HTMLDialogElement)||!dialog.open)return;
    if(allowed())gsap.fromTo(dialog,{autoAlpha:0,y:10,scale:.99},{autoAlpha:1,y:0,scale:1,duration:.22,ease:'power2.out',overwrite:true});
    else gsap&&gsap.set(dialog,{clearProps:'opacity,visibility,transform'});
  }));
  dialogObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});

  if(motionQuery){
    const reduceMotion=()=>{
      if(!motionQuery.matches)return;
      if(context){context.revert();context=null}
      gsap&&gsap.globalTimeline&&gsap.globalTimeline.getChildren().forEach(animation=>animation.kill());
      document.querySelectorAll('dialog[open]').forEach(dialog=>gsap&&gsap.set(dialog,{clearProps:'opacity,visibility,transform'}));
    };
    if(motionQuery.addEventListener)motionQuery.addEventListener('change',reduceMotion);
    else if(motionQuery.addListener)motionQuery.addListener(reduceMotion);
  }
  lastRoute=getRoute();
  schedule(true);
})();
