/* Stable EA navigation: groups existing CRM sections without changing routes or records. */
(function(){
  const groups=[
    ['OVERVIEW',['Overview','Reports']],
    ['OPERATIONS',['Clients','Pipeline','Documents','Projects','Client Process','Follow-ups','Calendar','Services']],
    ['FINANCE & PEOPLE',['Accounts','HR']],
    ['CONTROL',['Automations','Templates','Mailbox','Client portal','Jarvis','Settings']]
  ];
  const sectionOf=button=>(button.title||button.querySelector('.nav-label')?.textContent||button.textContent||'').trim();
  function organise(){
    if(!window.matchMedia('(min-width:1024px)').matches)return;
    const nav=document.getElementById('nav');if(!nav)return;
    nav.querySelectorAll('.ea-nav-heading').forEach(node=>node.remove());
    [...nav.querySelectorAll('button')].forEach(button=>{if(button.dataset.horizontalMore||button.dataset.navbarFavorite)button.remove();else button.style.display='flex';});
    const buttons=[...nav.querySelectorAll('button')];
    groups.forEach(([label,names])=>{const target=buttons.find(button=>names.includes(sectionOf(button)));if(!target)return;const heading=document.createElement('span');heading.className='ea-nav-heading';heading.textContent=label;nav.insertBefore(heading,target);});
  }
  function activate(){document.body.classList.add('ea360-interface');organise();}
  const baseRender=window.render;
  if(typeof baseRender==='function')window.render=function(){const result=baseRender.apply(this,arguments);activate();return result;};
  window.addEventListener('resize',organise);
  setTimeout(activate,80);
})();
