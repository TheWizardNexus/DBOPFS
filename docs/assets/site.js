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

    const desktop=window.matchMedia('(min-width:58.01rem)');
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
                button.textContent='Copy Failed';
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

function installTopicSelection(){
    const toc=document.querySelector('.toc');
    const content=document.querySelector('.docs-content');
    if(!toc||!content){
        return;
    }
    const sections=Array.from(content.children).filter(element=>element.matches('section[id]'));
    const links=Array.from(toc.querySelectorAll('a[href^="#"]'));
    if(!sections.length||!links.length){
        return;
    }

    const heading=toc.querySelector('h2');
    const toolbar=document.createElement('div');
    toolbar.className='toc-toolbar';
    heading.before(toolbar);
    toolbar.append(heading);
    const all=document.createElement('button');
    all.type='button';
    all.className='toc-all';
    all.textContent='See All';
    all.setAttribute('aria-controls',sections.map(section=>section.id).join(' '));
    toolbar.append(all);
    for(const link of links){
        link.setAttribute('aria-controls',link.hash.slice(1));
    }

    function sectionForHash(hash){
        let id;
        try{
            id=decodeURIComponent(hash.slice(1));
        }catch{
            return null;
        }
        const target=document.getElementById(id);
        return sections.find(section=>section===target||section.contains(target))||null;
    }

    function selectSection(section){
        for(const item of sections){
            item.hidden=Boolean(section&&item!==section);
            item.classList.toggle('topic-selected',item===section);
        }
        for(const link of links){
            if(sectionForHash(link.hash)===section&&section){
                link.setAttribute('aria-current','true');
            }else{
                link.removeAttribute('aria-current');
            }
        }
        all.setAttribute('aria-pressed',String(!section));
    }

    function restoreTopic(){
        selectSection(location.hash==='#all-sections'?null:sectionForHash(location.hash)||sections[0]);
    }

    toc.addEventListener('click',event=>{
        const link=event.target.closest('a[href^="#"]');
        if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey){
            return;
        }
        const section=sectionForHash(link.hash);
        if(!section){
            return;
        }
        event.preventDefault();
        if(location.hash!==link.hash){
            history.pushState(null,'',link.hash);
        }
        selectSection(section);
    });
    all.addEventListener('click',()=>{
        if(location.hash!=='#all-sections'){
            history.pushState(null,'','#all-sections');
        }
        selectSection(null);
    });
    // Reveal cross-referenced content before the browser follows its anchor.
    document.addEventListener('click',event=>{
        const link=event.target.closest('a[href]');
        if(!link||toc.contains(link)||event.defaultPrevented){
            return;
        }
        const url=new URL(link.href);
        if(url.origin===location.origin&&url.pathname===location.pathname){
            const section=sectionForHash(url.hash);
            if(section){
                selectSection(section);
            }
        }
    });
    window.addEventListener('hashchange',restoreTopic);
    window.addEventListener('popstate',restoreTopic);
    restoreTopic();
    const initialSection=sectionForHash(location.hash);
    if(initialSection){
        document.getElementById(decodeURIComponent(location.hash.slice(1))).scrollIntoView();
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
installTopicSelection();
installCopyButtons();
installBadgeFallbacks();
setCurrentYear();
