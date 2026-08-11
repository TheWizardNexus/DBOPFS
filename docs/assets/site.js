const NPM_PACKAGE_NAME='dbopfs';

function setPackageName(){
    for(const element of document.querySelectorAll('[data-package-name]')){
        element.textContent=element.textContent.replaceAll('dbopfs',NPM_PACKAGE_NAME);
    }
}

function setCurrentNavigation(){
    const page=document.body.dataset.page||'';

    for(const link of document.querySelectorAll('[data-nav]')){
        if(link.dataset.nav===page){
            link.setAttribute('aria-current','page');
        }else{
            link.removeAttribute('aria-current');
        }
    }
}

function installNavigation(){
    const toggle=document.querySelector('.nav-toggle');
    const navigation=document.querySelector('.site-nav');

    if(!toggle||!navigation){
        return;
    }

    const close=()=>{
        toggle.setAttribute('aria-expanded','false');
        navigation.removeAttribute('data-open');
    };
    const open=()=>{
        toggle.setAttribute('aria-expanded','true');
        navigation.dataset.open='true';
    };

    document.documentElement.dataset.navReady='true';
    toggle.addEventListener('click',()=>{
        if(toggle.getAttribute('aria-expanded')==='true'){
            close();
        }else{
            open();
        }
    });
    navigation.addEventListener('click',event=>{
        if(event.target.closest('a')){
            close();
        }
    });

    const desktop=window.matchMedia('(min-width:52.01rem)');
    desktop.addEventListener?.('change',event=>{
        if(event.matches){
            close();
        }
    });
}

async function copyText(text){
    if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea=document.createElement('textarea');
    textarea.value=text;
    textarea.setAttribute('readonly','');
    textarea.style.position='fixed';
    textarea.style.opacity='0';
    document.body.appendChild(textarea);
    textarea.select();

    const copied=document.execCommand('copy');
    textarea.remove();

    if(!copied){
        throw new Error('Copy is unavailable in this browser.');
    }
}

function installCopyButtons(){
    for(const button of document.querySelectorAll('[data-copy-target]')){
        button.addEventListener('click',async()=>{
            const target=document.getElementById(button.dataset.copyTarget);

            if(!target){
                return;
            }

            const originalLabel=button.textContent;

            try{
                await copyText(target.textContent);
                button.textContent='Copied';
            }catch(error){
                button.textContent='Copy failed';
            }

            window.setTimeout(()=>{
                button.textContent=originalLabel;
            },1600);
        });
    }
}

function installBadgeFallbacks(){
    for(const badge of document.querySelectorAll('img[data-evidence-badge]')){
        const showFallback=()=>{
            badge.hidden=true;
            const fallback=badge.parentElement?.querySelector('.badge-fallback');

            if(fallback){
                fallback.hidden=false;
            }
        };

        badge.addEventListener('error',showFallback);

        if(badge.complete&&badge.naturalWidth===0){
            showFallback();
        }
    }
}

function setCurrentYear(){
    for(const element of document.querySelectorAll('[data-current-year]')){
        element.textContent=String(new Date().getFullYear());
    }
}

setPackageName();
setCurrentNavigation();
installNavigation();
installCopyButtons();
installBadgeFallbacks();
setCurrentYear();
