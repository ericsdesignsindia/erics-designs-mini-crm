const toast=document.getElementById('toast');
function showToast(message){toast.textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200)}
document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>{document.querySelector('.nav-item.active').classList.remove('active');item.classList.add('active');document.getElementById('crumb').textContent=item.dataset.view;showToast(`${item.dataset.view} preview ready`)}));
document.getElementById('newButton').addEventListener('click',()=>showToast('Create menu opened for the demo'));
document.getElementById('addLead').addEventListener('click',()=>showToast('New lead form is ready in the live CRM'));
document.querySelectorAll('.focus-list button,.text-button,.tabs button').forEach(button=>button.addEventListener('click',()=>showToast('Demo interaction complete')));
document.getElementById('menuToggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
